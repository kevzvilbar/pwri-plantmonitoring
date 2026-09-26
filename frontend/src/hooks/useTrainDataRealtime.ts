/**
 * hooks/useTrainDataRealtime.ts
 *
 * Instant telemetry and alert freshness via Supabase Realtime (postgres_changes
 * events), replacing per-query short polling intervals for reading and alert
 * tables (EGRESS-REDUCTION-PLAN.md).
 *
 * Mount ONCE, app-wide — AppShell mounts this with the isolated null-rendering
 * component pattern, so channel-state changes never re-render the shell tree.
 *
 * Strategy: INVALIDATION, not payload-push — on any database change event we
 * invalidate the relevant react-query cache prefixes and let the active queries
 * refetch on their own schedule. This maintains RLS security boundaries and
 * eliminates polling storms across concurrent users.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantStore } from '@/store/plantStore';

/** The tables this hook subscribes to via Supabase Realtime. */
export const APP_REALTIME_TABLES = [
  'ro_train_readings',
  'ro_pretreatment_readings',
  'train_status_log',
  'well_readings',
  'locator_readings',
  'power_readings',
  'product_meter_readings',
  'alert_events',
  'blending_events',
  'downtime_events',
  'pump_readings',
] as const;

/** Alias for backward-compatibility with earlier imports. */
export const TRAIN_REALTIME_TABLES = APP_REALTIME_TABLES;

export const TABLE_INVALIDATION_KEYS: Record<string, string[]> = {
  ro_train_readings: [
    'trains',
    'ro-trains',
    'ro-trains-count',
    'plants-summary-counts',
    'train-status-log',
    'train-latest-status-log',
    'train-hourly-gaps',
    'train-gaps',
    'train-log-overview',
    'ro-train-data-gaps',
    'ro-overview',
    'ro-last-all',
    'ro-spark',
    'ro-prev',
    'dash-server-aggregates',
    'dash-ro-recent',
    'dash-ro-permeate-today',
    'dash-ro-permeate-yest',
    'dash-summary-recent',
    'alerts-feed',
    'trend-ro',
    'trend-ro-train-ids',
    'dsm-ro-readings',
    'dsm-ro-trains',
    'plant-freshness',
    'coverage-trains-done',
    'wb-ro-readings',
  ],
  ro_pretreatment_readings: [
    'train-log-overview',
    'ro-train-data-gaps',
    'ro-overview',
    'train-hourly-gaps',
    'dash-pretreatment-recent',
    'alerts-feed',
  ],
  train_status_log: [
    'trains',
    'ro-trains',
    'ro-trains-count',
    'plants-summary-counts',
    'train-status-log',
    'train-latest-status-log',
    'train-gaps',
    'alerts-feed',
  ],
  well_readings: [
    'dash-server-aggregates',
    'dash-wells-today',
    'dash-wells-yest',
    'trend-wells',
    'trend-well',
    'well-readings',
    'op-wells',
    'op-well-recent',
    'op-well-latest',
    'op-well-latest-fresh',
    'wells-summary-counts',
    'well-gaps',
    'well-reading-gaps',
    'well-gap-reasons',
    'reading-coverage',
    'water-balance-totals',
    'plant-freshness',
    'coverage-wells-done',
    'dashboard-pending-counts',
    'wb-well-readings',
    'alerts-feed',
  ],
  locator_readings: [
    'dash-server-aggregates',
    'dash-loc-today',
    'dash-loc-yest',
    'trend-locator',
    'trend-locators',
    'op-loc-recent',
    'op-loc-latest',
    'locator-readings',
    'locator-gaps',
    'locator-reading-gaps',
    'locator-gap-reasons',
    'derived-review-flag',
    'reading-coverage',
    'water-balance-totals',
    'plant-freshness',
    'coverage-locators-done',
    'dashboard-pending-counts',
    'wb-loc-readings',
    'alerts-feed',
  ],
  power_readings: [
    'dash-power-today',
    'dash-power-yest',
    'dash-power-history',
    'trend-power',
    'power-readings',
    'power-summary',
    'op-power-recent',
    'op-power-history-14d',
    'alerts-feed',
  ],
  product_meter_readings: [
    'dash-server-aggregates',
    'dash-product-meters-today',
    'dash-product-meters-yest',
    'trend-product',
    'plant-freshness',
    'op-product-recent',
    'product-readings-latest-v2',
    'product-readings-10day',
    'product-meter-last-readings',
    'product-meter-latest-readings-stat',
    'product-gap-reasons',
    'dashboard-pending-counts',
    'wb-product-readings',
  ],
  alert_events: [
    'alert-events',
    'alerts-feed',
    'alerts-statuses',
  ],
  blending_events: [
    'dash-server-aggregates',
    'dash-blending-today',
    'alerts-feed',
    'blending-events',
    'wb-blending-events',
  ],
  downtime_events: [
    'downtime-events',
    'alerts-feed',
  ],
  pump_readings: [
    'dash-pump-readings-recent',
    'alerts-feed',
  ],
};

/**
 * Returns all query keys invalidated across all realtime tables.
 * Pure and exported for unit testing.
 */
export function trainRealtimeInvalidationKeys(): string[] {
  const allKeys = new Set<string>();
  Object.values(TABLE_INVALIDATION_KEYS).forEach((keys) => {
    keys.forEach((k) => allKeys.add(k));
  });
  return Array.from(allKeys);
}

const DEBOUNCE_MS = 2000;

export function useTrainDataRealtime(plantIdOverride?: string | null) {
  const qc = useQueryClient();
  const selectedPlantId = usePlantStore((s) => s.selectedPlantId);
  const activePlantId = plantIdOverride !== undefined ? plantIdOverride : selectedPlantId;
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flushInvalidations = () => {
      const keysToInvalidate = Array.from(pendingKeysRef.current);
      pendingKeysRef.current.clear();
      for (const key of keysToInvalidate) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    };

    const channels = APP_REALTIME_TABLES.map((table) => {
      // Fresh uid per effect run for StrictMode double-mount compatibility
      const uid = Math.random().toString(36).slice(2, 9);
      const keys = TABLE_INVALIDATION_KEYS[table] ?? [];
      const channelName = activePlantId
        ? `rt-${table}-${activePlantId}-${uid}`
        : `rt-${table}-${uid}`;

      const changeConfig = activePlantId
        ? ({ event: '*', schema: 'public', table, filter: `plant_id=eq.${activePlantId}` } as const)
        : ({ event: '*', schema: 'public', table } as const);

      return supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          changeConfig as any,
          () => {
            for (const key of keys) {
              pendingKeysRef.current.add(key);
            }
            if (debounceTimerRef.current !== null) {
              clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(flushInvalidations, DEBOUNCE_MS);
          },
        )
        .subscribe();
    });

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [qc, activePlantId]);
}
