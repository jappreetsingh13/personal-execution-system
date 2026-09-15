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

**Settings** — 4 themes (Blossom, Midnight, Harbor, Daylight), alarm tune, notification tune.

### Things worth knowing

- **Notes ↔ tasks are many-to-many**, editable from either side. The relation is stored on both
  records and mirrored on save (`syncLinksFromNote` / `syncLinksFromTask`) so the two copies cannot
  drift.
- **Editors auto-save on back.** There is no Save button; a `beforeRemove` listener persists
  whatever is on screen. Deleting sets an `abandoned` flag so the save doesn't resurrect the record.
- **Long-press** a note or task row to delete it, with a confirmation. Long-pressing a task also
  offers *Shift to tomorrow*.
- **Shifting a task** records `movedTo` under the **original** date, so the day it came from is
  never lost — the moved row shows a "from 13 Sep" badge and can be undone.

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

Two Android permissions can be revoked by the user and will degrade this; Settings surfaces a
prompt with a deep link when either is off:

- **Exact alarms** (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`) — without it, timing drifts.
- **Full-screen intents** (`USE_FULL_SCREEN_INTENT`) — without it the alarm still rings, but as a
  notification rather than taking over the lock screen.

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

**Using your own phone's ringtones.** Settings → *Use a sound from my phone* deep-links to
Android's own per-channel sound picker, which lists every ringtone and alarm tone on the device.
Whatever you pick there wins over the bundled tune. There is no Expo API for reading the ringtone
library, so this is the way to get full device-tune choice with no native module.

**Changing a tune's file requires a new channel id.** Android notification channels are immutable
once created, so re-creating one with a different sound is silently ignored. The ids in
`src/lib/channels.ts` carry a version suffix — currently `-v2` — which must be bumped whenever a
sound file changes. (v1 → v2 happened because v1's channels were created silent: `isExpoGo` was
testing `executionEnvironment === 'storeClient'`, which is true for a dev build as well as Expo Go,
so the sound was stripped from every channel. It now tests `appOwnership === 'expo'`, which is the
only field that separates the two.)

The app still runs in Expo Go if you want a quick look (`npx expo start`) — everything works except
notification sounds, which fall back to the system default. The in-app alarm ringer plays your
chosen tune either way, since `expo-audio` plays bundled assets directly.

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
  lib/               date, recurrence, status, notifications, channels
  components/        shared UI
assets/sounds/       4 synthesised tunes (swap the files to use your own)
```

### Two decisions worth knowing

**Occurrences are computed, not stored.** A task's rule is saved once; which days it lands on is
derived on demand. Only *deviations* from the default get persisted, keyed `taskId|YYYY-MM-DD`.
That's what lets you shift *today's* 5pm to 7pm without touching the rule, tick last Tuesday late,
and keep per-day statistics honest — from a few hundred bytes.

**Notifications use a rolling window.** A recurring task generates reminders forever, so they can't
all be scheduled. The app schedules the soonest 56 across the next 14 days and slides that window
forward on every launch, foreground and edit. 56 stays under iOS's hard 64-request cap, so the same
scheduler works unchanged if this ever ships there.

## Checks

```bash
npx tsc --noEmit && npx expo export --platform android
```

`expo export` pushes every route through Metro, so bad imports or missing assets surface without a
device.
