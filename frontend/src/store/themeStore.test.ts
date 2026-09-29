import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './themeStore';
import { DEFAULT_THEME_ID } from '@/lib/themes';

// Mock DEFAULT_THEME_ID if necessary or just use the imported one. 
// Assuming it's correctly exported from @/lib/themes

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({
      colorTheme: DEFAULT_THEME_ID || 'default',
      darkMode: false,
    });
  });

  it('should have correct initial default theme and dark mode', () => {
    const state = useThemeStore.getState();
    expect(state.colorTheme).toBe(DEFAULT_THEME_ID || 'default');
    expect(state.darkMode).toBe(false);
  });

  it('should change theme correctly', () => {
    useThemeStore.getState().setColorTheme('ocean');
    expect(useThemeStore.getState().colorTheme).toBe('ocean');
  });

  it('should toggle dark mode correctly', () => {
    useThemeStore.getState().setDarkMode(true);
    expect(useThemeStore.getState().darkMode).toBe(true);

    useThemeStore.getState().setDarkMode(false);
    expect(useThemeStore.getState().darkMode).toBe(false);
  });

  it('should toggle sunlight mode correctly and restore previous theme', () => {
    useThemeStore.getState().setColorTheme('nordic-aurora');
    useThemeStore.getState().setDarkMode(true);

    // Toggle on
    useThemeStore.getState().toggleSunlightMode();
    expect(useThemeStore.getState().sunlightMode).toBe(true);
    expect(useThemeStore.getState().colorTheme).toBe('outdoor-contrast');
    expect(useThemeStore.getState().darkMode).toBe(false);

    // Toggle off - restores nordic-aurora and dark mode
    useThemeStore.getState().toggleSunlightMode();
    expect(useThemeStore.getState().sunlightMode).toBe(false);
    expect(useThemeStore.getState().colorTheme).toBe('nordic-aurora');
    expect(useThemeStore.getState().darkMode).toBe(true);
  });
});
