package expo.modules.taskalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Keeps the alarm ringing independently of the React Native app.
 *
 * A foreground service is what makes this a real alarm: it survives the app
 * being backgrounded or killed, holds a wake lock so the CPU keeps running with
 * the screen off, and loops audio on the ALARM stream until it is explicitly
 * stopped. The full-screen intent on its notification is what puts the ringing
 * screen over the lock screen.
 */
class AlarmService : Service() {

  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var wakeLock: PowerManager.WakeLock? = null

  companion object {
    const val ACTION_START = "expo.modules.taskalarm.START"
    const val ACTION_STOP = "expo.modules.taskalarm.STOP"
    const val EXTRA_ID = "id"

    private const val CHANNEL_ID = "task-alarm-ringing-v1"
    private const val NOTIFICATION_ID = 0x7A1A

    /** Set while ringing so JS (and the activity) can ask what is going on. */
    @Volatile
    var ringingId: String? = null
      private set

    @Volatile
    var ringingEntry: AlarmEntry? = null
      private set

    fun start(context: Context, entry: AlarmEntry) {
      val intent = Intent(context, AlarmService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_ID, entry.id)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, AlarmService::class.java).apply { action = ACTION_STOP }
      // startService on a stopped service is a no-op-ish; guard by only asking
      // to stop when something is actually ringing.
      if (ringingId != null) {
        context.startService(intent)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopRinging()
        return START_NOT_STICKY
      }
      else -> {
        val id = intent?.getStringExtra(EXTRA_ID)
        val entry = id?.let { AlarmStore.find(this, it) }
        if (entry == null) {
          stopSelf()
          return START_NOT_STICKY
        }
        beginRinging(entry)
      }
    }
    return START_STICKY
  }

  private fun beginRinging(entry: AlarmEntry) {
    ringingId = entry.id
    ringingEntry = entry

    ensureChannel()
    startForegroundCompat(buildNotification(entry))
    acquireWakeLock()
    startAudio(entry)
    startVibration()

    TaskAlarmEvents.emitRinging(entry)

    // A one-shot alarm has now fired; drop it so a reboot does not resurrect it.
    AlarmStore.remove(this, entry.id)
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ringing alarm",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "Shown while a task alarm is ringing."
      // The service plays the audio itself, so the channel must stay silent or
      // the two would overlap.
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(true)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(entry: AlarmEntry): Notification {
    val fullScreen = PendingIntent.getActivity(
      this,
      entry.id.hashCode() + 2,
      AlarmActivity.intentFor(this, entry).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val stop = PendingIntent.getService(
      this,
      entry.id.hashCode() + 3,
      Intent(this, AlarmService::class.java).apply { action = ACTION_STOP },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle(entry.title)
      .setContentText(if (entry.body.isNotEmpty()) entry.body else "Alarm")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(fullScreen)
      // The full-screen intent is what launches the ringing screen over the
      // keyguard instead of just posting a heads-up notification.
      .setFullScreenIntent(fullScreen, true)
      .addAction(
        // Explicitly typed null: Action.Builder has both an Icon and a legacy
        // int-icon overload, and a bare null is needlessly ambiguous to read.
        Notification.Action.Builder(null as Icon?, "Stop", stop).build()
      )
      .build()
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun acquireWakeLock() {
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "expo-task-alarm::ringing"
    ).apply {
      setReferenceCounted(false)
      // Safety valve: never hold the CPU awake for more than 10 minutes even if
      // something goes wrong with the stop path.
      acquire(10 * 60 * 1000L)
    }
  }

  private fun startAudio(entry: AlarmEntry) {
    // A bundled raw resource, or a content:// tone picked from the device's own library;
    // falls back to the system alarm tone rather than silence. See SoundResolver.
    val chosen = SoundResolver.resolveAlarm(this, entry.soundName)

    // Try the chosen tone, then the system alarm tone, then the ringtone. A picked content:// URI
    // can stop being readable (file deleted, permission revoked) long after it was chosen, and an
    // alarm that goes silent because of that is worse than one that rings with the wrong sound.
    val candidates = listOfNotNull(
      chosen,
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    ).distinct()

    for (uri in candidates) {
      val ok = runCatching {
        player = MediaPlayer().apply {
          setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_ALARM)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build()
          )
          setDataSource(this@AlarmService, uri)
          // Looping is the difference between a notification chime and an alarm:
          // it rings until a human stops it.
          isLooping = true
          prepare()
          start()
        }
      }.isSuccess
      if (ok) break
      runCatching { player?.release() }
      player = null
    }

    // Alarm volume can legitimately be 0; nudge it to audible so a silenced
    // media stream does not turn the alarm into a no-op.
    runCatching {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (audio.getStreamVolume(AudioManager.STREAM_ALARM) == 0) {
        val target = (audio.getStreamMaxVolume(AudioManager.STREAM_ALARM) * 0.6).toInt()
        audio.setStreamVolume(AudioManager.STREAM_ALARM, target.coerceAtLeast(1), 0)
      }
    }
  }

  private fun startVibration() {
    runCatching {
      vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val manager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        manager.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      val pattern = longArrayOf(0, 700, 500, 700, 500)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator?.vibrate(
          VibrationEffect.createWaveform(pattern, 0),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .build()
        )
      } else {
        @Suppress("DEPRECATION")
        vibrator?.vibrate(pattern, 0)
      }
    }
  }

  private fun stopRinging() {
    val stopped = ringingEntry
    runCatching { player?.stop() }
    runCatching { player?.release() }
    player = null

    runCatching { vibrator?.cancel() }
    vibrator = null

    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    wakeLock = null

    ringingId = null
    ringingEntry = null

    TaskAlarmEvents.emitStopped(stopped)
    AlarmActivity.finishIfShowing()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    // Covers the case where the OS tears the service down without ACTION_STOP.
    if (ringingId != null) {
      runCatching { player?.stop() }
      runCatching { player?.release() }
      runCatching { vibrator?.cancel() }
      runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
      ringingId = null
      ringingEntry = null
    }
    super.onDestroy()
  }
}
