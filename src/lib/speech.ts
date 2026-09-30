/**
 * The speech-recognition native module is present only in a dev/production
 * build — Expo Go cannot load it, and importing it there throws. Cache the
 * result of a guarded require so callers get `null` instead of a crash and can
 * hide the voice option.
 */
type SpeechModule = typeof import('expo-speech-recognition');

let cached: SpeechModule | null | undefined;

export function speechModule(): SpeechModule | null {
  if (cached === undefined) {
    try {
      cached = require('expo-speech-recognition') as SpeechModule;
    } catch {
      cached = null;
    }
  }
  return cached;
}
