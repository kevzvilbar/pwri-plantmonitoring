import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAlertStore, type PlantAlert, type PlantAlertSeverity } from '@/store/alertStore';
import { selectAttentionAlerts, selectOpenAlerts, useAlertBadge } from '@/hooks/useAlertBadge';

const alert = (id: string, severity: PlantAlertSeverity, extra: Partial<PlantAlert> = {}): PlantAlert => ({
  id, severity, title: id, description: '', source: 'test', plantId: 'p1', timestamp: 0, ...extra,
});

describe('selectAttentionAlerts', () => {
  it('counts critical and warning, not info', () => {
    const list = [alert('c', 'critical'), alert('w', 'warning'), alert('i', 'info')];
    expect(selectAttentionAlerts(list, {}).map((a) => a.id)).toEqual(['c', 'w']);
  });

  it('excludes acknowledged alerts', () => {
    const list = [alert('a', 'critical', { acknowledgedAt: 1, acknowledgedBy: 'u1' }), alert('b', 'warning')];
    expect(selectAttentionAlerts(list, {}).map((a) => a.id)).toEqual(['b']);
  });

  it('excludes resolved alerts', () => {
    const list = [alert('a', 'critical', { resolvedAt: 1, resolvedBy: 'u1' }), alert('b', 'critical')];
    expect(selectAttentionAlerts(list, {}).map((a) => a.id)).toEqual(['b']);
  });

  it('excludes alerts snoozed into the future, but not expired snoozes', () => {
    const now = Date.now();
    const list = [alert('live-snooze', 'critical'), alert('expired-snooze', 'critical')];
    const snoozeMap = { 'live-snooze': now + 60_000, 'expired-snooze': now - 1 };
    expect(selectAttentionAlerts(list, snoozeMap).map((a) => a.id)).toEqual(['expired-snooze']);
  });

  it('excludes an alert the audit trail says another user acknowledged (P3-3)', () => {
    // A second user acknowledged 'a' — this browser has no local fields for it,
    // only what AlertsRuntime pulled from alert_events.
    const list = [alert('a', 'critical'), alert('b', 'critical')];
    expect(selectAttentionAlerts(list, {}, { a: 'acknowledged' }).map((x) => x.id)).toEqual(['b']);
  });

  it('excludes an alert the audit trail says was resolved (P3-3)', () => {
    const list = [alert('a', 'critical'), alert('b', 'warning')];
    expect(selectAttentionAlerts(list, {}, { a: 'resolved' }).map((x) => x.id)).toEqual(['b']);
  });

  it('brings an alert back into the count when a reopen event lands', () => {
    // Someone acknowledged it, then reopened it — derived status is 'active'.
    const list = [alert('a', 'critical')];
    expect(selectAttentionAlerts(list, {}, { a: 'active' }).map((x) => x.id)).toEqual(['a']);
  });
});

describe('selectOpenAlerts', () => {
  it('includes info severity (unlike selectAttentionAlerts)', () => {
    const list = [alert('c', 'critical'), alert('i', 'info')];
    expect(selectOpenAlerts(list, {}).map((a) => a.id)).toEqual(['c', 'i']);
  });

  it('keeps an acknowledged alert visible — it must not disappear the moment it is touched', () => {
    const list = [alert('a', 'critical', { acknowledgedAt: 1, acknowledgedBy: 'u1' }), alert('b', 'warning')];
    expect(selectOpenAlerts(list, {}).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('keeps a live-snoozed alert visible', () => {
    const now = Date.now();
    const list = [alert('a', 'critical')];
    expect(selectOpenAlerts(list, { a: now + 60_000 }).map((x) => x.id)).toEqual(['a']);
  });

  it('drops an alert only once it is resolved', () => {
    const list = [alert('a', 'critical', { resolvedAt: 1, resolvedBy: 'u1' }), alert('b', 'critical')];
    expect(selectOpenAlerts(list, {}).map((a) => a.id)).toEqual(['b']);
  });

  it('drops an alert the audit trail says was resolved (P3-3)', () => {
    const list = [alert('a', 'critical'), alert('b', 'warning')];
    expect(selectOpenAlerts(list, {}, { a: 'resolved' }).map((x) => x.id)).toEqual(['b']);
  });
});

describe('useAlertBadge', () => {
  beforeEach(() => {
    useAlertStore.setState({ plantAlerts: [], snoozeMap: {}, serverStatusByKey: {} });
  });

  it('is empty when there are no alerts', () => {
    const { result } = renderHook(() => useAlertBadge());
    expect(result.current).toEqual({ count: 0, hasCritical: false });
  });

  it('reports the count and whether any is critical, and follows the store live', () => {
    const { result } = renderHook(() => useAlertBadge());

    act(() => useAlertStore.getState().addAlerts([alert('w1', 'warning'), alert('i1', 'info')]));
    expect(result.current).toEqual({ count: 1, hasCritical: false });

    act(() => useAlertStore.getState().addAlerts([alert('c1', 'critical')]));
    expect(result.current).toEqual({ count: 2, hasCritical: true });
  });

  it('drops an alert from the count once it is acknowledged', () => {
    const { result } = renderHook(() => useAlertBadge());
    act(() => useAlertStore.getState().addAlerts([alert('c1', 'critical'), alert('w1', 'warning')]));
    expect(result.current.count).toBe(2);

    act(() => useAlertStore.getState().acknowledgeAlert('c1', 'user-1'));
    expect(result.current).toEqual({ count: 1, hasCritical: false });
  });

  it('drops an alert once the audit trail reports it handled (P3-9)', () => {
    const { result } = renderHook(() => useAlertBadge());
    act(() => useAlertStore.getState().addAlerts([alert('c1', 'critical'), alert('w1', 'warning')]));
    expect(result.current.count).toBe(2);

    // AlertsRuntime applied what another user did 30 seconds ago.
    act(() => useAlertStore.getState().setServerStatuses({ c1: 'acknowledged' }));
    expect(result.current).toEqual({ count: 1, hasCritical: false });

    act(() => useAlertStore.getState().setServerStatuses({ c1: 'resolved', w1: 'resolved' }));
    expect(result.current).toEqual({ count: 0, hasCritical: false });
  });
});
