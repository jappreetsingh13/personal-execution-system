package expo.modules.taskalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * AlarmManager forgets everything across a reboot, and the JS layer is not
 * running at boot to re-schedule. Re-arm from the native store instead.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> AlarmScheduler.rescheduleAll(context)
    }
  }
}
