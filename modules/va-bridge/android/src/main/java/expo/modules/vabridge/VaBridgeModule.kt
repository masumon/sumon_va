package expo.modules.vabridge

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * The only door between the app screens and the phone/server plumbing.
 * `request` is the ONLY way JavaScript talks to the server: the device token stays in encrypted native storage, and the
 * paths are limited to the owner's own inbox endpoints, so even a compromised screen cannot reach anything else.
 */
class VaBridgeModule : Module() {
  private val ctx: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

  private fun open(intent: Intent) { ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }

  override fun definition() = ModuleDefinition {
    Name("VaBridge")

    Events("inboxChanged")
    OnStartObserving { Bus.listener = { sendEvent("inboxChanged", mapOf("at" to System.currentTimeMillis())) } }
    OnStopObserving { Bus.listener = null }

    Function("getStatus") {
      val c = ctx
      val power = c.getSystemService(Context.POWER_SERVICE) as? PowerManager
      val nm = c.getSystemService(NotificationManager::class.java)
      mapOf(
        "paired" to Store.paired(c),
        "notificationAccess" to NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName),
        "smsReceive" to granted(Manifest.permission.RECEIVE_SMS),
        "smsSend" to granted(Manifest.permission.SEND_SMS),
        "phoneState" to granted(Manifest.permission.READ_PHONE_STATE),
        "callLog" to granted(Manifest.permission.READ_CALL_LOG),
        "postNotifications" to (Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)),
        "batteryExempt" to (power?.isIgnoringBatteryOptimizations(c.packageName) ?: false),
        "dndAccess" to (nm?.isNotificationPolicyAccessGranted ?: false),
        "location" to (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)),
        "contacts" to granted(Manifest.permission.READ_CONTACTS),
        "storage" to (if (Build.VERSION.SDK_INT >= 33) granted(Manifest.permission.READ_MEDIA_IMAGES) else granted(Manifest.permission.READ_EXTERNAL_STORAGE)),
        "microphone" to granted(Manifest.permission.RECORD_AUDIO),
        "exactAlarm" to (if (Build.VERSION.SDK_INT >= 31) (c.getSystemService(android.app.AlarmManager::class.java)?.canScheduleExactAlarms() ?: false) else true),
        "fullScreen" to (if (Build.VERSION.SDK_INT >= 34) (nm?.canUseFullScreenIntent() ?: false) else true),
        "serviceAlive" to PollService.alive,
        "queued" to Outbox.size(c),
        "lastOk" to Store.prefs(c).getLong("last_ok", 0L).toDouble(),
        "lastError" to Store.prefs(c).getString("last_error", null),
        "pollSeconds" to Store.pollSeconds(c),
        "packages" to Store.packages(c).sorted(),
        "accountName" to Store.prefs(c).getString("account_name", null),
        "accountEmail" to Store.prefs(c).getString("account_email", null),
      )
    }

    /** Exchange the one-time code the owner created in the admin for this phone's own token. */
    AsyncFunction("pair") { base: String, code: String, name: String ->
      val c = ctx
      if (!base.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "error" to "https ঠিকানা লাগবে")
      Store.prefs(c).edit().putString("base", base.trimEnd('/')).apply()
      val body = JSONObject().put("code", code.trim().uppercase()).put("name", name.take(80)).put("app_version", "0.1.0").toString()
      val r = Http.call(c, "POST", "/device/pair", body, auth = false)
      if (r.code in 200..299) {
        val token = JSONObject(r.body).optString("token")
        if (token.isEmpty()) {
          Store.prefs(c).edit().remove("base").apply()
          return@AsyncFunction mapOf("ok" to false, "error" to "সার্ভার ভুল উত্তর দিয়েছে")
        }
        Store.setPaired(c, base.trimEnd('/'), token)
        PollService.start(c)
        mapOf("ok" to true)
      } else {
        Store.prefs(c).edit().remove("base").apply()
        val why = try { JSONObject(r.body).optString("detail") } catch (_: Exception) { "" }
        mapOf("ok" to false, "error" to (why.ifEmpty { "জোড়া লাগেনি (${r.code})" }))
      }
    }

    /** Sign in with the admin e-mail and password (+ authenticator code when the account uses one). The phone is remembered after this. */
    AsyncFunction("loginPassword") { base: String, email: String, password: String, totp: String?, name: String ->
      val c = ctx
      val clean = base.trimEnd('/')
      if (!clean.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "error" to "https ঠিকানা লাগবে")
      val body = JSONObject().put("email", email.trim()).put("password", password).put("name", name.take(80)).put("app_version", "0.1.0")
      if (!totp.isNullOrBlank()) body.put("totp_code", totp.trim())
      val r = Http.call(c, "POST", "/device/login", body.toString(), auth = false, baseOverride = clean)
      val detail = try { JSONObject(r.body).optString("detail") } catch (_: Exception) { "" }
      when {
        r.code in 200..299 -> {
          val json = JSONObject(r.body)
          val token = json.optString("token")
          if (token.isEmpty()) return@AsyncFunction mapOf("ok" to false, "error" to "সার্ভার ভুল উত্তর দিয়েছে")
          Store.setPaired(c, clean, token)
          Store.setAccount(c, json.optString("name"), email.trim())
          PollService.start(c)
          mapOf("ok" to true, "name" to json.optString("name"))
        }
        r.code == 401 && detail == "totp_required" -> mapOf("ok" to false, "needTotp" to true)
        r.code == 0 -> mapOf("ok" to false, "error" to "ইন্টারনেট নেই বা সার্ভারে পৌঁছানো যাচ্ছে না")
        else -> mapOf("ok" to false, "error" to detail.ifEmpty { "লগইন হয়নি (${r.code})" })
      }
    }

    /** Step 1 of e-mail sign-in: the server mails a 6-digit code to the owner (the answer never reveals who is an admin). */
    AsyncFunction("loginRequest") { base: String, email: String ->
      if (!base.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "error" to "https ঠিকানা লাগবে")
      val r = Http.call(ctx, "POST", "/device/otp/request", JSONObject().put("email", email.trim()).toString(), auth = false, baseOverride = base.trimEnd('/'))
      if (r.code in 200..299) mapOf("ok" to true)
      else mapOf("ok" to false, "error" to (try { JSONObject(r.body).optString("detail") } catch (_: Exception) { "" }).ifEmpty { "কোড পাঠানো যায়নি (${r.code})" })
    }

    /** Step 2: code (and the authenticator code, if the admin uses one) for this phone's own token. */
    AsyncFunction("loginVerify") { base: String, email: String, code: String, totp: String?, name: String ->
      val c = ctx
      val clean = base.trimEnd('/')
      if (!clean.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "error" to "https ঠিকানা লাগবে")
      val body = JSONObject().put("email", email.trim()).put("code", code.trim()).put("name", name.take(80)).put("app_version", "0.1.0")
      if (!totp.isNullOrBlank()) body.put("totp_code", totp.trim())
      val r = Http.call(c, "POST", "/device/otp/verify", body.toString(), auth = false, baseOverride = clean)
      val detail = try { JSONObject(r.body).optString("detail") } catch (_: Exception) { "" }
      when {
        r.code in 200..299 -> {
          val json = JSONObject(r.body)
          val token = json.optString("token")
          if (token.isEmpty()) return@AsyncFunction mapOf("ok" to false, "error" to "সার্ভার ভুল উত্তর দিয়েছে")
          Store.setPaired(c, clean, token)
          Store.setAccount(c, json.optString("name"), email.trim())
          PollService.start(c)
          mapOf("ok" to true, "name" to json.optString("name"))
        }
        r.code == 401 && detail == "totp_required" -> mapOf("ok" to false, "needTotp" to true)
        else -> mapOf("ok" to false, "error" to detail.ifEmpty { "লগইন হয়নি (${r.code})" })
      }
    }

    Function("unpair") { Store.clear(ctx); PollService.stop(ctx); true }

    /** Server call with the device token. Only the owner's inbox endpoints are reachable from the screens. */
    AsyncFunction("request") { method: String, path: String, body: String? ->
      val m = method.uppercase()
      if (m !in setOf("GET", "POST", "PUT", "PATCH", "DELETE") || !(path.startsWith("/admin/wa/") || path.startsWith("/admin/inbox/") || path.startsWith("/admin/ai-hub") || path == "/device/logout") || path.contains("..")) {
        return@AsyncFunction mapOf("status" to 0, "body" to "path not allowed")
      }
      val r = Http.call(ctx, m, path, body)
      mapOf("status" to r.code, "body" to r.body)
    }

    AsyncFunction("flush") { Outbox.flush(ctx) }
    Function("startService") { if (Store.paired(ctx)) PollService.start(ctx); true }
    Function("stopService") { PollService.stop(ctx); true }
    Function("setPackages") { list: List<String> -> Store.setPackages(ctx, list.filter { it.length in 3..120 }.toSet()); true }
    Function("setPollSeconds") { s: Int -> Store.setPollSeconds(ctx, s); true }
    /** A plain notification from the app itself (used for "a problem needs you"). target p1 = loud alarm, anything else = normal. */
    Function("notify") { target: String, body: String, id: String -> PollService.showAlert(ctx, target, body, id); true }
    Function("testAlert") { PollService.showAlert(ctx, "p1", "পরীক্ষা: এভাবেই জরুরি বার্তা বাজবে", "test-" + System.currentTimeMillis()); true }

    Function("openNotificationAccess") { open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); true }
    Function("openDndAccess") { open(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); true }
    Function("openBatterySettings") {
      val i = if (Build.VERSION.SDK_INT >= 23) Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName)) else Intent(Settings.ACTION_SETTINGS)
      open(i); true
    }
    Function("openExactAlarmSettings") {
      val i = if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.packageName)) else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
      open(i); true
    }
    Function("openFullScreenSettings") {
      val i = if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + ctx.packageName)) else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
      open(i); true
    }
    Function("openAppSettings") { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))); true }
  }
}
