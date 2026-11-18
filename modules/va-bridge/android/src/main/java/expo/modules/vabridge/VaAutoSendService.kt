package expo.modules.vabridge

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Single-shot, opt-in Accessibility helper for Solution 3 ("অটো-Send"):
 * Only acts for 15 seconds after the owner explicitly triggers `autoSendInApp` AND `ChatOpener` confirmed the exact
 * person's chat opened directly (`how == "chat"`). Taps the Send button ONCE and disarms immediately.
 * Off by default until the owner enables it in Android Accessibility Settings.
 */
object AutoSendQueue {
  private data class Pending(val pkg: String, val expiresAt: Long)

  @Volatile private var pending: Pending? = null

  fun arm(pkg: String, ttlMs: Long = 15_000L) {
    pending = Pending(pkg, System.currentTimeMillis() + ttlMs)
  }

  fun peek(pkg: String?): Boolean {
    val p = pending ?: return false
    if (System.currentTimeMillis() > p.expiresAt) {
      pending = null
      return false
    }
    return pkg != null && p.pkg == pkg
  }

  fun disarm() {
    pending = null
  }
}

class VaAutoSendService : AccessibilityService() {
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val pkg = event?.packageName?.toString() ?: return
    if (!AutoSendQueue.peek(pkg)) return
    val root = rootInActiveWindow ?: return
    try {
      val btn = findSendButton(root, pkg) ?: return
      if (btn.isClickable && btn.isEnabled) {
        AutoSendQueue.disarm()
        btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      }
    } catch (_: Exception) {
      AutoSendQueue.disarm()
    }
  }

  override fun onInterrupt() {
    AutoSendQueue.disarm()
  }

  private fun findSendButton(root: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
    val ids = listOf("$pkg:id/send", "com.whatsapp:id/send", "com.whatsapp.w4b:id/send")
    for (id in ids) {
      val hits = root.findAccessibilityNodeInfosByViewId(id)
      val clickable = hits?.firstOrNull { it.isClickable && it.isEnabled }
      if (clickable != null) return clickable
    }
    return findByDesc(root)
  }

  private fun findByDesc(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    if (node == null) return null
    val desc = node.contentDescription?.toString()?.trim()?.lowercase()
    if (node.isClickable && node.isEnabled && (desc == "send" || desc == "পাঠান")) return node
    for (i in 0 until node.childCount) {
      val hit = findByDesc(node.getChild(i))
      if (hit != null) return hit
    }
    return null
  }

  companion object {
    fun isEnabled(ctx: Context): Boolean {
      return try {
        val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(ctx, VaAutoSendService::class.java).flattenToString()
        val shortMe = ComponentName(ctx, VaAutoSendService::class.java).flattenToShortString()
        enabled.split(':').any { it.equals(me, ignoreCase = true) || it.equals(shortMe, ignoreCase = true) }
      } catch (_: Exception) {
        false
      }
    }
  }
}
