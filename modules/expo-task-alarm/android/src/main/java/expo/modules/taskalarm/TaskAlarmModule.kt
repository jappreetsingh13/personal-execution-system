package expo.modules.taskalarm

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AlarmInput : Record {
  @Field var id: String = ""
  @Field var triggerAtMs: Double = 0.0
  @Field var title: String = "Alarm"
  @Field var body: String = ""
  @Field var soundName: String? = null
  @Field var taskId: String? = null
  @Field var date: String? = null
}

class ChannelInput : Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var description: String? = null
  /** Android importance constant: 4 = HIGH, 5 = MAX. */
  @Field var importance: Int = 4
  /** Raw-resource filename or a content:// URI. Null means silent. */
  @Field var sound: String? = null
  /** Play on the alarm stream rather than the notification stream. */
  @Field var alarmUsage: Boolean = false
  @Field var vibrate: Boolean = true
  @Field var vibrationPattern: List<Double>? = null
  @Field var bypassDnd: Boolean = false
}

private const val PICK_SOUND_REQUEST = 0x7A1B

class TaskAlarmModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  /** Held between launching the system ringtone picker and its result coming back. */
  private var pendingSoundPromise: Promise? = null

  private fun entryToMap(entry: AlarmEntry?): Map<String, Any?>? = entry?.let {
    mapOf(
      "id" to it.id,
      "triggerAtMs" to it.triggerAtMs.toDouble(),
      "title" to it.title,
      "body" to it.body,
      "taskId" to it.taskId,
      "date" to it.date
    )
  }

  @Suppress("DEPRECATION")
  private fun pickedUri(intent: Intent?): Uri? {
    intent ?: return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java)
    } else {
      intent.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
    }
  }

  private fun titleFor(uri: Uri): String =
    runCatching { RingtoneManager.getRingtone(context, uri)?.getTitle(context) }
      .getOrNull()
      ?.takeIf { it.isNotBlank() }
      ?: "Device sound"

  override fun definition() = ModuleDefinition {
    Name("ExpoTaskAlarm")

    Events("onAlarmRinging", "onAlarmStopped", "onAlarmSnooze")

    OnStartObserving {
      TaskAlarmEvents.listener = object : TaskAlarmEvents.Listener {
        override fun onRinging(entry: AlarmEntry) {
          sendEvent("onAlarmRinging", entryToMap(entry) ?: emptyMap())
        }

        override fun onStopped(entry: AlarmEntry?) {
          sendEvent("onAlarmStopped", entryToMap(entry) ?: emptyMap())
        }

        override fun onSnooze(entry: AlarmEntry?) {
          sendEvent("onAlarmSnooze", entryToMap(entry) ?: emptyMap())
        }
      }
    }

    OnStopObserving {
      TaskAlarmEvents.listener = null
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_SOUND_REQUEST) return@OnActivityResult
      val promise = pendingSoundPromise ?: return@OnActivityResult
      pendingSoundPromise = null

      if (payload.resultCode != Activity.RESULT_OK) {
        // Cancelled — null rather than an error, so JS can just keep the old choice.
        promise.resolve(null)
        return@OnActivityResult
      }

      val uri = pickedUri(payload.data)
      if (uri == null) {
        promise.resolve(null)
      } else {
        SoundResolver.grantReadToSystem(context, uri)
        promise.resolve(mapOf("uri" to uri.toString(), "title" to titleFor(uri)))
      }
    }

    // ---- Alarms -----------------------------------------------------------

    Function("schedule") { input: AlarmInput ->
      AlarmScheduler.schedule(
        context,
        AlarmEntry(
          id = input.id,
          triggerAtMs = input.triggerAtMs.toLong(),
          title = input.title,
          body = input.body,
          soundName = input.soundName,
          taskId = input.taskId,
          date = input.date
        )
      )
    }

    /**
     * Reconcile every alarm in one call. Preferred over looping `schedule`, which rewrites the
     * whole store per alarm.
     */
    Function("replaceAll") { inputs: List<AlarmInput>, keepSuffix: String ->
      AlarmScheduler.replaceAll(
        context,
        inputs.map {
          AlarmEntry(
            id = it.id,
            triggerAtMs = it.triggerAtMs.toLong(),
            title = it.title,
            body = it.body,
            soundName = it.soundName,
            taskId = it.taskId,
            date = it.date
          )
        },
        keepSuffix
      )
    }

    Function("cancel") { id: String ->
      AlarmScheduler.cancel(context, id)
    }

    Function("cancelAll") {
      AlarmScheduler.cancelAll(context)
    }

    /** Stop whatever is ringing right now. Safe to call when nothing is. */
    Function("stopRinging") {
      AlarmService.stop(context)
    }

    Function("isRinging") {
      AlarmService.ringingId != null
    }

    Function("ringingAlarm") {
      entryToMap(AlarmService.ringingEntry)
    }

    Function("scheduledIds") {
      AlarmStore.all(context).map { it.id }
    }

    /** Ring immediately — used by the "Test alarm" button in Settings. */
    Function("testRingNow") { title: String, soundName: String? ->
      val entry = AlarmEntry(
        id = "test-alarm",
        triggerAtMs = System.currentTimeMillis(),
        title = title,
        body = "Test alarm",
        soundName = soundName,
        taskId = null,
        date = null
      )
      AlarmStore.put(context, entry)
      AlarmService.start(context, entry)
    }

    // ---- Notification channels -------------------------------------------

    /**
     * Create a channel with an arbitrary sound. No-op if the id already exists, since Android
     * ignores sound changes to an existing channel — the JS side varies the id instead.
     */
    Function("createChannel") { input: ChannelInput ->
      Channels.create(
        context = context,
        id = input.id,
        name = input.name,
        description = input.description,
        importance = input.importance,
        soundSpec = input.sound,
        alarmUsage = input.alarmUsage,
        vibrate = input.vibrate,
        vibrationPattern = input.vibrationPattern?.map { it.toLong() }?.toLongArray(),
        bypassDnd = input.bypassDnd
      )
    }

    Function("channelExists") { id: String ->
      Channels.exists(context, id)
    }

    Function("channelIds") {
      Channels.ids(context)
    }

    /** Tidy up channels from older tunes/versions so app settings stay readable. */
    Function("deleteChannelsExcept") { prefixes: List<String>, keep: List<String> ->
      Channels.deleteExcept(context, prefixes, keep)
    }

    // ---- Device sound picker ---------------------------------------------

    /**
     * Open Android's own ringtone picker. `kind` is "alarm" or "notification", which decides
     * which of the device's tone libraries is listed.
     */
    AsyncFunction("pickSound") { kind: String, currentUri: String?, promise: Promise ->
      val activity = appContext.throwingActivity

      // A picker already in flight would otherwise leave the first promise pending forever.
      pendingSoundPromise?.resolve(null)
      pendingSoundPromise = promise

      val isAlarm = kind == "alarm"
      val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
        putExtra(
          RingtoneManager.EXTRA_RINGTONE_TYPE,
          if (isAlarm) RingtoneManager.TYPE_ALARM else RingtoneManager.TYPE_NOTIFICATION
        )
        putExtra(
          RingtoneManager.EXTRA_RINGTONE_TITLE,
          if (isAlarm) "Choose an alarm sound" else "Choose a notification sound"
        )
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        if (!currentUri.isNullOrEmpty()) {
          putExtra(
            RingtoneManager.EXTRA_RINGTONE_EXISTING_URI,
            runCatching { Uri.parse(currentUri) }.getOrNull()
          )
        }
      }

      runCatching { activity.startActivityForResult(intent, PICK_SOUND_REQUEST) }
        .onFailure {
          pendingSoundPromise = null
          promise.reject("ERR_NO_PICKER", "This device has no ringtone picker.", it)
        }
    }

    // ---- Permission diagnostics ------------------------------------------

    /** Whether AlarmManager will honour exact timing. */
    Function("canScheduleExact") {
      AlarmScheduler.canScheduleExact(context)
    }

    /**
     * Android 14+ gates full-screen intents behind a per-app grant unless the app is classed as an
     * alarm/calling app. Without it the alarm still rings and posts a heads-up notification, but
     * does not take over the lock screen.
     */
    Function("canUseFullScreenIntent") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE)
          as android.app.NotificationManager
        manager.canUseFullScreenIntent()
      } else {
        true
      }
    }

    /**
     * Aggressive battery optimisation is the most common reason an alarm fires late or not at all
     * on Samsung/Xiaomi/OnePlus builds, even with exact-alarm permission granted.
     */
    Function("isIgnoringBatteryOptimizations") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        power.isIgnoringBatteryOptimizations(context.packageName)
      } else {
        true
      }
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      }
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      }
    }

    /**
     * Ask to be exempted from battery optimisation. Falls back to the general settings list if the
     * direct request intent is unavailable (some OEM builds remove it).
     */
    // Guarded with an `if` rather than an early `return@Function`: a Function's lambda is typed to
    // return Any?, so a bare return is a type mismatch.
    Function("openBatteryOptimizationSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val started = runCatching { context.startActivity(direct) }.isSuccess
        if (!started) {
          runCatching {
            context.startActivity(
              Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
          }
        }
      }
    }

    /** Per-app notification settings — the way back from a channel the user muted themselves. */
    Function("openNotificationSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.parse("package:${context.packageName}"))
      }
      runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    // ---- Cleanup of the retired floating-note bubble -----------------------

    /**
     * Sweep what the removed bubble feature left on the device.
     *
     * The bubble was anchored to a *long-lived dynamic shortcut*, so it survives
     * the app update on its own and would sit in the launcher's long-press menu
     * forever pointing at a feature that no longer exists. Its posted
     * notification outlives the update too. Deleting the Kotlin that created
     * them does not remove them — only this does. The "bubbles" channel is swept
     * separately, by `deleteChannelsExcept` in src/lib/channels.ts.
     *
     * Safe and cheap to call on every launch: both calls are no-ops once there
     * is nothing left to remove.
     */
    Function("removeNoteBubble") {
      runCatching {
        context.getSystemService(NotificationManager::class.java)
          ?.cancel(BUBBLE_NOTIFICATION_ID)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
        runCatching {
          context.getSystemService(ShortcutManager::class.java)
            ?.removeDynamicShortcuts(listOf(BUBBLE_SHORTCUT_ID))
        }
      }
    }
  }

  private companion object {
    /** Must keep matching what the deleted BubbleNote.kt used, or nothing is found. */
    const val BUBBLE_NOTIFICATION_ID = 4242
    const val BUBBLE_SHORTCUT_ID = "new-note-bubble"
  }
}
