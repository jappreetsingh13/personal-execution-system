import React, { createContext, useContext, useMemo } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { THEMES, type Theme } from './themes';

const ThemeContext = createContext<Theme>(THEMES.daylight);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const name = useSettingsStore((s) => s.theme);
  const theme = useMemo(() => THEMES[name] ?? THEMES.daylight, [name]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
