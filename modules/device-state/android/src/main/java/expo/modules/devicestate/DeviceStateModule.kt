package expo.modules.devicestate

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reads one system setting no JS package exposes: whether battery saving leaves this app
// alone. The permissions screen shows the phone's real answer instead of "check it
// yourself" (the user's rule, RC.4). Read-only; it changes nothing.
class DeviceStateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeviceState")

    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function null
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@Function null
      power.isIgnoringBatteryOptimizations(context.packageName)
    }
  }
}
