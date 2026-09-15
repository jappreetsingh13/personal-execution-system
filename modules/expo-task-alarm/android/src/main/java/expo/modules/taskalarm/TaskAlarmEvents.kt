package expo.modules.taskalarm

/**
 * Bridge from the service/activity (which run with no JS context guaranteed)
 * to the Expo module (which may or may not be alive).
 *
 * The service must work with the app completely killed, so it can never assume
 * a listener exists — these emits are best-effort notifications for a running
 * JS layer, never the mechanism the alarm itself depends on.
 */
object TaskAlarmEvents {

  interface Listener {
    fun onRinging(entry: AlarmEntry)
    fun onStopped(entry: AlarmEntry?)
    fun onSnooze(entry: AlarmEntry?)
  }

  @Volatile
  var listener: Listener? = null

  fun emitRinging(entry: AlarmEntry) {
    runCatching { listener?.onRinging(entry) }
  }

  fun emitStopped(entry: AlarmEntry?) {
    runCatching { listener?.onStopped(entry) }
  }

  fun emitSnooze(entry: AlarmEntry?) {
    runCatching { listener?.onSnooze(entry) }
  }
}
