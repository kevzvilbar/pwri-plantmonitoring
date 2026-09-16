/**
 * hooks/useTrainDataRealtime.ts
 *
 * Instant train-data freshness via Supabase Realtime (postgres_changes
 * INSERTs), replacing the per-query 5-minute refetchIntervals for everything
 * derived from ro_train_readings / ro_pretreatment_readings /
 * train_status_log (RO_TRAIN_ALERT_SYSTEM_RECONCILIATION.md §3 item 1).
 *
 * Mount ONCE, app-wide — AppShell does this beside BackgroundSyncMount with
 * the same "isolated null-rendering component" trick, so channel-state
 * changes never re-render the shell tree.
 *
 * Strategy: INVALIDATION, not payload-push — on any INSERT we invalidate the
 * train-related react-query cache prefixes and let the active queries refetch
 * on their own schedule. This is the pattern TrendChart.tsx already uses for
 * power/chemical realtime, keeps RLS as the only access gate (postgres_changes
 * delivers only rows the subscriber's policies expose — all three tables carry
 * user_has_plant_access policies), and means one code path serves every
 * consumer from train cards to the alert bell.
 *
 * What this deliberately does NOT replace:
 *   - useTrainAutoOffline's 5-min gaps poll. The flagger detects the ABSENCE
 *     of readings — a silent train produces no INSERT events, so no realtime
 *     event can ever fire its check. One lightweight RPC per 5 minutes stays.
 *   - Dashboard polls that mix entities (wells, power, product meters) this
 *     subscription doesn't cover; they keep their own tuned intervals.
 *   - useBackgroundSync's visibility sweep — it stays as the safety net for
 *     environments where the realtime publication migration hasn't run yet
 *     (subscriptions then simply never fire, and the sweep degrades to
 *     today's behavior).
 *
 * StrictMode double-mount: same workaround as TrendChart.tsx — every effect
 * run builds channels with a fresh uid suffix, because calling .on(...) on an
 * already-subscribed channel throws "cannot add callbacks after subscribe()".
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** The tables this hook subscribes to. */
export const TRAIN_REALTIME_TABLES = [
  'ro_train_readings',
  'ro_pretreatment_readings',
  'train_status_log',
] as const;

/**
 * Query-key prefixes invalidated when any of TRAIN_REALTIME_TABLES receives an
 * INSERT. This is the union of the exact key lists the writers already
 * invalidate by hand after a successful train write (useTrainAutoOffline,
 * usePretreatmentActions, useTrainUptimeExemption, TrainsList's status
 * toggle) — pulled out here so realtime and the writers agree on what counts
 * as "train data changed" from one place.
 *
 * Pure and exported for unit testing.
 */
export function trainRealtimeInvalidationKeys(): string[] {
  return [
    // Train entities + live status (TrainsList toggle, auto-flagger)
    'trains',
    'ro-trains',
    'ro-trains-count',
    'plants-summary-counts',
    // Status log consumers
    'train-status-log',
    'train-latest-status-log',
    'train-hourly-gaps',
    'train-gaps',
    // Operator log page (TrainLogModal + pretreatment form)
    'train-log-overview',
    'ro-train-data-gaps',
    'ro-overview',
    'ro-last-all',
    'ro-spark',
    'ro-prev',
    // Dashboard aggregates fed by the three tables
    'dash-ro-recent',
    'dash-ro-permeate-today',
    'dash-ro-permeate-yest',
    'dash-product-meters-today',
    'dash-product-meters-yest',
    'dash-power-today',
    'dash-power-yest',
    'dash-costs-today',
    'dash-costs-yesterday',
    'dash-summary-recent',
    'alerts-feed',
    // Trend charts + Data Summary drilldowns
    'trend-ro',
    'trend-ro-train-ids',
    'trend-product',
    'trend-power',
    'trend-cost',
    'dsm-ro-readings',
    'dsm-ro-trains',
  ];
}

export function useTrainDataRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const keys = trainRealtimeInvalidationKeys();
    const channels = TRAIN_REALTIME_TABLES.map((table) => {
      // Fresh uid per effect run — see the StrictMode note in the header.
      const uid = Math.random().toString(36).slice(2, 9);
      return supabase
        .channel(`train-rt-${table}-${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table },
          () => {
            for (const key of keys) {
              qc.invalidateQueries({ queryKey: [key] });
            }
          },
        )
        .subscribe();
    });

    return () => {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [qc]);
}
