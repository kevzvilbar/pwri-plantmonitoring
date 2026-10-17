import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './themeStore';
import { COLOR_THEMES, DEFAULT_THEME_ID, getThemeById } from '@/lib/themes';

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({
      colorTheme: DEFAULT_THEME_ID || 'default',
      darkMode: false,
      themeMode: 'light',
      sunlightMode: false,
      previousTheme: undefined,
      previousDarkMode: undefined,
      previousThemeMode: undefined,
    });
  });

  it('should have correct initial default theme and dark mode', () => {
    const state = useThemeStore.getState();
    expect(state.colorTheme).toBe(DEFAULT_THEME_ID || 'default');
    expect(state.darkMode).toBe(false);
    expect(state.themeMode).toBe('light');
  });

  it('should change theme correctly', () => {
    useThemeStore.getState().setColorTheme('ocean');
    expect(useThemeStore.getState().colorTheme).toBe('ocean');
  });

  it('should toggle dark mode correctly and sync themeMode', () => {
    useThemeStore.getState().setDarkMode(true);
    expect(useThemeStore.getState().darkMode).toBe(true);
    expect(useThemeStore.getState().themeMode).toBe('dark');

    useThemeStore.getState().setDarkMode(false);
    expect(useThemeStore.getState().darkMode).toBe(false);
    expect(useThemeStore.getState().themeMode).toBe('light');
  });

  it('should support system themeMode and syncSystemDarkMode', () => {
    useThemeStore.getState().setThemeMode('system');
    expect(useThemeStore.getState().themeMode).toBe('system');

    useThemeStore.getState().syncSystemDarkMode(true);
    expect(useThemeStore.getState().darkMode).toBe(true);

    useThemeStore.getState().syncSystemDarkMode(false);
    expect(useThemeStore.getState().darkMode).toBe(false);
  });

  it('should toggle sunlight mode correctly and restore previous theme and themeMode', () => {
    useThemeStore.getState().setColorTheme('nordic-aurora');
    useThemeStore.getState().setThemeMode('system');
    useThemeStore.getState().syncSystemDarkMode(true);

    // Toggle on
    useThemeStore.getState().toggleSunlightMode();
    expect(useThemeStore.getState().sunlightMode).toBe(true);
    expect(useThemeStore.getState().colorTheme).toBe('outdoor-contrast');
    expect(useThemeStore.getState().darkMode).toBe(false);
    expect(useThemeStore.getState().themeMode).toBe('light');

    // Toggle off - restores nordic-aurora, system mode, and dark mode
    useThemeStore.getState().toggleSunlightMode();
    expect(useThemeStore.getState().sunlightMode).toBe(false);
    expect(useThemeStore.getState().colorTheme).toBe('nordic-aurora');
    expect(useThemeStore.getState().darkMode).toBe(true);
    expect(useThemeStore.getState().themeMode).toBe('system');
  });

  it('should restore previousTheme when exiting sunlight mode via setDarkMode(true)', () => {
    useThemeStore.getState().setColorTheme('cosmic-spark');
    useThemeStore.getState().toggleSunlightMode();
    expect(useThemeStore.getState().colorTheme).toBe('outdoor-contrast');

    useThemeStore.getState().setDarkMode(true);
    expect(useThemeStore.getState().sunlightMode).toBe(false);
    expect(useThemeStore.getState().colorTheme).toBe('cosmic-spark');
    expect(useThemeStore.getState().darkMode).toBe(true);
    expect(useThemeStore.getState().themeMode).toBe('dark');
  });

  it('should register all 12 CSS color themes including cosmic-spark with meta theme colors', () => {
    expect(COLOR_THEMES).toHaveLength(12);
    const cosmic = getThemeById('cosmic-spark');
    expect(cosmic.id).toBe('cosmic-spark');
    expect(cosmic.name).toBe('Cosmic Spark');
    expect(cosmic.themeColorLight).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(cosmic.themeColorDark).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

