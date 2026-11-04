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
import expo.modules.kotlin.Promise
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
  private val io = java.util.concurrent.Executors.newFixedThreadPool(6)

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
        "activity" to (Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACTIVITY_RECOGNITION)),
        "alertUrgent" to Store.level(c, "p1", 3), "alertImportant" to Store.level(c, "p2", 2), "alertNormal" to Store.level(c, "other", 1), "alertVolume" to Store.prefs(c).getInt("alert_vol", 3),
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

    /** Sign in without a password, step 1: the server sends the owner a message with a code and two buttons in his own Telegram bot. */
    AsyncFunction("loginTelegramRequest") { base: String, name: String ->
      val clean = base.trimEnd('/')
      if (!clean.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "error" to "https ঠিকানা লাগবে")
      val r = Http.call(ctx, "POST", "/device/login-telegram/request", JSONObject().put("name", "${name.take(60)} (${Build.MODEL})").toString(), auth = false, baseOverride = clean)
      val detail = try { JSONObject(r.body).optString("detail") } catch (_: Exception) { "" }
      when {
        r.code in 200..299 -> {
          val json = JSONObject(r.body)
          mapOf("ok" to true, "requestId" to json.optString("request_id"), "code" to json.optString("code"), "expiresIn" to json.optInt("expires_in", 120))
        }
        r.code == 0 -> mapOf("ok" to false, "error" to "ইন্টারনেট নেই বা সার্ভারে পৌঁছানো যাচ্ছে না")
        else -> mapOf("ok" to false, "error" to detail.ifEmpty { "অনুরোধ যায়নি (${r.code})" })
      }
    }

    /** Step 2: has the owner answered? On approval the phone keeps its OWN token (same as every other sign-in) and starts syncing. */
    AsyncFunction("loginTelegramPoll") { base: String, requestId: String ->
      val c = ctx
      val clean = base.trimEnd('/')
      if (!clean.startsWith("https://")) return@AsyncFunction mapOf("ok" to false, "status" to "error")
      val r = Http.call(c, "GET", "/device/login-telegram/status?request_id=" + Uri.encode(requestId) + "&app_version=1.0.0", null, auth = false, baseOverride = clean)
      if (r.code !in 200..299) return@AsyncFunction mapOf("ok" to false, "status" to "error")
      val json = JSONObject(r.body)
      val status = json.optString("status", "error")
      if (status == "approved") {
        val token = json.optString("token")
        if (token.isEmpty()) return@AsyncFunction mapOf("ok" to false, "status" to "error")
        Store.setPaired(c, clean, token)
        Store.setAccount(c, json.optString("name"), null)
        PollService.start(c)
        mapOf("ok" to true, "status" to "approved", "name" to json.optString("name"))
      } else mapOf("ok" to true, "status" to status)
    }

    Function("unpair") { Store.clear(ctx); PollService.stop(ctx); true }

    /** Server call with the device token. Only the owner's inbox endpoints are reachable from the screens. */
    // Every server call runs on its own worker thread. Before, all calls shared Expo's ONE async queue, so a single slow call
    // (an AI test can take 90 s) made every other screen wait behind it: endless "loading", tests that never seemed to finish.
    AsyncFunction("request") { method: String, path: String, body: String?, promise: Promise ->
      val m = method.uppercase()
      if (m !in setOf("GET", "POST", "PUT", "PATCH", "DELETE") || !(path.startsWith("/admin/wa/") || path.startsWith("/admin/inbox/") || path.startsWith("/admin/ai-hub") || path == "/device/logout") || path.contains("..")) {
        promise.resolve(mapOf("status" to 0, "body" to "path not allowed"))
        return@AsyncFunction
      }
      val c = ctx
      io.execute {
        // Testing an AI key asks an outside company and can take a while (and a sleeping free server needs ~30 s to wake): wait longer there.
        val r = try { Http.call(c, m, path, body, readMs = if (path.startsWith("/admin/ai-hub")) 90000 else 20000) } catch (e: Exception) { Http.Resp(0, e.javaClass.simpleName) }
        promise.resolve(mapOf("status" to r.code, "body" to r.body))
      }
    }

    AsyncFunction("flush") { promise: Promise -> val c = ctx; io.execute { promise.resolve(try { Outbox.flush(c) } catch (_: Exception) { false }) } }
    Function("startService") { if (Store.paired(ctx)) PollService.start(ctx); true }
    Function("stillFor") { Presence.start(ctx); Presence.stillForSeconds().toInt() }
    Function("stopService") { PollService.stop(ctx); true }
    Function("setPackages") { list: List<String> -> Store.setPackages(ctx, list.filter { it.length in 3..120 }.toSet()); true }
    Function("setPollSeconds") { s: Int -> Store.setPollSeconds(ctx, s); true }
    /** A plain notification from the app itself (used for "a problem needs you"). target p1 = loud alarm, anything else = normal. */
    Function("notify") { target: String, body: String, id: String -> PollService.showAlert(ctx, target, body, id); true }
    Function("setAlertLevels") { urgent: Int, important: Int, normal: Int, volume: Int -> Store.setLevels(ctx, urgent, important, normal, volume); true }
    /** Settings test buttons: feel/hear exactly this strength (level 1–3) and loudness (1–3). */
    Function("testAlertLevel") { level: Int, volume: Int -> PollService.test(ctx, level, volume); true }
    /** Is this app installed on the phone? (Only the chat apps listed in the manifest's <queries> can be asked about.) */
    Function("isInstalled") { pkg: String -> try { ctx.packageManager.getPackageInfo(pkg, 0); true } catch (_: Exception) { false } }
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
