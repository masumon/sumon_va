package expo.modules.vabridge

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val ctx = applicationContext
    try {
      if (!Store.paired(ctx) || sbn.packageName == ctx.packageName || sbn.packageName !in Store.packages(ctx)) return
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      val extras = n.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
      val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim().orEmpty()
      if (title.isEmpty() || text.isEmpty() || SUMMARY.matches(text)) return  // "3 new messages" is not a message
      rememberReplyBox(sbn.packageName, title, n)
      if (Outbox.duplicate("${sbn.packageName}|$title|$text")) return
      val ext = "n:" + sha("${sbn.packageName}|$title|$text|${sbn.postTime / 60000}")
      Outbox.add(ctx, item("msg", "notif", title, sbn.packageName, text, ext))
      Thread { Outbox.flush(ctx) }.start()
    } catch (_: Exception) {
      // A broken notification must never crash the listener.
    }
  }

  private fun rememberReplyBox(pkg: String, sender: String, n: Notification) {
    val action = n.actions?.firstOrNull { a -> a.remoteInputs?.isNotEmpty() == true } ?: return
    ReplyBoxes.put("notif:${pkg.take(30)}:$sender", action.actionIntent, action.remoteInputs)
  }

  companion object {
    private val SUMMARY = Regex("^\\d+\\s+(new\\s+)?(messages?|chats?|conversations?).*", RegexOption.IGNORE_CASE)
  }
}

object ReplyBoxes {
  private class Box(val intent: PendingIntent, val inputs: Array<RemoteInput>)

  private val boxes = HashMap<String, Box>()

  @Synchronized fun put(key: String, intent: PendingIntent, inputs: Array<RemoteInput>) { boxes[key] = Box(intent, inputs); if (boxes.size > 200) boxes.remove(boxes.keys.first()) }

  /** Sends text through the chat app's own reply box. False when that chat has no reply box right now. */
  @Synchronized fun send(ctx: Context, key: String, text: String): Boolean {
    val box = boxes[key] ?: return false
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
          Outbox.add(context, item("msg", "sms", from, null, body, "s:" + sha("$from|$at|$body")))
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
    when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
      TelephonyManager.EXTRA_STATE_RINGING -> {
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        if (!number.isNullOrEmpty() || ringingSince == 0L) { ringingNumber = number ?: ringingNumber }
        if (ringingSince == 0L) ringingSince = System.currentTimeMillis()
        answered = false
      }
      TelephonyManager.EXTRA_STATE_OFFHOOK -> answered = true
      TelephonyManager.EXTRA_STATE_IDLE -> {
        if (ringingSince != 0L && !answered) {
          val from = ringingNumber ?: "অজানা নম্বর"
          val since = ringingSince
          Outbox.add(context, item("call", "sms", from, null, "", "c:" + sha("$from|$since")))
          Thread { Outbox.flush(context) }.start()
        }
        ringingSince = 0L; ringingNumber = null; answered = false
      }
    }
  }

  companion object {
    @Volatile private var ringingSince = 0L
    @Volatile private var ringingNumber: String? = null
    @Volatile private var answered = false
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED && Store.paired(context)) PollService.start(context)
  }
}
