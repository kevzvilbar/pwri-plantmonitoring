import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAlertStore, isAlertSnoozed, PlantAlert } from './alertStore';

const mockAlert: PlantAlert = {
  id: 'alert-1',
  severity: 'critical',
  title: 'Test Alert',
  description: 'Test description',
  source: 'Test Source',
  plantId: 'plant-1',
  timestamp: Date.now(),
};

describe('useAlertStore', () => {
  beforeEach(() => {
    useAlertStore.setState({
      plantAlerts: [],
      snoozeMap: {},
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should have correct initial state', () => {
    const state = useAlertStore.getState();
    expect(state.plantAlerts).toEqual([]);
    expect(state.snoozeMap).toEqual({});
  });

  it('should add alerts and deduplicate by id', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(1);
    
    // Add same alert, should dedupe
    useAlertStore.getState().addAlerts([{ ...mockAlert, title: 'Updated' }]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(1);
    expect(useAlertStore.getState().plantAlerts[0].title).toBe('Updated');
  });

  it('should not add snoozed alerts', () => {
    useAlertStore.getState().snoozeAlert('alert-1'); // Snoozes for 1 hour by default
    useAlertStore.getState().addAlerts([mockAlert]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(0);
  });

  it('should remove alerts and add them to snoozeMap with 5 min expiration', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().removeAlerts(['alert-1']);
    const state = useAlertStore.getState();
    expect(state.plantAlerts).toHaveLength(0);
    expect(state.snoozeMap['alert-1']).toBeGreaterThan(Date.now());
    expect(state.snoozeMap['alert-1']).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  });

  it('should clear alerts', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().clearAlerts();
    expect(useAlertStore.getState().plantAlerts).toHaveLength(0);
  });

  it('should snooze alert, removing it from plantAlerts', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().snoozeAlert('alert-1', 10000); // 10 seconds
    const state = useAlertStore.getState();
    expect(state.plantAlerts).toHaveLength(0);
    expect(state.snoozeMap['alert-1']).toBe(Date.now() + 10000);
  });

  it('should unsnooze alert', () => {
    useAlertStore.getState().snoozeAlert('alert-1');
    useAlertStore.getState().unsnoozeAlert('alert-1');
    expect(useAlertStore.getState().snoozeMap['alert-1']).toBeUndefined();
  });

  it('should prune expired snoozed alerts', () => {
    useAlertStore.getState().snoozeAlert('alert-1', 1000);
    vi.advanceTimersByTime(2000);
    useAlertStore.getState().pruneSnooze();
    expect(useAlertStore.getState().snoozeMap['alert-1']).toBeUndefined();
  });

  it('should correctly evaluate isAlertSnoozed', () => {
    const snoozeMap = { 'alert-1': Date.now() + 1000, 'alert-2': Date.now() - 1000 };
    expect(isAlertSnoozed(snoozeMap, 'alert-1')).toBe(true);
    expect(isAlertSnoozed(snoozeMap, 'alert-2')).toBe(false);
    expect(isAlertSnoozed(snoozeMap, 'alert-3')).toBe(false);
  });
});
