package expo.modules.taskalarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One scheduled alarm.
 *
 * `taskId` and `date` are carried through untouched so JS can tie a ringing
 * alarm back to the exact occurrence it came from.
 */
data class AlarmEntry(
  val id: String,
  val triggerAtMs: Long,
  val title: String,
  val body: String,
  val soundName: String?,
  val taskId: String?,
  val date: String?
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("triggerAtMs", triggerAtMs)
    put("title", title)
    put("body", body)
    put("soundName", soundName ?: JSONObject.NULL)
    put("taskId", taskId ?: JSONObject.NULL)
    put("date", date ?: JSONObject.NULL)
  }

  companion object {
    /** Null-safe read: avoids optString(name, null), whose fallback parameter
     *  is non-null annotated on some SDK levels. */
    private fun JSONObject.optNullableString(name: String): String? =
      if (isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }

    fun fromJson(o: JSONObject) = AlarmEntry(
      id = o.getString("id"),
      triggerAtMs = o.getLong("triggerAtMs"),
      title = o.optNullableString("title") ?: "Alarm",
      body = o.optNullableString("body") ?: "",
      soundName = o.optNullableString("soundName"),
      taskId = o.optNullableString("taskId"),
      date = o.optNullableString("date")
    )
  }
}

/**
 * Persists scheduled alarms in SharedPreferences.
 *
 * AlarmManager drops everything on reboot, and the JS layer is not running at
 * boot to re-schedule, so the native side has to own this list itself.
 */
object AlarmStore {
  private const val PREFS = "expo.modules.taskalarm.alarms"
  private const val KEY = "entries"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  fun all(context: Context): List<AlarmEntry> {
    val raw = prefs(context).getString(KEY, null) ?: return emptyList()
    return runCatching {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { AlarmEntry.fromJson(arr.getJSONObject(it)) }
    }.getOrDefault(emptyList())
  }

  /** Replace the whole set in one write — see AlarmScheduler.replaceAll. */
  @Synchronized
  fun replace(context: Context, entries: List<AlarmEntry>) = write(context, entries)

  @Synchronized
  private fun write(context: Context, entries: List<AlarmEntry>) {
    val arr = JSONArray()
    entries.forEach { arr.put(it.toJson()) }
    prefs(context).edit().putString(KEY, arr.toString()).apply()
  }

  @Synchronized
  fun put(context: Context, entry: AlarmEntry) {
    write(context, all(context).filterNot { it.id == entry.id } + entry)
  }

  @Synchronized
  fun remove(context: Context, id: String) {
    write(context, all(context).filterNot { it.id == id })
  }

  @Synchronized
  fun clear(context: Context) = write(context, emptyList())

  fun find(context: Context, id: String): AlarmEntry? = all(context).firstOrNull { it.id == id }

  /** Drop anything already in the past — used when re-arming after a reboot. */
  @Synchronized
  fun pruneExpired(context: Context, now: Long = System.currentTimeMillis()): List<AlarmEntry> {
    val live = all(context).filter { it.triggerAtMs > now }
    write(context, live)
    return live
  }
}
