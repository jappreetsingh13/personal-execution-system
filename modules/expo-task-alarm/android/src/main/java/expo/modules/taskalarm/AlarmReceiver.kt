package expo.modules.taskalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fired by AlarmManager at the alarm time; hands straight off to the service. */
class AlarmReceiver : BroadcastReceiver() {

  companion object {
    const val ACTION_FIRE = "expo.modules.taskalarm.FIRE"
    const val EXTRA_ID = "id"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_FIRE) return
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    val entry = AlarmStore.find(context, id) ?: return

    // A receiver gets ~10 seconds of runtime, so do nothing here but start the
    // foreground service, which owns the ringing for as long as it needs.
    AlarmService.start(context, entry)
  }
}
