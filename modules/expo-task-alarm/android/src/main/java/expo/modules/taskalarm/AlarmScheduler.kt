package expo.modules.taskalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Arms alarms with AlarmManager.
 *
 * `setAlarmClock` is used rather than `setExactAndAllowWhileIdle` deliberately:
 * it is the only API Android treats as a real user-facing alarm, so it fires
 * exactly even in Doze, is exempt from battery optimisation, and shows the
 * system alarm icon in the status bar. It is what the stock Clock app uses.
 */
object AlarmScheduler {

  private fun alarmManager(context: Context) =
    context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun firePendingIntent(context: Context, entry: AlarmEntry): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).apply {
      action = AlarmReceiver.ACTION_FIRE
      putExtra(AlarmReceiver.EXTRA_ID, entry.id)
    }
    return PendingIntent.getBroadcast(
      context,
      entry.id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /** Intent used by the status-bar alarm icon when the user taps it. */
  private fun showPendingIntent(context: Context, entry: AlarmEntry): PendingIntent {
    val intent = AlarmActivity.intentFor(context, entry).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return PendingIntent.getActivity(
      context,
      entry.id.hashCode() + 1,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun schedule(context: Context, entry: AlarmEntry) {
    AlarmStore.put(context, entry)
    arm(context, entry)
  }

  /** Arm without touching the store — used when re-scheduling after a reboot. */
  fun arm(context: Context, entry: AlarmEntry) {
    val manager = alarmManager(context)
    val fire = firePendingIntent(context, entry)

    // canScheduleExactAlarms() covers the case where the user revoked the
    // permission in system settings; falling back keeps the alarm roughly on
    // time rather than dropping it entirely.
    val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      manager.canScheduleExactAlarms()
    } else {
      true
    }

    if (canExact) {
      manager.setAlarmClock(
        AlarmManager.AlarmClockInfo(entry.triggerAtMs, showPendingIntent(context, entry)),
        fire
      )
    } else {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.triggerAtMs, fire)
    }
  }

  fun cancel(context: Context, id: String) {
    val entry = AlarmStore.find(context, id)
    if (entry != null) {
      alarmManager(context).cancel(firePendingIntent(context, entry))
    }
    AlarmStore.remove(context, id)
  }

  /**
   * Reconcile the whole armed set in one pass.
   *
   * Scheduling each alarm individually meant a full read-and-rewrite of the store per alarm, on
   * every resync — quadratic work on the JS thread for something that runs whenever a box is
   * ticked. This diffs in memory and writes once, and re-arms only alarms that actually changed,
   * so an alarm about to fire is never briefly cancelled.
   *
   * `keepSuffix` protects one-off snoozes, which live outside the caller's rolling window and are
   * therefore never in `wanted`.
   */
  fun replaceAll(context: Context, wanted: List<AlarmEntry>, keepSuffix: String) {
    val manager = alarmManager(context)
    val existing = AlarmStore.all(context)
    val existingById = existing.associateBy { it.id }
    val wantedById = wanted.associateBy { it.id }
    val preserved = existing.filter { it.id.endsWith(keepSuffix) }

    for (entry in existing) {
      if (entry.id.endsWith(keepSuffix)) continue
      if (!wantedById.containsKey(entry.id)) {
        runCatching { manager.cancel(firePendingIntent(context, entry)) }
      }
    }

    for (entry in wanted) {
      val previous = existingById[entry.id]
      val unchanged = previous != null &&
        previous.triggerAtMs == entry.triggerAtMs &&
        previous.soundName == entry.soundName &&
        previous.title == entry.title &&
        previous.body == entry.body
      if (!unchanged) arm(context, entry)
    }

    // Preserved snoozes first so a wanted entry with the same id would win, not that it can.
    AlarmStore.replace(context, preserved.filterNot { wantedById.containsKey(it.id) } + wanted)
  }

  fun cancelAll(context: Context) {
    val manager = alarmManager(context)
    AlarmStore.all(context).forEach { manager.cancel(firePendingIntent(context, it)) }
    AlarmStore.clear(context)
  }

  /** Re-arm everything still in the future. Called on boot and on app update. */
  fun rescheduleAll(context: Context) {
    AlarmStore.pruneExpired(context).forEach { arm(context, it) }
  }

  fun canScheduleExact(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      alarmManager(context).canScheduleExactAlarms()
    } else {
      true
    }
}
