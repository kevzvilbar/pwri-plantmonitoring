import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAlertStore, type PlantAlert, type PlantAlertSeverity } from '@/store/alertStore';
import { selectAttentionAlerts, selectActiveAlerts, useAlertBadge } from '@/hooks/useAlertBadge';

// Mock dependencies for useTopBarState and useAlerts if needed
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [] }),
          }),
        }),
      }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, roles: ['Admin'] }),
}));

vi.mock('@/hooks/usePlants', () => ({
  usePlants: () => ({ data: [{ id: 'p1', name: 'Plant 1' }, { id: 'p2', name: 'Plant 2' }] }),
}));

vi.mock('@/hooks/useVisiblePlants', () => ({
  useVisiblePlants: () => ({
    plants: [{ id: 'p1', name: 'Plant 1' }, { id: 'p2', name: 'Plant 2' }],
    needsAssignment: false,
  }),
}));

vi.mock('@/hooks/usePlantSelectionGuard', () => ({
  usePlantSelectionGuard: () => {},
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ isMobile: false, state: 'expanded' }),
}));

vi.mock('./useAuditedAlertActions', () => ({
  useAuditedAlertActions: () => ({
    ackAlert: vi.fn(),
    ackAll: vi.fn(),
    resolveWithNote: vi.fn(),
    snoozeMany: vi.fn(),
    snoozableIds: [],
  }),
}));

const makeAlert = (id: string, severity: PlantAlertSeverity, plantId = 'p1', extra: Partial<PlantAlert> = {}): PlantAlert => ({
  id,
  severity,
  title: `Alert ${id}`,
  description: '',
  source: 'test',
  plantId,
  timestamp: Date.now(),
  ...extra,
});

describe('Badge Parity: Sidebar vs Bell vs Alerts KPI', () => {
  beforeEach(() => {
    useAlertStore.setState({
      plantAlerts: [],
      snoozeMap: {},
      serverStatusByKey: {},
    });
  });

  it('maintains strict count parity across 38 active attention alerts scenario', () => {
    // Generate 38 attention alerts (critical + warning) across plants
    const alerts: PlantAlert[] = [];
    for (let i = 1; i <= 20; i++) {
      alerts.push(makeAlert(`crit-${i}`, 'critical', i % 2 === 0 ? 'p1' : 'p2'));
    }
    for (let i = 1; i <= 18; i++) {
      alerts.push(makeAlert(`warn-${i}`, 'warning', i % 2 === 0 ? 'p1' : 'p2'));
    }
    // Add 4 info alerts (should not count towards attention/badge)
    for (let i = 1; i <= 4; i++) {
      alerts.push(makeAlert(`info-${i}`, 'info', 'p1'));
    }

    useAlertStore.getState().addAlerts(alerts);

    const store = useAlertStore.getState();
    const attentionAlerts = selectAttentionAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey);
    const activeAlerts = selectActiveAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey);

    // Sidebar badge count
    const { result: sidebarResult } = renderHook(() => useAlertBadge());

    expect(attentionAlerts.length).toBe(38);
    expect(sidebarResult.current.count).toBe(38);
    expect(sidebarResult.current.hasCritical).toBe(true);

    // Active alerts include info (38 + 4 = 42)
    expect(activeAlerts.length).toBe(42);

    // Critical and Warning active counts
    const criticalActive = activeAlerts.filter((a) => a.severity === 'critical').length;
    const warningActive = activeAlerts.filter((a) => a.severity === 'warning').length;
    const infoActive = activeAlerts.filter((a) => a.severity === 'info').length;

    expect(criticalActive).toBe(20);
    expect(warningActive).toBe(18);
    expect(infoActive).toBe(4);
  });

  it('excludes acknowledged, resolved, and snoozed alerts from attention badges', () => {
    const alerts = [
      makeAlert('c1', 'critical'),
      makeAlert('c2', 'critical'),
      makeAlert('w1', 'warning'),
      makeAlert('w2', 'warning'),
      makeAlert('i1', 'info'),
    ];
    useAlertStore.getState().addAlerts(alerts);

    // Initial attention count = 4 (c1, c2, w1, w2)
    expect(selectAttentionAlerts(useAlertStore.getState().plantAlerts, {}, {}).length).toBe(4);

    // Acknowledge c1
    act(() => {
      useAlertStore.getState().acknowledgeAlert('c1', 'user-1');
    });

    let store = useAlertStore.getState();
    expect(selectAttentionAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey).length).toBe(3);

    // Resolve w1
    act(() => {
      useAlertStore.getState().resolveAlert('w1', 'user-1');
    });

    store = useAlertStore.getState();
    expect(selectAttentionAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey).length).toBe(2);

    // Snooze c2
    act(() => {
      useAlertStore.getState().snoozeAlert('c2', 60_000);
    });

    store = useAlertStore.getState();
    // Only w2 left active
    expect(selectAttentionAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey).length).toBe(1);
    expect(selectAttentionAlerts(store.plantAlerts, store.snoozeMap, store.serverStatusByKey)[0].id).toBe('w2');

    // Sidebar badge reflects the exact same 1 alert
    const { result } = renderHook(() => useAlertBadge());
    expect(result.current.count).toBe(1);
    expect(result.current.hasCritical).toBe(false);
  });
});
