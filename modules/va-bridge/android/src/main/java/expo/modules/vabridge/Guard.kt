package expo.modules.vabridge

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Find-Hub-style protection (owner decision 2026-11-06). While this is an active device admin, Android will not uninstall the
 * app until the admin is switched off first, and switching it off tells the owner on Telegram at once. It never wipes data.
 */
class GuardAdmin : DeviceAdminReceiver() {
  override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
    Guard.report(context, "admin_disable")
    return "এটি বন্ধ করলে সুমন সহকারীর সুরক্ষা উঠে যাবে। মালিককে এখনই জানানো হয়েছে।"
  }

  override fun onDisabled(context: Context, intent: Intent) { Guard.report(context, "admin_off") }
}

object Guard {
  fun component(ctx: Context) = ComponentName(ctx, GuardAdmin::class.java)

  fun active(ctx: Context): Boolean = try {
    (ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).isAdminActive(component(ctx))
  } catch (_: Exception) { false }

  /** One "guard" item to the server (it sends the owner a Telegram alert). At most one per kind per minute. */
  fun report(ctx: Context, what: String) {
    try {
      if (!Store.paired(ctx)) return
      val key = "guard|$what|${System.currentTimeMillis() / 60000}"
      if (Outbox.duplicate(key)) return
      Outbox.add(ctx, item("guard", "sms", "device", null, what, "g:" + sha(key)))
      Thread { try { Outbox.flush(ctx) } catch (_: Exception) {} }.start()
    } catch (_: Exception) {}
  }
}
