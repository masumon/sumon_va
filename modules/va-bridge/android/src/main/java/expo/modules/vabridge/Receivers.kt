package expo.modules.vabridge

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Telephony
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.telephony.TelephonyManager

/**
 * Reads the notifications of the chosen chat apps. Read-only: nothing here answers anybody.
 * The one thing it remembers is each chat's reply box, so that a reply the OWNER approves in the app can be sent through
 * it with one tap — the assistant never uses it on its own.
 */
class VaNotificationListener : NotificationListenerService() {
  // The reply boxes live only in memory. When the phone restarts the app, rebuild them from the chats still in the shade,
  // so an approved reply can still go out instead of "no reply box".
  override fun onListenerConnected() { instance = this; ensureSync(); rescan() }

  // vivo (and other brands) silently drop BOOT_COMPLETED for apps without "auto-start", so after a restart sync never began
  // until the app was opened. The system itself binds this listener at boot, so it starts the sync service instead.
  private fun ensureSync() {
    try { if (Store.paired(applicationContext) && !PollService.alive) PollService.start(applicationContext) } catch (_: Exception) {}
  }
  // Android sometimes unbinds the listener on its own; ask to be bound again at once instead of silently missing messages.
  override fun onListenerDisconnected() {
    if (instance === this) instance = null
    try { NotificationListenerService.requestRebind(android.content.ComponentName(this, VaNotificationListener::class.java)) } catch (_: Exception) {}
  }

  fun rescan() {
    try {
      val ctx = applicationContext
      for (sbn in activeNotifications ?: return) {
        if (sbn.packageName !in Store.packages(ctx)) continue
        val n = sbn.notification ?: continue
        val chat = chatOf(n.extras ?: continue).first
        if (chat.isNotEmpty()) rememberReplyBox(sbn.packageName, chat, n)
      }
    } catch (_: Exception) {}
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val ctx = applicationContext
    try {
      if (!Store.paired(ctx) || sbn.packageName == ctx.packageName || sbn.packageName !in Store.packages(ctx)) return
      ensureSync()  // the phone killed the sync service? a new chat message brings it back
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      // Not a message: a running/ongoing notification (backups, calls in progress, music, downloads) or one with a progress bar.
      if (n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE or Notification.FLAG_NO_CLEAR) != 0) return
      val extras = n.extras ?: return
      if (extras.getInt(Notification.EXTRA_PROGRESS_MAX, 0) > 0 || extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE, false)) return
      if (n.category in NOT_MESSAGE_CATEGORIES) return
      val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
      val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
      if (rawTitle.isEmpty() || text.isEmpty() || SUMMARY.matches(text) || SYSTEM_TEXT.containsMatchIn(text)) return  // "3 new messages", "Preparing backup" are not messages
      if (MISSED_SUMMARY.containsMatchIn(rawTitle)) return  // "3 missed voice calls" is a count, not a person
      if (rawTitle.equals(appLabel(ctx, sbn.packageName), ignoreCase = true) && text.length < 40) return  // the app talking about itself

      val (chat, group) = chatOf(extras)
      if (chat.isEmpty()) return
      rememberReplyBox(sbn.packageName, chat, n)

      // Several messages often arrive in ONE notification: read each of them, not only the last line.
      val list = messagesOf(extras)
      val items = if (list.isNotEmpty()) list else listOf(Triple(if (group) rawTitle.substringAfter(": ", "") else "", text, sbn.postTime))
      val toAdd = ArrayList<org.json.JSONObject>()
      for ((who, body, at) in items) {
        val line = if (group && who.isNotBlank() && !body.startsWith(who)) "$who: $body" else body
        if (line.isBlank() || SYSTEM_TEXT.containsMatchIn(line)) continue
        if (Outbox.duplicate("${sbn.packageName}|$chat|$line|${at / 60000}")) continue
        val ext = "n:" + sha("${sbn.packageName}|$chat|$line|${at / 60000}")
        toAdd.add(item("msg", "notif", chat, sbn.packageName, line, ext, null, group))
      }
      // Storing and uploading can wait for the disk/network: do it on one ordered background thread so this callback returns at once.
      if (toAdd.isNotEmpty()) worker.execute {
        try {
          for (it in toAdd) Outbox.add(ctx, it)
          Awake.hold(ctx, 30_000, "notif") { Outbox.flush(ctx) }  // upload at once, even if the screen is off
        } catch (_: Exception) {}
      }
    } catch (_: Exception) {
      // A broken notification must never crash the listener.
    }
  }

  /**
   * A chat notification was dismissed (swiped away, or the chat was opened). This is NOT proof that the message was read,
   * only a hint, so the server gets a "seen" item and decides what it means. Same filters as onNotificationPosted.
   */
  override fun onNotificationRemoved(sbn: StatusBarNotification) {
    val ctx = applicationContext
    try {
      if (!Store.paired(ctx) || sbn.packageName == ctx.packageName || sbn.packageName !in Store.packages(ctx)) return
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      if (n.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE or Notification.FLAG_NO_CLEAR) != 0) return
      val extras = n.extras ?: return
      if (extras.getInt(Notification.EXTRA_PROGRESS_MAX, 0) > 0 || extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE, false)) return
      if (n.category in NOT_MESSAGE_CATEGORIES) return
      val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
      val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
      if (rawTitle.isEmpty() || text.isEmpty() || SUMMARY.matches(text) || SYSTEM_TEXT.containsMatchIn(text)) return
      if (MISSED_SUMMARY.containsMatchIn(rawTitle)) return
      if (rawTitle.equals(appLabel(ctx, sbn.packageName), ignoreCase = true) && text.length < 40) return

      val (chat, _) = chatOf(extras)
      if (chat.isEmpty()) return
      val minute = System.currentTimeMillis() / 60000
      val key = "${sbn.packageName}|$chat|$minute"
      if (Outbox.duplicate("seen|$key")) return  // one "seen" per chat per minute
      val seen = item("seen", "notif", chat, sbn.packageName, "", "s:" + sha(key), null, false)
      worker.execute {
        try {
          Outbox.add(ctx, seen)
          Awake.hold(ctx, 30_000, "notif") { Outbox.flush(ctx) }
        } catch (_: Exception) {}
      }
    } catch (_: Exception) {
      // A broken notification must never crash the listener.
    }
  }

  private fun rememberReplyBox(pkg: String, sender: String, n: Notification) {
    val action = n.actions?.firstOrNull { a -> a.remoteInputs?.isNotEmpty() == true } ?: return
    ReplyBoxes.put("notif:${pkg.take(30)}:$sender", action.actionIntent, action.remoteInputs)
  }

  /** (sender, text, time) of every message inside a chat notification, newest last; only today's, so old ones are not re-sent. */
  private fun messagesOf(extras: Bundle): List<Triple<String, String, Long>> = try {
    @Suppress("DEPRECATION") val arr = extras.getParcelableArray(Notification.EXTRA_MESSAGES) ?: emptyArray()
    val since = System.currentTimeMillis() - 24 * 3600_000L
    Notification.MessagingStyle.Message.getMessagesFromBundleArray(arr)
      .filter { it.timestamp >= since && !it.text.isNullOrBlank() }
      .map { Triple(it.senderPerson?.name?.toString() ?: "", it.text.toString().trim(), it.timestamp) }
      .takeLast(20)
  } catch (_: Exception) { emptyList() }

  /** One stable name per chat (and whether it is a group): "Team (2 messages): ~ Rahim" must stay "Team", or every new count becomes a new person. */
  private fun chatOf(extras: Bundle): Pair<String, Boolean> {
    val raw = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
    val convo = if (Build.VERSION.SDK_INT >= 28) extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()?.trim().orEmpty() else ""
    val group = Build.VERSION.SDK_INT >= 28 && (extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false) || convo.isNotBlank())
    val name = (if (convo.isNotBlank()) convo else raw).replace(COUNT, "").trim().take(60)
    return name to group
  }

  private fun appLabel(ctx: Context, pkg: String): String = try { ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { "" }

  companion object {
    @Volatile var instance: VaNotificationListener? = null
    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val NOT_MESSAGE_CATEGORIES = setOf(Notification.CATEGORY_PROGRESS, Notification.CATEGORY_SERVICE, Notification.CATEGORY_SYSTEM, Notification.CATEGORY_STATUS,
      Notification.CATEGORY_TRANSPORT, Notification.CATEGORY_CALL, Notification.CATEGORY_ALARM, Notification.CATEGORY_RECOMMENDATION, Notification.CATEGORY_PROMO, Notification.CATEGORY_NAVIGATION)
    private val SYSTEM_TEXT = Regex("(preparing|creating|restoring|uploading|backup|checking for new messages|waiting for network|connecting|syncing|end-to-end encrypted|\\d+%|ব্যাকআপ)", RegexOption.IGNORE_CASE)
    private val MISSED_SUMMARY = Regex("^\\d+\\s+missed\\s+(voice\\s+|video\\s+)?calls?", RegexOption.IGNORE_CASE)
    private val COUNT = Regex("\\s*\\(\\d+\\s+[^)]*\\)(:.*)?$")  // " (2 messages): ~ Rahim" -> ""
    private val SUMMARY = Regex("^\\d+\\s+(new\\s+)?(messages?|chats?|conversations?).*", RegexOption.IGNORE_CASE)
  }
}

object ReplyBoxes {
  private class Box(val intent: PendingIntent, val inputs: Array<RemoteInput>)

  private val boxes = LinkedHashMap<String, Box>()  // oldest first, so the 200-box limit drops the oldest chat

  // The server knows a chat as "notif:<app>:<name>" cut to 80 characters (and trimmed); the phone must use exactly the same key,
  // or a long chat name never finds its reply box again.
  private fun norm(key: String) = key.trim().take(80).trim()

  @Synchronized fun put(key: String, intent: PendingIntent, inputs: Array<RemoteInput>) { val k = norm(key); boxes.remove(k); boxes[k] = Box(intent, inputs); if (boxes.size > 200) boxes.remove(boxes.keys.first()) }

  /** Sends text through the chat app's own reply box. False when that chat has no reply box right now. */
  fun send(ctx: Context, key: String, text: String): Boolean {
    if (!has(key)) VaNotificationListener.instance?.rescan()  // not in memory: look at the chats in the shade once more
    return sendNow(ctx, key, text)
  }

  @Synchronized private fun has(key: String) = boxes.containsKey(norm(key))

  @Synchronized private fun sendNow(ctx: Context, key: String, text: String): Boolean {
    val box = boxes[norm(key)] ?: return false
    return try {
      val data = Bundle()
      for (input in box.inputs) data.putCharSequence(input.resultKey, text)
      val fill = Intent()
      RemoteInput.addResultsToIntent(box.inputs, fill, data)
      box.intent.send(ctx, 0, fill)
      true
    } catch (_: Exception) { false }
  }
}

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!Store.paired(context)) return
    val pending = goAsync()
    Thread {
      try {
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return@Thread
        parts.groupBy { it.originatingAddress ?: "অজানা" }.forEach { (from, msgs) ->
          val body = msgs.joinToString("") { it.messageBody ?: "" }
          val at = msgs.first().timestampMillis
          Outbox.add(context, item("msg", "sms", from, null, body, "s:" + sha("$from|$at|$body"), contactName(context, from)))
        }
        Outbox.flush(context)
      } catch (_: Exception) {
      } finally { pending.finish() }
    }.start()
  }
}

/** A call that rang and was never answered becomes a "missed call" message from that number. */
class CallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED || !Store.paired(context)) return
    // The ring state is kept in the encrypted prefs too, so a process kill between "ringing" and "hung up" does not lose the missed call.
    val p = Store.prefs(context)
    val now = System.currentTimeMillis()
    var since = p.getLong(K_SINCE, 0L)
    if (since != 0L && now - since > 2 * 60_000L) { since = 0L; p.edit().remove(K_SINCE).remove(K_NUMBER).remove(K_ANSWERED).apply() }  // too old to trust
    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
      TelephonyManager.EXTRA_STATE_RINGING -> {
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val e = p.edit()
        if (!number.isNullOrEmpty()) e.putString(K_NUMBER, number)
        if (since == 0L) e.putLong(K_SINCE, now)
        e.putBoolean(K_ANSWERED, false).apply()
      }
      TelephonyManager.EXTRA_STATE_OFFHOOK -> p.edit().putBoolean(K_ANSWERED, true).apply()
      TelephonyManager.EXTRA_STATE_IDLE -> {
        if (since != 0L && !p.getBoolean(K_ANSWERED, false)) {
          val from = p.getString(K_NUMBER, null) ?: "অজানা নম্বর"
          Outbox.add(context, item("call", "sms", from, null, "", "c:" + sha("$from|$since"), contactName(context, from)))
          Thread { Outbox.flush(context) }.start()
        }
        p.edit().remove(K_SINCE).remove(K_NUMBER).remove(K_ANSWERED).apply()
      }
    }
  }

  companion object {
    private const val K_SINCE = "ring_since"
    private const val K_NUMBER = "ring_number"
    private const val K_ANSWERED = "ring_answered"
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED && Store.paired(context)) PollService.start(context)
  }
}

/** The phone's own answer to "did the SMS go out / arrive": passes it to the server, which turns the tick in the app into ✓ / ✓✓ / failed. */
class SmsStatusReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("cmd") ?: return
    val pending = goAsync()
    val ok = resultCode == android.app.Activity.RESULT_OK
    Thread {
      try {
        val body = when (intent.action) {
          DELIVERED -> if (ok) org.json.JSONObject().put("delivered", org.json.JSONArray().put(id)) else null
          else -> if (ok) null else org.json.JSONObject().put("failed", org.json.JSONArray().put(org.json.JSONObject().put("id", id).put("error", "মোবাইল নেটওয়ার্কে SMS যায়নি (কোড $resultCode) — ব্যালেন্স/সিগন্যাল দেখুন")))
        }
        if (body != null) Http.call(context, "POST", "/device/ack", body.toString())
      } catch (_: Exception) {
      } finally { pending.finish() }
    }.start()
  }

  companion object {
    const val SENT = "expo.modules.vabridge.SMS_SENT"
    const val DELIVERED = "expo.modules.vabridge.SMS_DELIVERED"
  }
}

/**
 * Tells the server whether the owner is using the phone: screen on/off, last touch, significant motion (the low-power system
 * sensor other apps use too) and — only if the owner allowed location — a coarse position. Sent about once a minute, and only
 * when something changed.
 */
object Presence {
  @Volatile private var screenOn = true
  @Volatile private var touchedAt = System.currentTimeMillis()
  @Volatile private var movedAt = 0L
  @Volatile private var started = false
  @Volatile private var lastSteps = -1f
  private var lastSent = 0L
  private var lastKey = ""

  fun start(ctx: Context) {
    if (started) return
    started = true
    val app = ctx.applicationContext
    val filter = android.content.IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_USER_PRESENT) }
    app.registerReceiver(object : BroadcastReceiver() {
      override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
          Intent.ACTION_SCREEN_ON -> screenOn = true
          Intent.ACTION_SCREEN_OFF -> { screenOn = false; touchedAt = System.currentTimeMillis() }
          Intent.ACTION_USER_PRESENT -> { screenOn = true; touchedAt = System.currentTimeMillis() }
        }
        if (screenOn) touchedAt = System.currentTimeMillis()
      }
    }, filter)
    try {
      val sm0 = app.getSystemService(Context.SENSOR_SERVICE) as android.hardware.SensorManager
      val steps = sm0.getDefaultSensor(android.hardware.Sensor.TYPE_STEP_COUNTER)
      val allowed = Build.VERSION.SDK_INT < 29 || androidx.core.content.ContextCompat.checkSelfPermission(app, android.Manifest.permission.ACTIVITY_RECOGNITION) == android.content.pm.PackageManager.PERMISSION_GRANTED
      if (steps != null && allowed) {
        sm0.registerListener(object : android.hardware.SensorEventListener {
          override fun onSensorChanged(e: android.hardware.SensorEvent) { val n = e.values[0]; if (lastSteps >= 0 && n > lastSteps) movedAt = System.currentTimeMillis(); lastSteps = n }
          override fun onAccuracyChanged(s: android.hardware.Sensor?, a: Int) {}
        }, steps, android.hardware.SensorManager.SENSOR_DELAY_NORMAL, 60_000_000)  // up to 60 s batching: almost no battery
      }
    } catch (_: Exception) {}
    try {
      val sm = app.getSystemService(Context.SENSOR_SERVICE) as android.hardware.SensorManager
      val sensor = sm.getDefaultSensor(android.hardware.Sensor.TYPE_SIGNIFICANT_MOTION)
      if (sensor != null) {
        val l = object : android.hardware.TriggerEventListener() {
          override fun onTrigger(e: android.hardware.TriggerEvent?) { movedAt = System.currentTimeMillis(); sm.requestTriggerSensor(this, sensor) }  // one-shot: re-arm
        }
        sm.requestTriggerSensor(l, sensor)
      }
    } catch (_: Exception) {}
  }

  private fun position(ctx: Context): Pair<Double, Double>? {
    val ok = androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
      androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    if (!ok) return null
    return try {
      val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
      val loc = listOf("network", "passive", "gps").mapNotNull { try { lm.getLastKnownLocation(it) } catch (_: SecurityException) { null } }.maxByOrNull { it.time }
      if (loc != null && System.currentTimeMillis() - loc.time < 30 * 60_000) Pair(loc.latitude, loc.longitude) else null
    } catch (_: Exception) { null }
  }

  /** Seconds the phone has been completely still and untouched: nobody is carrying or using it. */
  // While the screen is on the owner is using the phone, so it is never "still"; the count starts from the moment the screen went off.
  fun stillForSeconds(): Long = if (screenOn) 0L else ((System.currentTimeMillis() - maxOf(movedAt, touchedAt)) / 1000).coerceAtLeast(0)

  fun report(ctx: Context) {
    val now = System.currentTimeMillis()
    val touchedAgo = ((now - touchedAt) / 1000).coerceAtLeast(0)
    val movedAgo = if (movedAt == 0L) null else ((now - movedAt) / 1000).coerceAtLeast(0)
    val pos = position(ctx)
    val key = "$screenOn|${touchedAgo / 300}|${(movedAgo ?: -1) / 300}|${pos?.first?.let { "%.2f".format(it) }}|${pos?.second?.let { "%.2f".format(it) }}"
    if (now - lastSent < 60_000 || (key == lastKey && now - lastSent < 5 * 60_000)) return
    lastSent = now; lastKey = key
    val body = org.json.JSONObject().put("screen_on", screenOn).put("interacted_ago_s", touchedAgo)
    if (movedAgo != null) body.put("moved_ago_s", movedAgo)
    if (pos != null) body.put("lat", pos.first).put("lng", pos.second)
    Http.call(ctx, "POST", "/device/presence", body.toString())
  }
}
