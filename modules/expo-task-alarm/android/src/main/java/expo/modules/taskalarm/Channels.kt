package expo.modules.taskalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.os.Build

/**
 * Notification channels, created natively.
 *
 * expo-notifications can only point a channel at a bundled raw resource, so a tone chosen from the
 * device's ringtone library could never be used for reminders. `NotificationChannel.setSound` takes
 * any Uri, so creating the channels here is what makes "use a sound from my phone" actually work.
 *
 * Channels are immutable once created — the sound of an existing channel can never be changed. The
 * JS side works around that by deriving the channel id from the chosen sound, so picking a new tone
 * always lands on a brand-new channel instead of silently doing nothing.
 */
object Channels {

  private fun manager(context: Context) =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun create(
    context: Context,
    id: String,
    name: String,
    description: String?,
    importance: Int,
    soundSpec: String?,
    alarmUsage: Boolean,
    vibrate: Boolean,
    vibrationPattern: LongArray?,
    bypassDnd: Boolean
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val nm = manager(context)
    // Re-creating an existing channel is a no-op for everything but name/description, so bail out
    // rather than give the impression a new sound took effect.
    if (nm.getNotificationChannel(id) != null) return

    val channel = NotificationChannel(id, name, importance).apply {
      if (description != null) this.description = description
      enableVibration(vibrate)
      if (vibrate && vibrationPattern != null) this.vibrationPattern = vibrationPattern
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(bypassDnd)

      val uri = SoundResolver.resolve(context, soundSpec)
      if (uri == null) {
        setSound(null, null)
      } else {
        SoundResolver.grantReadToSystem(context, uri)
        val attrs = AudioAttributes.Builder()
          .setUsage(
            if (alarmUsage) AudioAttributes.USAGE_ALARM
            else AudioAttributes.USAGE_NOTIFICATION
          )
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        setSound(uri, attrs)
      }
    }

    nm.createNotificationChannel(channel)
  }

  fun exists(context: Context, id: String): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return manager(context).getNotificationChannel(id) != null
  }

  fun ids(context: Context): List<String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
    return runCatching { manager(context).notificationChannels.map { it.id } }.getOrDefault(emptyList())
  }

  /**
   * Remove channels that are no longer referenced — older sound choices and superseded versions.
   * Without this the app's notification settings fill up with a dead channel per tune ever tried.
   */
  fun deleteExcept(context: Context, prefixes: List<String>, keep: List<String>) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = manager(context)
    val kept = keep.toSet()
    for (channel in runCatching { nm.notificationChannels }.getOrDefault(emptyList())) {
      val id = channel.id
      if (id in kept) continue
      if (prefixes.none { id.startsWith(it) }) continue
      runCatching { nm.deleteNotificationChannel(id) }
    }
  }
}
