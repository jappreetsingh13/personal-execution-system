# Todos

A local-only notes + tasks app. Everything lives in on-device storage — no backend, no account,
no sync. Built with Expo SDK 57 and expo-router, targeting **Android**.

## Run it

Custom notification tunes and exact alarm timing both need native code, so this does not run its
full feature set in Expo Go.

### Standalone (for actually using it)

```bash
npx eas-cli build --platform android --profile preview
```

Produces a self-contained APK with the JS bundled in. **No computer needed after install** — it
launches and works entirely on the phone, offline, and all data stays in on-device storage.
Rebuild and reinstall when you want code changes; your saved notes and tasks survive an
install-over-the-top (only uninstalling clears them).

### Development (for changing code)

```bash
npx eas-cli build --platform android --profile development   # once
npx expo start --dev-client                                   # each session
```

The dev build connects to your machine over Wi-Fi and hot-reloads JS edits. Note that changes to
**sound files, icons, permissions or native modules do not hot-reload** — those are baked into the
APK and need a fresh build.

Either build takes ~10–20 min on Expo's servers (free tier: 15 Android builds/month). When it
finishes, scan the QR **with your phone's camera** to download and install — Android will ask you
to allow installing from unknown sources. Grant the notification permission on first launch, or
reminders and alarms cannot fire.

## The four tabs

**Notes** — 5 importance colours, search, importance filter, and accordion sections for links and
references. No dates; a note stays until you delete it.

**Tasks** — a day view grouped by hour, so two tasks at 11am both sit against the 11 AM slot. Each
task has a time, 5 importance colours, a **Start** button and a checkbox you can tick or untick at
any hour, including days in the past. Repeat options: one time, every day, pick days (Mon–Fri),
every other day, or hand-picked dates. The calendar icon jumps to any date; **Today keeps its
filled highlight** while whichever day you're viewing is outlined, so you never lose your anchor.

**Statistics** — daily / weekly / monthly / yearly. One segmented bar split by status with the
total and each count in numbers, three buttons that drill into a bucket grouped by date, and — on
yearly — a 12-month stacked chart plus a per-month completion-rate table. Drill-down rows have live
checkboxes, so ticking an old task updates the bar immediately.

**Settings** — 4 themes (Blossom, Midnight, Harbor, Daylight), alarm sound, notification sound,
the daily-summary switch, and alarm reliability diagnostics.

### Things worth knowing

- **Notes ↔ tasks are many-to-many**, editable from either side. The relation is stored on both
  records and mirrored on save (`syncLinksFromNote` / `syncLinksFromTask`) so the two copies cannot
  drift.
- **Editors auto-save on back.** There is no Save button; a `beforeRemove` listener persists
  whatever is on screen. Deleting sets an `abandoned` flag so the save doesn't resurrect the record.
- **Long-press** a note or task row for a menu: share, pin/shift, mark done, delete. It is a themed
  bottom sheet rather than `Alert`, because Android's dialog only has three button slots.
- **Share** a note or task as `.txt`, `.pdf` or `.docx` — from the long-press menu or the share icon
  in either editor. The `.docx` is a real OOXML package built with `fflate`, not renamed HTML.
- **Shifting a task** records `movedTo` under the **original** date, so the day it came from is
  never lost — the moved row shows a "from 13 Sep" badge and can be undone. Reminders and the alarm
  move with it.
- **Repeats can have an end date.** Start and end rows appear for every repeating kind; clearing the
  end date means "forever". An end before the start is clamped rather than rejected.
- **Daily check-ins** at 1:00 PM and 9:30 PM carry the live count of what is still unfinished, plus
  a Monday 8:00 AM note with last week's completion rate. Switch them off in Settings.
- **Opening a task without a date** (from a note's linked chip) resolves to the day the task is
  actually about — today if it runs today, else the next occurrence, else the most recent past one.
  Defaulting to today made a task finished yesterday read back as *Not Started, Overdue*.

### The three statuses

| Status | Means |
| --- | --- |
| **Done** | ticked |
| **In Progress** | you tapped Start and haven't ticked it — stays here even after its time passes |
| **Not Started** | not ticked, not started |

**Overdue** is deliberately a flag, not a fourth bucket: being late doesn't change what you did
with a task, only how it's drawn. It tints the row and the editor's status banner, and stays out of
the statistics split.

## The alarm is a real alarm

Alarms do **not** go through `expo-notifications`. A notification plays its sound once through and
cannot take over the lock screen, which makes it a chime, not an alarm. Instead there is a local
native module at `modules/expo-task-alarm/`:

| Piece | Why |
| --- | --- |
| `AlarmManager.setAlarmClock` | The only API Android treats as a user-facing alarm — fires exactly even in Doze, exempt from battery optimisation, shows the status-bar alarm icon. What the stock Clock app uses. |
| `AlarmService` (foreground service) | Survives the app being backgrounded or killed. Loops `MediaPlayer` on `USAGE_ALARM` and holds a wake lock, so it rings until a human stops it. |
| Full-screen intent → `AlarmActivity` | `setShowWhenLocked` + `setTurnScreenOn` puts the ringing screen over the keyguard, with Stop and Snooze. |
| `AlarmStore` + `BootReceiver` | AlarmManager forgets everything on reboot and JS is not running at boot, so pending alarms are persisted natively and re-armed by the boot receiver. |

Reminders (T-30 / T-5) still use `expo-notifications` — those genuinely are notifications.

The module is Android-only and absent in Expo Go, which cannot load custom native code.
`requireOptionalNativeModule` returns null there and the app falls back to a notification-based
alarm, so nothing crashes — it just is not a real alarm until you install the built app.

Three Android settings can degrade this. Settings re-checks all three on focus (they are changed
while the app is backgrounded, so checking once at render was useless) and shows a deep link for
each one that is off:

- **Exact alarms** (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`) — without it, timing drifts.
- **Full-screen intents** (`USE_FULL_SCREEN_INTENT`) — without it the alarm still rings, but as a
  notification rather than taking over the lock screen.
- **Battery optimisation** — the most common cause of a late or missing alarm on Samsung/Xiaomi/
  OnePlus builds, and the one people never think to check.

Alarms are armed **outside** the notification-permission gate. They are AlarmManager entries plus a
foreground service, and have no business disappearing because notifications were declined — which
is exactly what used to happen.

## Sounds and alarm timing

Two pieces of native config make these work, both already in `app.json`:

1. **Custom tunes.** Android ≥ 8 takes a notification's sound from its *channel*, and channel sounds
   must exist as native raw resources. The `expo-notifications` plugin's `sounds` array copies the
   files in `assets/sounds/` to `android/app/src/main/res/raw/` at build time. Swap those four files
   (keeping the names) to use your own tunes, then rebuild.
2. **Exact alarms.** `expo-notifications` declares neither exact-alarm permission, and its scheduler
   silently falls back to *inexact* alarms when `canScheduleExactAlarms()` is false — drifting by
   minutes under Doze. `android.permissions` therefore declares `USE_EXACT_ALARM` (auto-granted on
   Android 14+) and `SCHEDULE_EXACT_ALARM` (Android 12–13).

If you ever publish this, note Google Play restricts `USE_EXACT_ALARM` to genuine alarm/clock/
calendar apps — fine for this one, but it needs justification at review.

**Channels are created natively, not by expo-notifications.** This is the load-bearing decision
behind sound selection. `expo-notifications` can only point a channel at a bundled raw resource, so
a tone chosen from the phone's ringtone library could never reach a reminder. Android's own
`NotificationChannel.setSound(uri, attrs)` takes any Uri, so `Channels.kt` in the local module
creates them instead, and `expo-notifications` merely schedules onto the resulting id. Its builder
resolves `trigger.channelId` through the real `NotificationManager`, so a channel we made is found
and used — and on Android ≥ 8 the channel's sound wins over anything set on the notification.

**Using your own phone's ringtones.** Settings → *From my phone* opens
`RingtoneManager.ACTION_RINGTONE_PICKER` through the module's `OnActivityResult` handler and stores
the returned `content://` URI. The same URI is handed to `AlarmService` for alarms, so one choice
covers both paths. (The commonly cited "content URIs don't work for notification sounds" problem is
about FileProvider URIs; MediaStore ringtone URIs are readable by SystemUI, and the module grants
read permission anyway.)

**Channel ids embed a hash of their sound.** Android channels are immutable once created — changing
an existing channel's sound is silently ignored, which is the classic cause of "notifications arrive
but make no sound". So `src/lib/channels.ts` derives the id from the chosen sound, meaning a new
tone always lands on a brand-new channel. There is still a manual `VERSION` suffix — now `v3` — for
changing anything *else* about a channel. Superseded channels are swept up by
`deleteChannelsExcept`, or app settings would fill with a dead channel per tune ever tried.

(v1 → v2 fixed channels created silent by an `isExpoGo` bug. v2 → v3 moved creation to the native
module and made ids sound-addressed; v2 channels could carry a muted sound or an override that
never applied, and neither is repairable in place.)

The app still runs in Expo Go if you want a quick look (`npx expo start`) — everything works except
custom notification sounds and device tones, which fall back to the system default. The in-app alarm
ringer plays your chosen tune either way, since `expo-audio` plays bundled assets directly.

**Previewing a tune** uses a generation token claimed *synchronously* before any `await`. The
earlier version assigned the player to its ref only after awaiting `setAudioModeAsync`, so a second
tap during that window created a second player and orphaned the first with no handle to stop it —
which is why previews stacked and only closing the app silenced them.

## How it's built

```
app/                 expo-router routes
  (tabs)/            the 4 tabs
  note/[id].tsx      note add / edit / delete
  task/[id].tsx      task add / edit / delete
  alarm.tsx          full-screen ringer
src/
  store/             zustand + AsyncStorage persistence
  theme/             4 palettes + provider
  lib/               date, recurrence, status, notifications, channels, digest, export
  components/        shared UI
assets/sounds/       4 synthesised tunes (swap the files to use your own)
```

### Two decisions worth knowing

**Occurrences are computed, not stored.** A task's rule is saved once; which days it lands on is
derived on demand. Only *deviations* from the default get persisted, keyed `taskId|YYYY-MM-DD`.
That's what lets you shift *today's* 5pm to 7pm without touching the rule, tick last Tuesday late,
and keep per-day statistics honest — from a few hundred bytes.

**Notifications use a rolling window.** A recurring task generates reminders forever, so they can't
all be scheduled. The app schedules the soonest across a sliding window and refreshes it on every
launch, foreground and edit, under separate budgets so digests can never crowd out reminders:

| | Horizon | Budget |
| --- | --- | --- |
| Reminders (T-30 / T-5) | 14 days | 96 |
| Daily check-ins + Monday stats | 7 days | 40 |
| Native alarms | 60 days | 100 |

Alarms reach furthest because they are AlarmManager entries rather than pending notifications —
nearly free, and an alarm that quietly expires because the app wasn't opened for a fortnight is the
worst possible failure for the feature. Digests reach least far because today's copy carries a live
count, so ticking a box rewrites the pending set. They are reconciled through one native
`replaceAll` that diffs in memory and writes its store once; scheduling them individually meant
rewriting that store per alarm, on the JS thread, every time a checkbox moved.

## Checks

```bash
npx tsc --noEmit && npx expo export --platform android
```

`expo export` pushes every route through Metro, so bad imports or missing assets surface without a
device.
