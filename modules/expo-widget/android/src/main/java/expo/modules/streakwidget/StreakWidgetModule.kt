package expo.modules.streakwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS side of the streak widget: push numbers, ask the launcher to pin the
 * widget, and report whether one is already placed. All numbers are written to
 * SharedPreferences rather than kept in memory — the widget process reads them
 * long after JS is gone.
 */
class StreakWidgetModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("ExpoStreakWidget")

    /** Store the latest numbers and repaint every placed widget. */
    Function("updateData") { streak: Int, doneToday: Int, totalToday: Int ->
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putInt("streak", streak)
        .putInt("doneToday", doneToday)
        .putInt("totalToday", totalToday)
        .apply()
      StreakWidgetProvider.updateAll(context)
    }

    Function("isAdded") {
      val manager = AppWidgetManager.getInstance(context)
        ?: return@Function false
      manager
        .getAppWidgetIds(ComponentName(context, StreakWidgetProvider::class.java))
        .isNotEmpty()
    }

    /**
     * Android 8+ can ask the launcher to pin the widget through a system
     * dialog. One widget is the design — a second one would just repeat the
     * same numbers — so this refuses once one is placed; the caller then shows
     * manual instructions or nothing at all.
     */
    Function("requestPin") {
      val manager = AppWidgetManager.getInstance(context)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        manager != null &&
        manager.isRequestPinAppWidgetSupported &&
        manager
          .getAppWidgetIds(ComponentName(context, StreakWidgetProvider::class.java))
          .isEmpty()
      ) {
        manager.requestPinAppWidget(
          ComponentName(context, StreakWidgetProvider::class.java),
          null,
          null
        )
        true
      } else {
        false
      }
    }
  }
}

private const val PREFS = "streak_widget"
