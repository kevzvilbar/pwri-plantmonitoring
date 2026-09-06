import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME_ID } from '@/lib/themes';

export interface ThemeState {
  colorTheme: string;
  setColorTheme: (themeId: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      colorTheme: DEFAULT_THEME_ID,
      setColorTheme: (themeId) => set({ colorTheme: themeId }),
      darkMode: false,
      setDarkMode: (v) => set({ darkMode: v }),
    }),
    {
      name: 'pwri-theme-state',
      partialize: (s) => ({
        colorTheme: s.colorTheme,
        darkMode: s.darkMode,
      }),
    }
  )
);
