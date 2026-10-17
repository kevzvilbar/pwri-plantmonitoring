import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export type ThemeMode = 'light' | 'dark' | 'system';

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface ThemeState {
  colorTheme: string;
  setColorTheme: (themeId: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  syncSystemDarkMode: (isSystemDark: boolean) => void;
  sunlightMode: boolean;
  toggleSunlightMode: () => void;
  previousTheme?: string;
  previousDarkMode?: boolean;
  previousThemeMode?: ThemeMode;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      colorTheme: DEFAULT_THEME_ID,
      setColorTheme: (themeId) =>
        set((s) => ({
          colorTheme: themeId,
          sunlightMode: themeId === 'outdoor-contrast',
          previousTheme: themeId !== 'outdoor-contrast' ? themeId : s.previousTheme,
        })),
      darkMode: false,
      themeMode: 'light',
      setDarkMode: (v) =>
        set((s) => {
          const exitingSunlight = s.sunlightMode && v;
          return {
            darkMode: v,
            themeMode: v ? 'dark' : 'light',
            colorTheme: exitingSunlight ? (s.previousTheme || DEFAULT_THEME_ID) : s.colorTheme,
            sunlightMode: s.sunlightMode && !v ? true : false,
            previousDarkMode: !s.sunlightMode ? v : s.previousDarkMode,
            previousThemeMode: !s.sunlightMode ? (v ? 'dark' : 'light') : s.previousThemeMode,
          };
        }),
      setThemeMode: (mode) =>
        set((s) => {
          const resolvedDark = mode === 'system' ? getSystemPrefersDark() : mode === 'dark';
          const exitingSunlight = s.sunlightMode && (mode !== 'light' || resolvedDark);
          return {
            themeMode: mode,
            darkMode: resolvedDark,
            colorTheme: exitingSunlight ? (s.previousTheme || DEFAULT_THEME_ID) : s.colorTheme,
            sunlightMode: s.sunlightMode && !exitingSunlight,
            previousDarkMode: !s.sunlightMode ? resolvedDark : s.previousDarkMode,
            previousThemeMode: !s.sunlightMode ? mode : s.previousThemeMode,
          };
        }),
      syncSystemDarkMode: (isSystemDark) =>
        set((s) => {
          if (s.themeMode !== 'system' || s.sunlightMode) return s;
          return { darkMode: isSystemDark, previousDarkMode: isSystemDark };
        }),
      sunlightMode: false,
      toggleSunlightMode: () =>
        set((s) => {
          if (s.sunlightMode) {
            const restoredMode = s.previousThemeMode ?? (s.previousDarkMode ? 'dark' : 'light');
            const restoredDark =
              s.previousDarkMode ?? (restoredMode === 'system' ? getSystemPrefersDark() : restoredMode === 'dark');
            return {
              sunlightMode: false,
              colorTheme: s.previousTheme || DEFAULT_THEME_ID,
              darkMode: restoredDark,
              themeMode: restoredMode,
            };
          } else {
            return {
              sunlightMode: true,
              previousTheme: s.colorTheme,
              previousDarkMode: s.darkMode,
              previousThemeMode: s.themeMode,
              colorTheme: 'outdoor-contrast',
              darkMode: false,
              themeMode: 'light',
            };
          }
        }),
    }),
    {
      name: 'pwri-theme-state',
      partialize: (s) => ({
        colorTheme: s.colorTheme,
        darkMode: s.darkMode,
        themeMode: s.themeMode,
        sunlightMode: s.sunlightMode,
        previousTheme: s.previousTheme,
        previousDarkMode: s.previousDarkMode,
        previousThemeMode: s.previousThemeMode,
      }),
    }
  )
);
