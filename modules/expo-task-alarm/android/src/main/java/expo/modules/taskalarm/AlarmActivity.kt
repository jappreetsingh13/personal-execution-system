package expo.modules.taskalarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Date

/**
 * The ringing screen, shown over the lock screen.
 *
 * Built programmatically rather than from XML so the module stays
 * self-contained — a local Expo module would otherwise need its own resource
 * merging set up for a single layout.
 */
class AlarmActivity : Activity() {

  companion object {
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    private const val EXTRA_ID = "id"

    @Volatile
    private var instance: AlarmActivity? = null

    fun intentFor(context: Context, entry: AlarmEntry): Intent =
      Intent(context, AlarmActivity::class.java).apply {
        putExtra(EXTRA_ID, entry.id)
        putExtra(EXTRA_TITLE, entry.title)
        putExtra(EXTRA_BODY, entry.body)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }

    /** Closed by the service once ringing actually stops. */
    fun finishIfShowing() {
      instance?.runOnUiThread { instance?.finish() }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    instance = this
    showOverLockScreen()
    setContentView(buildUi())
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
        .requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun dp(value: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP,
    value.toFloat(),
    resources.displayMetrics
  ).toInt()

  private fun buildUi(): View {
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Alarm"
    val body = intent.getStringExtra(EXTRA_BODY) ?: ""

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#12091F"))
      setPadding(dp(28), dp(56), dp(28), dp(44))
    }

    val clock = TextView(this).apply {
      text = DateFormat.getTimeFormat(this@AlarmActivity).format(Date())
      setTextColor(Color.parseColor("#C9B6F5"))
      textSize = 20f
      gravity = Gravity.CENTER
    }

    val heading = TextView(this).apply {
      text = title
      setTextColor(Color.WHITE)
      textSize = 30f
      gravity = Gravity.CENTER
      setPadding(0, dp(26), 0, 0)
    }

    val sub = TextView(this).apply {
      text = body
      setTextColor(Color.parseColor("#A79BC4"))
      textSize = 16f
      gravity = Gravity.CENTER
      visibility = if (body.isEmpty()) View.GONE else View.VISIBLE
      setPadding(0, dp(10), 0, 0)
    }

    val spacer = View(this).apply {
      layoutParams = LinearLayout.LayoutParams(0, 0, 1f)
    }

    val stop = filledButton("Stop", "#A855F7") {
      AlarmService.stop(this)
      finish()
    }

    val snooze = outlinedButton("Snooze 5 min") {
      TaskAlarmEvents.emitSnooze(AlarmService.ringingEntry)
      AlarmService.stop(this)
      finish()
    }

    root.addView(clock)
    root.addView(heading)
    root.addView(sub)
    root.addView(spacer)
    root.addView(stop)
    root.addView(snooze)
    return root
  }

  private fun filledButton(label: String, color: String, onClick: () -> Unit) =
    Button(this).apply {
      text = label
      setTextColor(Color.WHITE)
      textSize = 17f
      isAllCaps = false
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.parseColor(color))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(58)
      ).apply { topMargin = dp(12) }
      setOnClickListener { onClick() }
    }

  private fun outlinedButton(label: String, onClick: () -> Unit) =
    Button(this).apply {
      text = label
      setTextColor(Color.parseColor("#C9B6F5"))
      textSize = 16f
      isAllCaps = false
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.TRANSPARENT)
        setStroke(dp(1), Color.parseColor("#4B3A6E"))
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(54)
      ).apply { topMargin = dp(12) }
      setOnClickListener { onClick() }
    }

  /** The back button must not silently leave the alarm ringing. */
  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    AlarmService.stop(this)
    super.onBackPressed()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }
}
