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

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    channels(this)
    val note = Notification.Builder(this, CH_SERVICE).setContentTitle("সুমনের ভার্চুয়াল সহকারী চলছে")
      .setContentText("বার্তার দিকে নজর রাখছি").setSmallIcon(android.R.drawable.stat_notify_sync).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(1, note)
    if (!running) {
      running = true
      alive = true
      Thread { loop() }.start()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    alive = false
    super.onDestroy()
  }

  private fun loop() {
    val ctx = applicationContext
    while (running) {
      try {
        if (Store.paired(ctx)) {
          Outbox.flush(ctx)
          pollOnce(ctx)
        }
      } catch (e: Exception) {
        Store.note(ctx, "সিঙ্ক ব্যর্থ: ${e.javaClass.simpleName}")
      }
      try { Thread.sleep(Store.pollSeconds(ctx) * 1000L) } catch (_: InterruptedException) { return }
    }
  }

  private fun pollOnce(ctx: Context) {
    val r = Http.call(ctx, "GET", "/device/poll")
    if (r.code == 401) { Store.note(ctx, "ফোনের অনুমতি বাতিল বা মেয়াদ শেষ — আবার জোড়া লাগান"); return }
    if (r.code !in 200..299) { Store.note(ctx, "সার্ভারে পৌঁছানো যায়নি (${r.code})"); return }
    Store.note(ctx, null)
    val commands = JSONObject(r.body).optJSONArray("commands") ?: return
    val done = JSONArray()
    val failed = JSONArray()
    for (i in 0 until commands.length()) {
      val c = commands.getJSONObject(i)
      val id = c.getString("id")
      val error = run(ctx, c.optString("kind"), c.optString("target"), c.optString("body"), id)
      if (error == null) done.put(id) else failed.put(JSONObject().put("id", id).put("error", error))
    }
    if (done.length() + failed.length() > 0) Http.call(ctx, "POST", "/device/ack", JSONObject().put("done", done).put("failed", failed).toString())
  }

  /** Runs one command. Returns null on success, or a short reason the owner can read. */
  private fun run(ctx: Context, kind: String, target: String, body: String, id: String): String? = try {
    when (kind) {
      "alert" -> { showAlert(ctx, target, body, id); null }
      "sms" -> {
        val sms = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        sms.sendMultipartTextMessage(target, null, sms.divideMessage(body), null, null)
        null
      }
      "reply" -> if (ReplyBoxes.send(ctx, target, body)) null else "সেই চ্যাটের উত্তর-বক্স এখন নেই — অ্যাপটি খুলে নিজে উত্তর দিন"
      else -> "অজানা নির্দেশ"
    }
  } catch (e: SecurityException) {
    "অনুমতি নেই (${e.message?.take(60)})"
  } catch (e: Exception) {
    e.javaClass.simpleName
  }

  companion object {
    const val CH_SERVICE = "va_service"
    const val CH_URGENT = "va_urgent"
    const val CH_NORMAL = "va_normal"
    @Volatile var alive = false

    fun start(ctx: Context) {
      val i = Intent(ctx, PollService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) { ctx.stopService(Intent(ctx, PollService::class.java)) }

    fun channels(ctx: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "সহকারী চলছে", NotificationManager.IMPORTANCE_MIN))
      nm.createNotificationChannel(NotificationChannel(CH_NORMAL, "গুরুত্বপূর্ণ বার্তা", NotificationManager.IMPORTANCE_HIGH))
      val urgent = NotificationChannel(CH_URGENT, "জরুরি (অ্যালার্ম)", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "পরিবার ও সবচেয়ে জরুরি বার্তা — সাইলেন্ট মোডেও বাজে"
        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 900)
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
    }
  }
}
