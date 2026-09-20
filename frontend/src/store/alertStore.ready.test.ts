import { describe, it, expect } from 'vitest';
import { useAlertStore } from '@/store/alertStore';

/** P2-7: alertsReady gates the bell empty state. */
describe('alertsReady (P2-7)', () => {
  it('starts false and flips on the first addAlerts', () => {
    useAlertStore.setState({ plantAlerts: [], snoozeMap: {}, alertsReady: false });
    expect(useAlertStore.getState().alertsReady).toBe(false);
    useAlertStore.getState().addAlerts([]);
    expect(useAlertStore.getState().alertsReady).toBe(true);
  });
});
