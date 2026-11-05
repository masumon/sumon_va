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
    try {
      channels(this)
      val note = serviceNote(this)
      // Android 15 stops a "data sync" service after 6 hours a day and never lets it start at boot: that is why sync used to die
      // after a few hours and never came back after a restart. A messaging service has neither limit (Android 14+).
      when {
        Build.VERSION.SDK_INT >= 34 -> startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        Build.VERSION.SDK_INT >= 29 -> startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else -> startForeground(1, note)
      }
    } catch (e: Exception) {
      // The phone refused a foreground start (e.g. started from the background): stop quietly instead of crashing the app.
      running = false
      alive = false
      stopSelf()
      return START_NOT_STICKY
    }
    Presence.start(this)
    if (!running) {
      running = true
      alive = true
      watchNetwork()
      // Only the newest loop may ever work: a loop from an earlier start sees the number change and leaves.
      val mine = synchronized(PollService::class.java) { ++generation }
      Thread { loop(mine) }.start()
    }
    return START_STICKY
  }

  // Safety net: if the phone ever says "time is up" for this service, stop cleanly instead of being killed with an error.
  override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

  override fun onDestroy() {
    running = false
    synchronized(PollService::class.java) { generation++ }
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

  private fun loop(mine: Int) {
    val ctx = applicationContext
    var failures = 0
    while (running && mine == generation) {
      if (nudge) { nudge = false; failures = 0 }
      try {
        if (!Store.paired(ctx)) { Thread.sleep(5000); continue }
        // Uploading and reporting run with the CPU held awake (capped), so they finish even with the screen off.
        Awake.hold(ctx, 40_000, "upload") { Outbox.flush(ctx); Presence.report(ctx) }
        failures = if (pollOnce(ctx, mine)) 0 else failures + 1
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
  private fun pollOnce(ctx: Context, mine: Int): Boolean {
    val r = Http.call(ctx, "GET", "/device/poll?wait=25", readMs = 35000)
    if (mine != generation) return false  // stopped/restarted while waiting: this answer belongs to a dead loop, never act on it
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
        if (!DoneCommands.begin(ctx, id)) continue  // another thread is running this very command right now
        try {
          val error = run(ctx, c.optString("kind"), c.optString("target"), c.optString("body"), id)
          if (error == null) { DoneCommands.add(ctx, id); done.put(id) } else failed.put(JSONObject().put("id", id).put("error", error))
        } finally { DoneCommands.finish(id) }
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
      "sms" -> { val bad = smsGuard(ctx, target); if (bad != null) bad else {
        val number = target.filter { it != ' ' && it != '-' && it != '(' && it != ')' }
        val sms = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        val parts = sms.divideMessage(body)
        // Ask the phone for a real "sent" result and a real "delivered" report; SmsStatusReceiver tells the server what happened.
        fun pi(action: String) = PendingIntent.getBroadcast(ctx, (id + action).hashCode(), Intent(action).setPackage(ctx.packageName).putExtra("cmd", id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val sentIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(pi(SmsStatusReceiver.SENT)) } }
        val deliveredIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(pi(SmsStatusReceiver.DELIVERED)) } }
        sms.sendMultipartTextMessage(number, null, parts, sentIntents, deliveredIntents)
        null
      } }
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
    const val CH_PROBLEM = "va_problem_v1"
    private const val ACCENT = 0xFF6D3FD1.toInt()
    @Volatile var alive = false
    @Volatile private var nudge = false
    @Volatile private var generation = 0

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
      // The app's own "something is wrong" notes: visible, but never an alarm and never past Do-not-disturb.
      nm.createNotificationChannel(NotificationChannel(CH_PROBLEM, "অ্যাপের সমস্যা", NotificationManager.IMPORTANCE_DEFAULT).apply { enableVibration(false) })
      val urgent = NotificationChannel(CH_URGENT, "জরুরি (অ্যালার্ম)", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "পরিবার ও সবচেয়ে জরুরি বার্তা — সাইলেন্ট মোডেও বাজে"
        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        enableVibration(false)  // vibration is done by Alert.vibrate at the strength the owner chose
        setBypassDnd(true)  // honoured only when the owner granted "Do not disturb access" in Settings
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE  // the lock screen shows "urgent", never the words
      }
      nm.createNotificationChannel(urgent)
    }

    /** The app's own monochrome status icon (configured in app.json); a system icon if it is missing. */
    private fun smallIcon(ctx: Context): Int {
      val id = try { ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName) } catch (_: Exception) { 0 }
      return if (id != 0) id else android.R.drawable.stat_notify_chat
    }

    private fun openIntent(ctx: Context, code: Int): PendingIntent? {
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
      return PendingIntent.getActivity(ctx, code, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun openAction(ctx: Context): Notification.Action? {
      val pi = openIntent(ctx, 1) ?: return null
      return Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(ctx, smallIcon(ctx)), "খুলুন", pi).build()
    }

    private fun healthy(ctx: Context) = try { Store.prefs(ctx).getString("last_error", null) == null } catch (_: Exception) { true }

    /** The quiet "running" notification the foreground service must show. */
    fun serviceNote(ctx: Context): Notification {
      val b = Notification.Builder(ctx, CH_SERVICE).setContentTitle("সহকারী চলছে")
        .setContentText("বার্তার দিকে নজর রাখছি").setSmallIcon(smallIcon(ctx)).setColor(if (healthy(ctx)) 0xFF2E7D32.toInt() else 0xFFB26A00.toInt()).setOngoing(true).setOnlyAlertOnce(true)
      openIntent(ctx, 0)?.let { b.setContentIntent(it) }
      openAction(ctx)?.let { b.addAction(it) }
      return b.build()
    }

    /** What an alert looks like on the phone, taken apart from the server's text. `plain` is the words-free version. */
    class Parsed(val title: String, val text: String, val sub: String, val plain: String, val ok: Boolean)

    /**
     * Server text: first line "<icon> <platform> · <who> · <priority label>", optional second part after a new line.
     * Family: "👪 পরিবার · <who> — <label> (ভেতরের কথা ...)". App problems start with the warning sign.
     */
    fun parse(urgent: Boolean, text: String): Parsed {
      val fallbackTitle = if (urgent) "জরুরি বার্তা" else "নতুন বার্তা"
      val first = text.lineSequence().first().trim()
      val fb = Parsed(fallbackTitle, first.take(120), "", first.take(120), false)
      try {
        if (text.startsWith("⚠ ")) {
          val t = text.removePrefix("⚠ ").trim().take(200)
          return Parsed("অ্যাপের সমস্যা", t, "", t, true)
        }
        if (first.startsWith("👪")) {
          val m = Regex("^👪\\s*([^·]+?)\\s*·\\s*(.+?)\\s*—\\s*(.+?)(?:\\s*\\(ভেতরের কথা.*)?$").find(first) ?: return fb
          val platform = m.groupValues[1].trim()
          val who = m.groupValues[2].trim()
          val label = m.groupValues[3].trim()
          if (who.isEmpty()) return fb
          return Parsed(who, label, platform, label, true)
        }
        val parts = first.split(" · ").map { it.trim() }
        if (parts.size < 3) return fb
        val head = parts[0]
        val platform = (if (head.contains(' ') && head.substringBefore(' ').none { it.isLetterOrDigit() }) head.substringAfter(' ') else head).trim()
        val who = parts.subList(1, parts.size - 1).joinToString(" · ")
        val label = parts.last()
        if (who.isEmpty() || label.isEmpty()) return fb
        val summary = text.substringAfter('\n', "").trim()
        val shown = (if (summary.isNotEmpty()) summary else label).take(200)
        return Parsed(who, shown, platform, label, true)
      } catch (_: Exception) { return fb }
    }

    fun showAlert(ctx: Context, target: String, text: String, id: String) {
      channels(ctx)
      val urgent = target == "p1"
      val problem = target == "p3" && id.startsWith("problem-")
      val channel = if (urgent) CH_URGENT else if (problem) CH_PROBLEM else CH_NORMAL
      val open = openIntent(ctx, 0)
      val p = parse(urgent, text)
      val family = text.startsWith("👪")
      val zone = zoneOf(target, id)
      val color = zoneColor(zone)
      val plainFamily = if (p.ok) p.plain else "পরিবারের বার্তা"
      val shownText = if (family) plainFamily else if (p.ok) p.text else text.lineSequence().first().take(120)
      val bigText = if (family) plainFamily else if (p.ok) p.text else text
      val title = if (p.ok) p.title else if (urgent) "জরুরি বার্তা" else "নতুন বার্তা"
      val chip = zoneWord(zone) + (if (p.ok && p.sub.isNotEmpty()) " · " + p.sub else "")
      val letter = if (family) "প" else if (problem) "!" else (title.firstOrNull { it.isLetterOrDigit() }?.toString() ?: "ব")
      val b = Notification.Builder(ctx, channel)
        .setSmallIcon(smallIcon(ctx)).setColor(color).setShowWhen(true).setWhen(System.currentTimeMillis())
        .setContentTitle(title)
        .setContentText(shownText)
        .setSubText(chip)
        .setStyle(Notification.BigTextStyle().bigText(bigText))
        .setAutoCancel(true).setCategory(if (urgent) Notification.CATEGORY_ALARM else Notification.CATEGORY_MESSAGE)
        .setVisibility(Notification.VISIBILITY_PRIVATE)
        .setPublicVersion(Notification.Builder(ctx, channel).setSmallIcon(smallIcon(ctx)).setColor(color).setContentTitle(if (urgent) "জরুরি বার্তা" else if (problem) "অ্যাপের সমস্যা" else "নতুন বার্তা").build())
      letterIcon(letter, color)?.let { b.setLargeIcon(it) }
      val groupKey = if (p.ok && p.sub.isNotEmpty()) "va_" + p.sub else null
      if (groupKey != null) b.setGroup(groupKey)
      if (open != null) b.setContentIntent(open)
      openAction(ctx)?.let { b.addAction(it) }
      if (zone != "info") inboxAction(ctx)?.let { b.addAction(it) }
      if (urgent && open != null) b.setFullScreenIntent(open, true)
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.notify(id.hashCode(), b.build())
      if (groupKey != null) postSummary(ctx, nm, groupKey, p.sub, open)
      try { addHistory(ctx, id, p, if (family) plainFamily else p.text, target, zone) } catch (_: Exception) {}
      Alert.fire(ctx, target)
    }

    // ---- colour zones: the colour always says how serious it is ----
    private const val RED = 0xFFC62828.toInt()
    private const val AMBER = 0xFFB26A00.toInt()
    private const val BLUE = 0xFF1565C0.toInt()
    private const val GREEN = 0xFF2E7D32.toInt()

    private fun zoneOf(target: String, id: String): String =
      if (target == "p1" || id == "problem-401") "danger" else if (target == "p2" || id.startsWith("problem-")) "warning" else "info"
    private fun zoneColor(zone: String) = when (zone) { "danger" -> RED; "warning" -> AMBER; else -> BLUE }
    private fun zoneWord(zone: String) = when (zone) { "danger" -> "জরুরি"; "warning" -> "গুরুত্বপূর্ণ"; else -> "নতুন বার্তা" }

    /** A round picture in the zone colour with one white letter (never message words). */
    private fun letterIcon(letter: String, color: Int): android.graphics.Bitmap? = try {
      val size = 128
      val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
      val cv = android.graphics.Canvas(bmp)
      val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
      paint.color = color
      cv.drawCircle(size / 2f, size / 2f, size / 2f, paint)
      paint.color = android.graphics.Color.WHITE
      paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
      paint.textSize = 66f
      paint.textAlign = android.graphics.Paint.Align.CENTER
      val fm = paint.fontMetrics
      cv.drawText(letter, size / 2f, size / 2f - (fm.ascent + fm.descent) / 2f, paint)
      bmp
    } catch (_: Throwable) { null }

    private fun inboxAction(ctx: Context): Notification.Action? = try {
      val i = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("sumonva://inbox")).setPackage(ctx.packageName)
      val pi = PendingIntent.getActivity(ctx, 2, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(ctx, smallIcon(ctx)), "ইনবক্স", pi).build()
    } catch (_: Exception) { null }

    /** One quiet summary per group so Android really stacks the alerts of one app. It never alerts and holds no message words. */
    private fun postSummary(ctx: Context, nm: NotificationManager, groupKey: String, platform: String, open: PendingIntent?) {
      try {
        val sb = Notification.Builder(ctx, CH_NORMAL)
          .setSmallIcon(smallIcon(ctx)).setColor(BLUE).setContentTitle(platform).setContentText("নতুন বার্তা")
          .setGroup(groupKey).setGroupSummary(true).setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
          .setOnlyAlertOnce(true).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE)
        if (open != null) sb.setContentIntent(open)
        nm.notify(("summary:" + groupKey).hashCode(), sb.build())
      } catch (_: Exception) {}
    }

    // ---- alert history (for the in-app notification centre) ----
    private val historyLock = Any()

    private fun addHistory(ctx: Context, id: String, p: Parsed, text: String, target: String, zone: String) = synchronized(historyLock) {
      val arr = loadHistory(ctx)
      arr.put(JSONObject().put("id", id.take(80)).put("title", p.title.take(200)).put("text", text.take(200)).put("sub", p.sub.take(200)).put("target", target).put("zone", zone).put("at", System.currentTimeMillis()))
      val out = JSONArray()
      for (i in maxOf(0, arr.length() - 50) until arr.length()) out.put(arr.get(i))
      Store.prefs(ctx).edit().putString("alert_history", out.toString()).apply()
    }

    private fun loadHistory(ctx: Context): JSONArray = try { JSONArray(Store.prefs(ctx).getString("alert_history", "[]")) } catch (_: Exception) { JSONArray() }

    /** Oldest first. */
    fun history(ctx: Context): List<JSONObject> = synchronized(historyLock) {
      val a = loadHistory(ctx)
      (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }

    fun clearHistory(ctx: Context) = synchronized(historyLock) { Store.prefs(ctx).edit().remove("alert_history").apply() }

    /** Only a normal phone number may receive an SMS, and at most 30 an hour. Returns the Bangla reason when refused, null when allowed. */
    @Synchronized fun smsGuard(ctx: Context, target: String): String? {
      val number = target.filter { it != ' ' && it != '-' && it != '(' && it != ')' }
      if (!Regex("^\\+?[0-9]{8,15}$").matches(number)) return "এটা সাধারণ ফোন নম্বর নয়, তাই SMS পাঠানো হয়নি"
      val p = Store.prefs(ctx)
      val now = System.currentTimeMillis()
      val times = (p.getString("sms_times", "") ?: "").split(',').mapNotNull { it.toLongOrNull() }.filter { now - it < 3600_000L && it <= now }
      if (times.size >= 30) return "ঘণ্টায় ৩০টির বেশি SMS পাঠানো যায় না"
      p.edit().putString("sms_times", (times + now).joinToString(",")).apply()
      return null
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

  /** Danger: SOS-like (three short, three long, three short), twice, at full strength — about 8 seconds. */
  private fun sosTimings(): LongArray {
    val l = ArrayList<Long>()
    l.add(0L)
    repeat(2) {
      repeat(3) { l.add(140L); l.add(100L) }; l[l.size - 1] = 260L
      repeat(3) { l.add(440L); l.add(120L) }; l[l.size - 1] = 260L
      repeat(3) { l.add(140L); l.add(100L) }; l[l.size - 1] = 400L
    }
    return l.toLongArray()
  }

  private fun vibrateDanger(ctx: Context, level: Int) {
    try {
      val v = if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(android.os.VibratorManager::class.java)).defaultVibrator else @Suppress("DEPRECATION") ctx.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
      if (!v.hasVibrator()) return
      val t = sosTimings()
      val amp = if (level >= 3) 255 else 200
      val effect = if (v.hasAmplitudeControl()) android.os.VibrationEffect.createWaveform(t, IntArray(t.size) { if (it % 2 == 1) amp else 0 }, -1) else android.os.VibrationEffect.createWaveform(t, -1)
      @Suppress("DEPRECATION") v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
    } catch (_: Exception) {}
  }

  fun fire(ctx: Context, target: String) {
    val key = when (target) { "p1" -> "p1"; "p2" -> "p2"; else -> "other" }
    val level = Store.level(ctx, key, if (key == "p1") 3 else if (key == "p2") 2 else 1).let { if (key == "p1") it.coerceAtLeast(2) else it }
    if (key == "p1") vibrateDanger(ctx, level) else vibrate(ctx, level)
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
      val before = am.getStreamVolume(android.media.AudioManager.STREAM_ALARM)
      if (before < target) {
        am.setStreamVolume(android.media.AudioManager.STREAM_ALARM, target, 0)
        // Give the owner's own alarm volume back after the alert, unless he changed it meanwhile.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
          try { if (am.getStreamVolume(android.media.AudioManager.STREAM_ALARM) == target) am.setStreamVolume(android.media.AudioManager.STREAM_ALARM, before, 0) } catch (_: Exception) {}
        }, 45_000)
      }
    } catch (_: Exception) {}
  }
}

