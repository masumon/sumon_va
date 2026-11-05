package expo.modules.vabridge

import android.app.Activity
import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.exceptions.domerrors.InvalidStateError
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Passkey (Google Password Manager / Credential Manager) sign-in and registration.
 * The device token is saved natively, exactly like the other sign-in paths: JavaScript never sees it.
 * Every function returns a map: ok (Boolean), name (String?), error (String?), cancelled (Boolean?). Never throws.
 */
object PasskeyHelper {
  private const val NO_PASSKEY = "এই ফোনে পাসকি এখনও বানানো হয়নি — অন্যভাবে ঢুকে “পাসকি বানান” চাপুন"
  private const val NO_NET = "ইন্টারনেট নেই বা সার্ভারে পৌঁছানো যাচ্ছে না"
  private const val BAD_SERVER = "সার্ভার ভুল উত্তর দিয়েছে"

  private fun fail(msg: String): Map<String, Any> = mapOf("ok" to false, "error" to msg)
  private fun cancelled(): Map<String, Any> = mapOf("ok" to false, "cancelled" to true)

  /** The server may wrap its answer in {"data": {...}}. */
  private fun unwrap(body: String): JSONObject {
    val j = JSONObject(body)
    return j.optJSONObject("data") ?: j
  }

  private fun detail(body: String): String = try { JSONObject(body).optString("detail") } catch (_: Exception) { "" }

  /** Pulls "options" out as JSON text (the server may send an object or a string). */
  private fun optionsText(j: JSONObject): String? {
    val o = j.opt("options")
    return when (o) {
      is JSONObject -> o.toString()
      is String -> o.takeIf { it.isNotBlank() }
      else -> null
    }
  }

  private class Box<T> { @Volatile var value: T? = null; @Volatile var error: Exception? = null }

  fun login(ctx: Context, activity: Activity, base: String, name: String): Map<String, Any> {
    val c = ctx.applicationContext
    val clean = base.trimEnd('/')
    if (!clean.startsWith("https://")) return fail("https ঠিকানা লাগবে")
    try {
      val r = Http.call(c, "POST", "/device/passkey/options", "{}", auth = false, baseOverride = clean)
      if (r.code == 0) return fail(NO_NET)
      if (r.code !in 200..299) return fail(detail(r.body).ifEmpty { "পাসকি শুরু করা যায়নি (${r.code})" })
      val j = unwrap(r.body)
      val options = optionsText(j) ?: return fail(BAD_SERVER)
      val challengeToken = j.optString("token")
      if (challengeToken.isEmpty()) return fail(BAD_SERVER)

      val box = Box<GetCredentialResponse>()
      val latch = CountDownLatch(1)
      val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options)))
      activity.runOnUiThread {
        try {
          CredentialManager.create(activity).getCredentialAsync(activity, request, null, activity.mainExecutor,
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
              override fun onResult(result: GetCredentialResponse) { box.value = result; latch.countDown() }
              override fun onError(e: GetCredentialException) { box.error = e; latch.countDown() }
            })
        } catch (e: Exception) { box.error = e; latch.countDown() }
      }
      if (!latch.await(120, TimeUnit.SECONDS)) return fail("সময় শেষ হয়ে গেছে, আবার চেষ্টা করুন")
      box.error?.let { return mapGetError(it) }
      val cred = box.value?.credential as? PublicKeyCredential ?: return fail("পাসকি পাওয়া যায়নি")

      val body = JSONObject().put("token", challengeToken).put("credential", JSONObject(cred.authenticationResponseJson))
        .put("name", name.take(80)).put("app_version", appVersion(c))
      val v = Http.call(c, "POST", "/device/passkey/verify", body.toString(), auth = false, baseOverride = clean)
      return when {
        v.code in 200..299 -> {
          val json = unwrap(v.body)
          val token = json.optString("token")
          if (token.isEmpty()) return fail(BAD_SERVER)
          val owner = json.optString("name")
          Store.setPaired(c, clean, token)
          Store.setAccount(c, owner, null)
          PollService.start(c)
          mapOf("ok" to true, "name" to owner)
        }
        v.code == 0 -> fail(NO_NET)
        v.code == 401 -> fail(detail(v.body).ifEmpty { "এই পাসকি চেনা যায়নি" })
        else -> fail(detail(v.body).ifEmpty { "লগইন হয়নি (${v.code})" })
      }
    } catch (e: Exception) {
      return fail("পাসকি দিয়ে ঢোকা যায়নি")
    }
  }

  fun register(ctx: Context, activity: Activity, base: String): Map<String, Any> {
    val c = ctx.applicationContext
    val clean = base.trimEnd('/')
    if (!clean.startsWith("https://")) return fail("https ঠিকানা লাগবে")
    if (!Store.paired(c)) return fail("আগে লগইন করুন")
    try {
      val r = Http.call(c, "POST", "/device/passkey/register/options", "{}", auth = true, baseOverride = clean)
      if (r.code == 0) return fail(NO_NET)
      if (r.code !in 200..299) return fail(detail(r.body).ifEmpty { "পাসকি শুরু করা যায়নি (${r.code})" })
      val j = unwrap(r.body)
      val options = optionsText(j) ?: return fail(BAD_SERVER)
      val challengeToken = j.optString("token")
      if (challengeToken.isEmpty()) return fail(BAD_SERVER)

      val box = Box<String>()
      val latch = CountDownLatch(1)
      val request = CreatePublicKeyCredentialRequest(options)
      activity.runOnUiThread {
        try {
          CredentialManager.create(activity).createCredentialAsync(activity, request, null, activity.mainExecutor,
            object : CredentialManagerCallback<androidx.credentials.CreateCredentialResponse, CreateCredentialException> {
              override fun onResult(result: androidx.credentials.CreateCredentialResponse) {
                box.value = (result as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
                latch.countDown()
              }
              override fun onError(e: CreateCredentialException) { box.error = e; latch.countDown() }
            })
        } catch (e: Exception) { box.error = e; latch.countDown() }
      }
      if (!latch.await(120, TimeUnit.SECONDS)) return fail("সময় শেষ হয়ে গেছে, আবার চেষ্টা করুন")
      box.error?.let { return mapCreateError(it) }
      val reg = box.value ?: return fail("পাসকি বানানো যায়নি")

      val body = JSONObject().put("token", challengeToken).put("credential", JSONObject(reg))
      val v = Http.call(c, "POST", "/device/passkey/register/verify", body.toString(), auth = true, baseOverride = clean)
      return when {
        v.code in 200..299 -> mapOf("ok" to true)
        v.code == 0 -> fail(NO_NET)
        v.code == 401 -> fail("ফোনের লগইন শেষ — আবার লগইন করুন")
        v.code == 409 -> fail("এই পাসকি আগেই বানানো আছে")
        else -> fail(detail(v.body).ifEmpty { "পাসকি সংরক্ষণ হয়নি (${v.code})" })
      }
    } catch (e: Exception) {
      return fail("পাসকি বানানো যায়নি")
    }
  }

  /** Google answers "RP ID cannot be validated" while it has not (yet) accepted the app-to-server link: say so plainly. */
  private fun why(e: Exception, fallback: String): String {
    val msg = ((e as? GetCredentialException)?.errorMessage ?: (e as? CreateCredentialException)?.errorMessage ?: e.message ?: "").toString()
    return if (msg.contains("RP ID", ignoreCase = true) || msg.contains("50152"))
      "গুগল এখনও সার্ভারের সাথে অ্যাপের যোগ যাচাই করতে পারেনি। ৩০-৬০ মিনিট পর আবার চেষ্টা করুন, না হলে ফোনের Google Play services-এর ক্যাশ পরিষ্কার করুন"
    else if (msg.isNotBlank()) fallback + " (" + msg.take(70) + ")"
    else fallback
  }

  private fun mapGetError(e: Exception): Map<String, Any> = when (e) {
    is GetCredentialCancellationException -> cancelled()
    is NoCredentialException -> fail(NO_PASSKEY)
    is GetCredentialException -> fail(why(e, "পাসকি দিয়ে ঢোকা যায়নি, আবার চেষ্টা করুন"))
    else -> fail("পাসকি দিয়ে ঢোকা যায়নি")
  }

  private fun mapCreateError(e: Exception): Map<String, Any> = when (e) {
    is CreateCredentialCancellationException -> cancelled()
    is CreatePublicKeyCredentialDomException ->
      if (e.domError is InvalidStateError) fail("এই ফোনে পাসকি আগেই বানানো আছে") else fail(why(e, "পাসকি বানানো যায়নি"))
    is CreateCredentialException -> fail(why(e, "পাসকি বানানো যায়নি, আবার চেষ্টা করুন"))
    else -> fail("পাসকি বানানো যায়নি")
  }
}
