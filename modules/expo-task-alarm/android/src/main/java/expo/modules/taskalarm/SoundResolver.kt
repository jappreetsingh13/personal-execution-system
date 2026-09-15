package expo.modules.taskalarm

import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri

/**
 * Turns a sound "spec" into a playable Uri.
 *
 * A spec is one of:
 *  - a bundled raw-resource filename, e.g. "alarm_classic.wav"
 *  - a full URI picked from the device's own ringtone library, e.g. "content://media/..."
 *  - null / empty, meaning "no sound"
 *
 * Scheme is checked BEFORE the raw-resource lookup: a content URI can legitimately contain a dot
 * (".../audio.mp3"), and stripping at the last dot before checking would send it down the resource
 * path and lose it.
 */
object SoundResolver {

  private val URI_SCHEMES = listOf("content://", "file://", "android.resource://")

  fun resolve(context: Context, spec: String?): Uri? {
    if (spec.isNullOrEmpty()) return null

    if (URI_SCHEMES.any { spec.startsWith(it) }) {
      return runCatching { Uri.parse(spec) }.getOrNull()
    }

    val base = spec.substringBeforeLast('.')
    val resId = context.resources.getIdentifier(base, "raw", context.packageName)
    if (resId != 0) return Uri.parse("android.resource://${context.packageName}/$resId")

    return null
  }

  /** Resolve, falling back to the user's default alarm tone rather than silence. */
  fun resolveAlarm(context: Context, spec: String?): Uri? =
    resolve(context, spec)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

  /**
   * SystemUI renders the notification and plays its sound in its own process, so a MediaStore URI
   * we picked has to be readable there too. Harmless when the URI needs no grant.
   */
  fun grantReadToSystem(context: Context, uri: Uri?) {
    if (uri == null || uri.scheme != "content") return
    for (pkg in listOf("com.android.systemui", "android")) {
      runCatching {
        context.grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    }
  }
}
