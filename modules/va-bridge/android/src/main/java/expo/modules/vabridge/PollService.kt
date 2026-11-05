package expo.modules.vabridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps the phone and the server in step while the app is closed: uploads what is waiting, asks the server what to do
 * (show an alert, send an SMS the owner approved, send an approved reply), and tells the server how it went.
 * Alerts for priority 1 use an alarm-style channel so they are heard even in silent mode.
 */
class PollService : Service() {
  @Volatile private var running = false
  private val wakeLock = Object()
  private var netCallback: android.net.ConnectivityManager.NetworkCallback? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    channels(this)
    Presence.start(this)
    val note = Notification.Builder(this, CH_SERVICE).setContentTitle("সুমনের ভার্চুয়াল সহকারী চলছে")
      .setContentText("বার্তার দিকে নজর রাখছি").setSmallIcon(android.R.drawable.stat_notify_sync).setOngoing(true).build()
    // Android 15 stops a "data sync" service after 6 hours a day and never lets it start at boot: that is why sync used to die
    // after a few hours and never came back after a restart. A messaging service has neither limit (Android 14+).
    when {
      Build.VERSION.SDK_INT >= 34 -> startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
      Build.VERSION.SDK_INT >= 29 -> startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else -> startForeground(1, note)
    }
    if (!running) {
      running = true
      alive = true
      watchNetwork()
      Thread { loop() }.start()
    }
    return START_STICKY
  }

  // Safety net: if the phone ever says "time is up" for this service, stop cleanly instead of being killed with an error.
  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

  override fun onDestroy() {
    running = false
    alive = false
    try { netCallback?.let { (getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(it) } } catch (_: Exception) {}
    synchronized(wakeLock) { wakeLock.notifyAll() }
    super.onDestroy()
  }

  /** The moment the internet comes back (or changes network), skip any waiting and sync right away, so nothing stays stuck in the queue. */
  private fun watchNetwork() {
    try {
      val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
      val cb = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: android.net.Network) { nudge = true; synchronized(wakeLock) { wakeLock.notifyAll() } }
      }
      cm.registerDefaultNetworkCallback(cb)
      netCallback = cb
    } catch (_: Exception) { /* without it the normal timer still syncs, just a little later */ }
  }

  private fun loop() {
    val ctx = applicationContext
    var failures = 0
    while (running) {
      if (nudge) { nudge = false; failures = 0 }
      try {
        if (!Store.paired(ctx)) { Thread.sleep(5000); continue }
        // Uploading and reporting run with the CPU held awake (capped), so they finish even with the screen off.
        Awake.hold(ctx, 40_000, "upload") { Outbox.flush(ctx); Presence.report(ctx) }
        failures = if (pollOnce(ctx)) 0 else failures + 1
      } catch (_: InterruptedException) {
        return
      } catch (e: Exception) {
        failures++
        Store.note(ctx, "সিঙ্ক ব্যর্থ: ${e.javaClass.simpleName}")
      }
      // Normal case: the server already held the call for up to 25 s, so a short breath is enough. Trouble: back off, never hammer.
      val pause = if (failures == 0) 800L else minOf(30_000L, 3_000L * failures)
      // Without a wake lock a sleeping phone freezes this short wait, and the next check only happens when something else
      // wakes the phone: that is why messages arrived late with the screen off. The wait itself is short and capped.
      try { Awake.hold(ctx, pause + 3_000L, "pause") { if (nudge) nudge = false else synchronized(wakeLock) { wakeLock.wait(pause) } } } catch (_: InterruptedException) { return }
    }
  }

  /** One long-poll round. True when the server answered. The server holds the call until something arrives, so news is instant. */
  private fun pollOnce(ctx: Context): Boolean {
    val r = Http.call(ctx, "GET", "/device/poll?wait=25", readMs = 35000)
    if (r.code == 401) {
      Store.note(ctx, "ফোনের অনুমতি বাতিল বা মেয়াদ শেষ — আবার লগইন করুন")
      val last = Store.prefs(ctx).getLong("last_401_notice", 0L)
      if (System.currentTimeMillis() - last > 6 * 3600_000L) {  // tell the owner once in a while, never spam
        Store.prefs(ctx).edit().putLong("last_401_notice", System.currentTimeMillis()).apply()
        showAlert(ctx, "p3", "⚠ এই ফোনের লগইন শেষ — বার্তা আর আসছে না। অ্যাপ খুলে ইমেইল-কোড দিয়ে আবার ঢুকুন।", "problem-401")
      }
      return false
    }
    if (r.code !in 200..299) { Store.note(ctx, if (r.code == 0) "ইন্টারনেট বা সার্ভারে পৌঁছানো যায়নি" else "সার্ভার সাড়া দেয়নি (${r.code})"); return false }
    Store.note(ctx, null)
    // The answer is in: from here on (running commands, telling the server) keep the CPU awake until it is done.
    return Awake.hold(ctx, 60_000, "commands") { handle(ctx, r.body) }
  }

  private fun handle(ctx: Context, body: String): Boolean {
    val json = JSONObject(body)
    val commands = json.optJSONArray("commands")
    val done = JSONArray()
    val failed = JSONArray()
    if (commands != null) {
      for (i in 0 until commands.length()) {
        val c = commands.getJSONObject(i)
        val id = c.getString("id")
        if (DoneCommands.has(ctx, id)) { done.put(id); continue }  // already carried out, only the "done" was lost: never send twice
        val error = run(ctx, c.optString("kind"), c.optString("target"), c.optString("body"), id)
        if (error == null) { DoneCommands.add(ctx, id); done.put(id) } else failed.put(JSONObject().put("id", id).put("error", error))
      }
      if (done.length() + failed.length() > 0) Http.call(ctx, "POST", "/device/ack", JSONObject().put("done", done).put("failed", failed).toString())
    }
    if (json.optBoolean("changed")) Bus.fire()
    return true
  }

  /** Runs one command. Returns null on success, or a short reason the owner can read. */
  private fun run(ctx: Context, kind: String, target: String, body: String, id: String): String? = try {
    if ((kind == "sms" || kind == "reply") && (body.isBlank() || body.trimStart().startsWith("enc1:"))) "উত্তরের লেখা খালি বা ভাঙা (সার্ভার থেকে ঠিকমতো আসেনি), তাই পাঠানো হয়নি"
    else when (kind) {
      "alert" -> { showAlert(ctx, target, body, id); null }
      "sms" -> {
        val sms = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        val parts = sms.divideMessage(body)
        // Ask the phone for a real "sent" result and a real "delivered" report; SmsStatusReceiver tells the server what happened.
        fun pi(action: String) = PendingIntent.getBroadcast(ctx, (id + action).hashCode(), Intent(action).setPackage(ctx.packageName).putExtra("cmd", id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val sentIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(pi(SmsStatusReceiver.SENT)) } }
        val deliveredIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(pi(SmsStatusReceiver.DELIVERED)) } }
        sms.sendMultipartTextMessage(target, null, parts, sentIntents, deliveredIntents)
        null
      }
      "reply" -> if (ReplyBoxes.send(ctx, target, body)) null else "এই চ্যাটের নোটিফিকেশন আর ফোনে নেই, তাই উত্তর-বক্স পাওয়া যায়নি। Android শুধু নোটিফিকেশন থাকা অবস্থায় উত্তর পাঠাতে দেয়: ওই মানুষ আবার লিখলে “আবার পাঠান” চাপুন, নয়তো অ্যাপটি খুলে নিজে উত্তর দিন"
      else -> "অজানা নির্দেশ"
    }
  } catch (e: SecurityException) {
    "অনুমতি নেই (${e.message?.take(60)})"
  } catch (e: Exception) {
    e.javaClass.simpleName
  }

  companion object {
    const val CH_SERVICE = "va_service"
    const val CH_URGENT = "va_urgent_v2"
    const val CH_NORMAL = "va_normal_v2"
    @Volatile var alive = false
    @Volatile private var nudge = false

    fun start(ctx: Context) {
      val i = Intent(ctx, PollService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) { ctx.stopService(Intent(ctx, PollService::class.java)) }

    fun channels(ctx: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "সহকারী চলছে", NotificationManager.IMPORTANCE_MIN))
      nm.createNotificationChannel(NotificationChannel(CH_NORMAL, "গুরুত্বপূর্ণ বার্তা", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(false) })
      val urgent = NotificationChannel(CH_URGENT, "জরুরি (অ্যালার্ম)", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "পরিবার ও সবচেয়ে জরুরি বার্তা — সাইলেন্ট মোডেও বাজে"
        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        enableVibration(false)  // vibration is done by Alert.vibrate at the strength the owner chose
        setBypassDnd(true)  // honoured only when the owner granted "Do not disturb access" in Settings
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE  // the lock screen shows "urgent", never the words
      }
      nm.createNotificationChannel(urgent)
    }

    fun showAlert(ctx: Context, target: String, text: String, id: String) {
      channels(ctx)
      val urgent = target == "p1"
      val open = PendingIntent.getActivity(ctx, 0, ctx.packageManager.getLaunchIntentForPackage(ctx.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val b = Notification.Builder(ctx, if (urgent) CH_URGENT else CH_NORMAL)
        .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(if (urgent) "🔴 জরুরি বার্তা" else "নতুন বার্তা")
        .setContentText(text.lineSequence().first().take(120)).setStyle(Notification.BigTextStyle().bigText(text))
        .setContentIntent(open).setAutoCancel(true).setCategory(if (urgent) Notification.CATEGORY_ALARM else Notification.CATEGORY_MESSAGE)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(Notification.Builder(ctx, if (urgent) CH_URGENT else CH_NORMAL).setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle(if (urgent) "জরুরি বার্তা" else "নতুন বার্তা").build())
      if (urgent) b.setFullScreenIntent(open, true)
      ctx.getSystemService(NotificationManager::class.java).notify(id.hashCode(), b.build())
      Alert.fire(ctx, target)
    }

    /** For the Settings test buttons: the same alert at an explicit strength. */
    fun test(ctx: Context, level: Int, volume: Int) { Alert.vibrate(ctx, level); Alert.louder(ctx, level, volume) }
  }
}

/** Vibration strength and alarm loudness, by how urgent the message is. */
object Alert {
  private val PATTERNS = arrayOf(
    longArrayOf(0, 120),                                              // 1 soft
    longArrayOf(0, 400, 200, 400),                                    // 2 medium
    longArrayOf(0, 900, 250, 900, 250, 1300, 250, 1300),              // 3 strong
  )
  private val AMPLITUDES = arrayOf(
    intArrayOf(0, 70),
    intArrayOf(0, 160, 0, 160),
    intArrayOf(0, 255, 0, 255, 0, 255, 0, 255),
  )

  fun fire(ctx: Context, target: String) {
    val key = when (target) { "p1" -> "p1"; "p2" -> "p2"; else -> "other" }
    val level = Store.level(ctx, key, if (key == "p1") 3 else if (key == "p2") 2 else 1)
    vibrate(ctx, level)
    if (key == "p1") louder(ctx, level, Store.prefs(ctx).getInt("alert_vol", 3))
  }

  fun vibrate(ctx: Context, level: Int) {
    if (level <= 0) return
    try {
      val v = if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(android.os.VibratorManager::class.java)).defaultVibrator else @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
      if (!v.hasVibrator()) return
      val i = (level - 1).coerceIn(0, 2)
      val effect = if (v.hasAmplitudeControl()) android.os.VibrationEffect.createWaveform(PATTERNS[i], AMPLITUDES[i], -1) else android.os.VibrationEffect.createWaveform(PATTERNS[i], -1)
      @Suppress("DEPRECATION") v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())  // alarm usage: strong, and honoured in silent mode
    } catch (_: Exception) {}
  }

  /** Raises the alarm volume for a strong alert (soft = leave it, medium = at least 70 %, strong = full). */
  fun louder(ctx: Context, level: Int, volume: Int) {
    if (level < 2) return
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
      val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM)
      val want = when (volume) { 1 -> 0.5; 2 -> 0.75; else -> 1.0 }
      val target = (max * want).toInt().coerceAtLeast(1)
      if (am.getStreamVolume(android.media.AudioManager.STREAM_ALARM) < target) am.setStreamVolume(android.media.AudioManager.STREAM_ALARM, target, 0)
    } catch (_: Exception) {}
  }
}

