import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

declare class StreakWidgetNativeModule extends NativeModule<{}> {
  /** Persist the latest numbers and repaint every placed widget. */
  updateData(streak: number, doneToday: number, totalToday: number): void;
  /** Whether at least one widget is currently placed on a home screen. */
  isAdded(): boolean;
  /** Android 8+ system "add widget" dialog; false when unsupported. */
  requestPin(): boolean;
}

/**
 * Android-only, and absent in Expo Go (which cannot load custom native code).
 * `requireOptionalNativeModule` returns null there instead of throwing, so the
 * app keeps working and the Settings entry simply hides itself.
 */
const native = requireOptionalNativeModule<StreakWidgetNativeModule>('ExpoStreakWidget');

export const StreakWidget = {
  available: Platform.OS === 'android' && native != null,

  updateData(streak: number, doneToday: number, totalToday: number): void {
    native?.updateData(streak, doneToday, totalToday);
  },
  isAdded(): boolean {
    return native?.isAdded() ?? false;
  },
  requestPin(): boolean {
    return native?.requestPin() ?? false;
  },
};

export default StreakWidget;
