package expo.modules.vabridge

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Everything the phone side shares: encrypted storage, the HTTP helper, the offline queue and the list of chat apps.
 * The device token lives only in `Store` (Android Keystore backed). JavaScript asks `request()` to call the server and
 * never receives the token itself.
 */
object Store {
  @Volatile private var cached: SharedPreferences? = null

  fun prefs(context: Context): SharedPreferences {
    cached?.let { return it }
    synchronized(this) {
      cached?.let { return it }
      val app = context.applicationContext
      val key = MasterKey.Builder(app).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
      val p = EncryptedSharedPreferences.create(
        app, "va_secure", key,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
      cached = p
      return p
    }
  }

  fun baseUrl(c: Context) = prefs(c).getString("base", null)
  fun token(c: Context) = prefs(c).getString("token", null)
  fun paired(c: Context) = !baseUrl(c).isNullOrEmpty() && !token(c).isNullOrEmpty()
  fun setPaired(c: Context, base: String, token: String) = prefs(c).edit().putString("base", base).putString("token", token).apply()
  fun clear(c: Context) = prefs(c).edit().remove("token").remove("queue").remove("account_name").remove("account_email").apply()
  fun setAccount(c: Context, name: String?, email: String?) = prefs(c).edit().putString("account_name", name).putString("account_email", email).apply()

  fun note(c: Context, error: String?) {
    val e = prefs(c).edit().putLong("last_try", System.currentTimeMillis())
    if (error == null) e.putLong("last_ok", System.currentTimeMillis()).remove("last_error") else e.putString("last_error", error.take(200))
    e.apply()
  }

  /** The apps whose notifications are read. The owner can change this list in Settings. */
  val DEFAULT_PACKAGES = setOf(
    "com.whatsapp", "com.whatsapp.w4b", "com.facebook.orca", "com.facebook.mlite", "com.instagram.android",
    "org.telegram.messenger", "org.thunderdog.challegram", "com.imo.android.imoim", "com.viber.voip",
    "org.thoughtcrime.securesms", "jp.naver.line.android", "com.google.android.gm",
  )

  fun packages(c: Context): Set<String> = prefs(c).getStringSet("packages", null) ?: DEFAULT_PACKAGES
  fun setPackages(c: Context, list: Set<String>) = prefs(c).edit().putStringSet("packages", list).apply()
  fun pollSeconds(c: Context) = prefs(c).getInt("poll_s", 20).coerceIn(10, 300)
  fun setPollSeconds(c: Context, s: Int) = prefs(c).edit().putInt("poll_s", s.coerceIn(10, 300)).apply()
}

/** Tells the open app screens "something changed, reload now" — the real-time link between the service and the screens. */
object Bus {
  @Volatile var listener: (() -> Unit)? = null
  fun fire() { try { listener?.invoke() } catch (_: Exception) {} }
}

object Http {
  class Resp(val code: Int, val body: String)

  /** Calls `<base>/api/v1<path>` with the device token. https only. Never throws: failures come back as code 0. */
  fun call(c: Context, method: String, path: String, body: String? = null, auth: Boolean = true, baseOverride: String? = null, readMs: Int = 20000): Resp {
    val base = baseOverride ?: Store.baseUrl(c) ?: return Resp(0, "not paired")
    if (!base.startsWith("https://")) return Resp(0, "https required")
    return try {
      val conn = (URL("$base/api/v1$path").openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 15000
        readTimeout = readMs
        setRequestProperty("Accept", "application/json")
        if (auth) setRequestProperty("Authorization", "Bearer " + (Store.token(c) ?: ""))
        if (body != null) {
          doOutput = true
          setRequestProperty("Content-Type", "application/json; charset=utf-8")
          outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
      }
      val code = conn.responseCode
      val stream = if (code in 200..399) conn.inputStream else conn.errorStream
      Resp(code, stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "")
    } catch (e: Exception) {
      Resp(0, e.javaClass.simpleName)
    }
  }
}

/** Messages that could not be uploaded yet (no internet): kept encrypted and sent later, oldest first. */
object Outbox {
  private const val MAX = 500
  private val lock = Any()
  private val recent = LinkedHashMap<String, Long>()

  /** True when the same text from the same sender was just seen (chat apps re-post one notification several times). */
  fun duplicate(key: String): Boolean = synchronized(recent) {
    val now = System.currentTimeMillis()
    recent.entries.removeAll { now - it.value > 10 * 60_000 }
    if (recent.containsKey(key)) true else { recent[key] = now; false }
  }

  fun add(c: Context, item: JSONObject) = synchronized(lock) {
    val arr = load(c)
    arr.put(item)
    while (arr.length() > MAX) arr.remove(0)
    Store.prefs(c).edit().putString("queue", arr.toString()).apply()
  }

  private fun load(c: Context): JSONArray = try { JSONArray(Store.prefs(c).getString("queue", "[]")) } catch (_: Exception) { JSONArray() }

  fun size(c: Context) = synchronized(lock) { load(c).length() }

  /** Upload up to 50 waiting items. A rejected token pauses everything and tells the owner to pair again. */
  fun flush(c: Context): Boolean = synchronized(lock) {
    if (!Store.paired(c)) return false
    val arr = load(c)
    if (arr.length() == 0) return true
    val batch = JSONArray()
    for (i in 0 until minOf(50, arr.length())) batch.put(arr.get(i))
    val r = Http.call(c, "POST", "/device/ingest", JSONObject().put("items", batch).toString())
    return when {
      r.code in 200..299 -> {
        val rest = JSONArray()
        for (i in batch.length() until arr.length()) rest.put(arr.get(i))
        Store.prefs(c).edit().putString("queue", rest.toString()).apply()
        Store.note(c, null)
        true
      }
      r.code == 401 -> { Store.note(c, "ফোনের অনুমতি বাতিল বা মেয়াদ শেষ — আবার জোড়া লাগান"); false }
      else -> { Store.note(c, "সার্ভারে পৌঁছানো যায়নি (${r.code})"); false }
    }
  }
}

fun sha(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }.take(24)

/** One message for the server. `sender` is a phone number (SMS/call) or the name the chat app shows. */
fun item(type: String, channel: String, sender: String, app: String?, body: String, ext: String, name: String? = null): JSONObject =
  JSONObject().put("type", type).put("channel", channel).put("sender", sender.take(60)).put("body", body.take(4000))
    .put("ext_id", ext.take(80)).put("at", System.currentTimeMillis()).apply {
      if (app != null) put("app", app.take(60))
      if (!name.isNullOrBlank()) put("name", name.take(120))
    }

/** The name saved for this number in the phone's contacts (needs the Contacts permission; null otherwise). */
fun contactName(c: Context, number: String): String? {
  if (androidx.core.content.ContextCompat.checkSelfPermission(c, android.Manifest.permission.READ_CONTACTS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return null
  return try {
    val uri = android.net.Uri.withAppendedPath(android.provider.ContactsContract.PhoneLookup.CONTENT_FILTER_URI, android.net.Uri.encode(number))
    c.contentResolver.query(uri, arrayOf(android.provider.ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
  } catch (_: Exception) { null }
}
