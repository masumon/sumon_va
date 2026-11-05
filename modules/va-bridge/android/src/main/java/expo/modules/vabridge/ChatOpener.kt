package expo.modules.vabridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract

/**
 * One rule for every chat app: "reply any time". When the app's own reply box is gone (Android only keeps it while the chat's
 * notification lives), the owner can still open THAT person's chat in THAT app with the answer ready, from the assistant.
 *
 * Order, same for all apps:  1. open the person's chat directly (where the app has a public link for it)
 *                            2. otherwise open the app's own "share text" screen (the owner picks the person)
 *                            3. otherwise just open the app.
 * In every case the text is also on the clipboard, so the owner can always paste it. Nothing is sent by this code: the owner
 * presses the app's own Send button.
 */
object ChatOpener {
  private val WHATSAPP = setOf("com.whatsapp", "com.whatsapp.w4b")
  private val TELEGRAM = setOf("org.telegram.messenger", "org.thunderdog.challegram")

  private val LOOKS_LIKE_NUMBER = Regex("^\\+?[0-9][0-9 ()\\-]{6,}$")

  /** Digits with the country code (Bangladesh numbers get 880), or null when the person's number is not known. */
  fun numberFor(ctx: Context, name: String): String? {
    val trimmed = name.trim()
    val raw = if (LOOKS_LIKE_NUMBER.matches(trimmed)) trimmed else lookupInContacts(ctx, trimmed)
    return raw?.let(::normalize)
  }

  private fun lookupInContacts(ctx: Context, name: String): String? {
    if (androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.READ_CONTACTS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return null
    return try {
      ctx.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
        "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ? COLLATE NOCASE", arrayOf(name), null,
      )?.use {
        // Two different people (or two numbers) with this name: guessing would open the WRONG chat, so say "unknown".
        val found = LinkedHashMap<String, String>()
        while (it.moveToNext()) { val raw = it.getString(0) ?: continue; val n = normalize(raw) ?: continue; found.putIfAbsent(n, raw) }
        if (found.size == 1) found.values.first() else null
      }
    } catch (_: Exception) { null }
  }

  private fun normalize(raw: String): String? {
    var d = raw.filter { it.isDigit() }
    if (d.startsWith("00")) d = d.drop(2)
    d = when {
      d.startsWith("880") -> d
      d.startsWith("01") && d.length == 11 -> "88$d"
      d.length == 10 && d.startsWith("1") -> "880$d"
      else -> d
    }
    return if (d.length in 8..15) d else null
  }

  /** @return "chat" (that person's chat opened), "share" (the app's share screen), "app" (just the app) or "none". */
  fun open(ctx: Context, pkg: String, name: String, text: String): Pair<String, Boolean> {
    try {
      val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      cm.setPrimaryClip(ClipData.newPlainText("reply", text))
      // The answer should not stay on the clipboard for ever: clear it after a minute if it is still ours (best effort).
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        try {
          val mine = cm.primaryClipDescription?.label?.toString() == "reply"
          val same = cm.primaryClip?.getItemAt(0)?.text?.toString()?.let { it == text } ?: true
          if (mine && same) {
            if (android.os.Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip() else cm.setPrimaryClip(ClipData.newPlainText("", ""))
          }
        } catch (_: Exception) {}
      }, 60_000)
    } catch (_: Exception) { /* the clipboard is only a safety net */ }

    val number = numberFor(ctx, name)
    val direct: Intent? = when {
      number == null -> null
      pkg in WHATSAPP -> Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$number?text=${Uri.encode(text)}"))
      pkg in TELEGRAM -> Intent(Intent.ACTION_VIEW, Uri.parse("tg://resolve?phone=$number"))
      pkg == "com.viber.voip" -> Intent(Intent.ACTION_VIEW, Uri.parse("viber://chat?number=${Uri.encode("+$number")}"))
      else -> null
    }
    fun start(i: Intent): Boolean = try { ctx.startActivity(i.setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }

    if (direct != null && start(direct)) return "chat" to true
    val share = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    if (start(share)) return "share" to (number != null)
    val launch = ctx.packageManager.getLaunchIntentForPackage(pkg)
    if (launch != null && start(launch)) return "app" to (number != null)
    return "none" to (number != null)
  }
}
