import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export interface ThemeState {
  colorTheme: string;
  setColorTheme: (themeId: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  sunlightMode: boolean;
  toggleSunlightMode: () => void;
  previousTheme?: string;
  previousDarkMode?: boolean;
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
      setDarkMode: (v) =>
        set((s) => ({
          darkMode: v,
          sunlightMode: s.sunlightMode && !v ? true : false,
          previousDarkMode: !s.sunlightMode ? v : s.previousDarkMode,
        })),
      sunlightMode: false,
      toggleSunlightMode: () =>
        set((s) => {
          if (s.sunlightMode) {
            return {
              sunlightMode: false,
              colorTheme: s.previousTheme || DEFAULT_THEME_ID,
              darkMode: s.previousDarkMode ?? false,
            };
          } else {
            return {
              sunlightMode: true,
              previousTheme: s.colorTheme,
              previousDarkMode: s.darkMode,
              colorTheme: 'outdoor-contrast',
              darkMode: false,
            };
          }
        }),
    }),
    {
      name: 'pwri-theme-state',
      partialize: (s) => ({
        colorTheme: s.colorTheme,
        darkMode: s.darkMode,
        sunlightMode: s.sunlightMode,
        previousTheme: s.previousTheme,
        previousDarkMode: s.previousDarkMode,
      }),
    }
  )
);
