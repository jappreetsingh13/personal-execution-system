package expo.modules.streakwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.app.PendingIntent
import android.view.View
import android.widget.RemoteViews

/**
 * The home-screen widget. It is deliberately self-sufficient: the numbers come
 * from SharedPreferences (written by JS through [StreakWidgetModule]), and the
 * catchy line is picked from wall-clock time inside `onUpdate`, so it rotates
 * on its own every 4 hours even if the app is never opened in between. The
 * system re-runs `onUpdate` at least every `updatePeriodMillis` (30 min).
 */
class StreakWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = buildViews(context)
    for (id in appWidgetIds) manager.updateAppWidget(id, views)
  }

  companion object {
    private const val PREFS = "streak_widget"

    /** Rotated by 4-hour bucket, so returning to the screen usually shows something new. */
    private val MESSAGES = listOf(
      "You are doing great today 💜",
      "Every small step counts 🌱",
      "You showed up — that's the win 🌟",
      "One task at a time, you've got this 💪",
      "Progress is progress, however small ✨",
      "Today is full of possibility 🌅",
      "You are stronger than you think 💜",
      "Small wins build big things ✨",
      "Believe in your momentum 🔥",
      "Your effort today shapes tomorrow 🌅"
    )

    fun messageFor(nowMs: Long = System.currentTimeMillis()): String =
      MESSAGES[((nowMs / FOUR_HOURS_MS) % MESSAGES.size).toInt()]

    private const val FOUR_HOURS_MS = 4L * 60 * 60 * 1000

    fun buildViews(context: Context): RemoteViews {
      val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val streak = prefs.getInt("streak", 0)
      val done = prefs.getInt("doneToday", 0)
      val total = prefs.getInt("totalToday", 0)

      val views = RemoteViews(context.packageName, R.layout.streak_widget)
      views.setTextViewText(R.id.streak_value, "🔥 $streak")
      views.setTextViewText(
        R.id.widget_message,
        if (streak == 0) "Tap in and start your streak 🔥" else messageFor()
      )
      if (total > 0) {
        views.setViewVisibility(R.id.widget_bar, View.VISIBLE)
        views.setProgressBar(R.id.widget_bar, 100, (done * 100) / total, false)
        views.setTextViewText(R.id.widget_progress, "$done of $total done today")
      } else {
        views.setViewVisibility(R.id.widget_bar, View.GONE)
        views.setTextViewText(R.id.widget_progress, "Nothing planned yet — add a task")
      }

      // The whole widget is one big tap target back into the app.
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        val pending = PendingIntent.getActivity(
          context,
          0,
          launch,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pending)
      }
      return views
    }

    /** Repaint every placed widget with the latest stored data. */
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, StreakWidgetProvider::class.java))
      if (ids.isEmpty()) return
      val views = buildViews(context)
      manager.updateAppWidget(ids, views)
    }
  }
}
