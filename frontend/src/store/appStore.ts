// Backward-compatibility facade — prefer importing from the specific stores directly.
// This file re-exports all state and actions so existing imports don't break.
export { usePlantStore, type PlantState } from './plantStore';
export { useChartStore, type ChartState } from './chartStore';
export { useAlertStore, type AlertState, type PlantAlert, type PlantAlertSeverity, type SnoozeMap, isAlertSnoozed } from './alertStore';
export { useThemeStore, type ThemeState } from './themeStore';

import { usePlantStore } from './plantStore';
import { useChartStore } from './chartStore';
import { useAlertStore } from './alertStore';
import { useThemeStore } from './themeStore';

// Legacy combined hook — subscribes to ALL stores (causes unnecessary re-renders).
// Migrate callers to use specific stores with selectors instead.
export function useAppStore(): ReturnType<typeof usePlantStore.getState> & ReturnType<typeof useChartStore.getState> & ReturnType<typeof useAlertStore.getState> & ReturnType<typeof useThemeStore.getState>;
export function useAppStore<T>(selector: (s: ReturnType<typeof usePlantStore.getState> & ReturnType<typeof useChartStore.getState> & ReturnType<typeof useAlertStore.getState> & ReturnType<typeof useThemeStore.getState>) => T): T;
export function useAppStore(selector?: any) {
  const plant = usePlantStore();
  const chart = useChartStore();
  const alert = useAlertStore();
  const theme = useThemeStore();
  const combined = { ...plant, ...chart, ...alert, ...theme };
  return selector ? selector(combined) : combined;
}

// Legacy .getState() support for refs like useAuth.tsx's setActiveOperatorIdRef
useAppStore.getState = () => ({
  ...usePlantStore.getState(),
  ...useChartStore.getState(),
  ...useAlertStore.getState(),
  ...useThemeStore.getState(),
});
