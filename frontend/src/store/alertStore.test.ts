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
      serverStatusByKey: {},
      alertsReady: false,
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
    expect(state.serverStatusByKey).toEqual({});
    expect(state.alertsReady).toBe(false);
  });

  it('flips alertsReady on the first computation (P2-7)', () => {
    expect(useAlertStore.getState().alertsReady).toBe(false);
    useAlertStore.getState().addAlerts([]);
    expect(useAlertStore.getState().alertsReady).toBe(true);
  });

  it('should not re-add an alert the audit trail has acknowledged (P3-2)', () => {
    // A second user acknowledged this alert 30s ago. The recompute still sees
    // the live condition, but the event must win.
    useAlertStore.getState().setServerStatuses({ 'alert-1': 'acknowledged' });
    useAlertStore.getState().addAlerts([mockAlert]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(0);
  });

  it('should not re-add an alert the audit trail has resolved (P3-5, D2)', () => {
    useAlertStore.getState().setServerStatuses({ 'alert-1': 'resolved' });
    useAlertStore.getState().addAlerts([mockAlert]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(0);
  });

  it('drops a locally acknowledged alert instead of resurrecting it (P3-4)', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().acknowledgeAlert('alert-1', 'u1');
    expect(useAlertStore.getState().plantAlerts).toHaveLength(1);

    // Next recompute pushes a fresh copy of the same id…
    useAlertStore.getState().addAlerts([
      { ...mockAlert, timestamp: Date.now() + 1000, title: 'Still breaching' },
    ]);
    const kept = useAlertStore.getState().plantAlerts;
    expect(kept).toHaveLength(1);
    // …and the acknowledgement survives it.
    expect(kept[0].acknowledgedBy).toBe('u1');
    // The recompute must not refresh the timestamp of a handled alert, or the
    // list would sort it back to the top as if it had just fired again.
    expect(kept[0].timestamp).toBe(mockAlert.timestamp);
  });

  it('keeps a merged copy unacknowledged when nothing had acted (P3-4)', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().addAlerts([{ ...mockAlert, timestamp: Date.now() + 1000 }]);
    // No status was set, so the refreshed timestamp is the point of the merge.
    expect(useAlertStore.getState().plantAlerts[0].timestamp).toBe(Date.now() + 1000);
    expect(useAlertStore.getState().plantAlerts[0].acknowledgedBy).toBeUndefined();
  });

  it('removeAlerts is gone; clearConditionAlerts removes without snoozing (P3-6)', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    const store = useAlertStore.getState() as unknown as { removeAlerts?: unknown };
    expect(store.removeAlerts).toBeUndefined();

    useAlertStore.getState().clearConditionAlerts(['alert-1']);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(0);
    // No snooze side effect — the condition really did clear.
    expect(useAlertStore.getState().snoozeMap['alert-1']).toBeUndefined();
  });

  it('clearConditionAlerts clears serverStatusByKey so re-fired alerts are not blocked', () => {
    useAlertStore.getState().setServerStatuses({ 'alert-1': 'resolved' });
    useAlertStore.getState().clearConditionAlerts(['alert-1']);
    expect(useAlertStore.getState().serverStatusByKey['alert-1']).toBeUndefined();
    useAlertStore.getState().addAlerts([mockAlert]);
    expect(useAlertStore.getState().plantAlerts).toHaveLength(1);
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

  it('getAlertStatus prefers the audit trail, but a live local snooze wins first (P3-3)', () => {
    useAlertStore.getState().addAlerts([mockAlert]);
    useAlertStore.getState().acknowledgeAlert('alert-1', 'u1');
    useAlertStore.getState().setServerStatuses({ 'alert-1': 'active' });

    // The reopened event sends it back to active despite the local ack.
    expect(useAlertStore.getState().getAlertStatus(mockAlert)).toBe('active');

    // A live local snooze beats the audit trail.
    useAlertStore.getState().snoozeAlert('alert-1', 60_000);
    expect(useAlertStore.getState().getAlertStatus(mockAlert)).toBe('snoozed');
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
