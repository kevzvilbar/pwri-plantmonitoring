import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { detectHourlyGaps, type FlaggedGap } from '@/lib/hourlyGapDetection';
import { buildStatusTimeline, type TrainStatusRow } from '@/lib/trainStatusTimeline';

/**
 * Dashboard-facing counterpart to useReadingGaps.ts (wells/locators) and
 * useTrainAutoOffline.ts (the 2h hard auto-offline fallback) — same shape,
 * same refetch cadence, feeding the same TopBar alert bell via
 * useDashboardAlerts.ts.
 *
 * Deliberately a *different* signal from useTrainAutoOffline: that hook
 * fires once a train has been silent 2h+ and force-flips it to Offline —
 * a hard fallback. This one is the ~1.5h (30-min-grace) "please explain"
 * soft nudge from lib/hourlyGapDetection.ts, and never touches train
 * status. A genuinely silent train produces both alerts in sequence, not
 * one replacing the other — see the "Final spec" note in
 * ro-train-gap-correction-plan-v2.md.
 *
 * Only looks back LOOKBACK_HOURS: this hook is for "is there something
 * unresolved *right now*", not a historical audit — older unexplained gaps
 * just sit quietly in TrainLogModal's own badge until someone opens it,
 * same as how a 3-week-old well gap doesn't need to keep re-alerting once
 * it's obviously not this week's problem.
 */
export interface TrainHourlyGap {
  train_id: string;
  train_number: string | number;
  plant_id: string;
  source_table: 'ro_train_readings' | 'ro_pretreatment_readings';
  gap: FlaggedGap;
}

const LOOKBACK_HOURS = 48;

async function fetchTrainHourlyGaps(plantIds: string[]): Promise<TrainHourlyGap[]> {
  if (!plantIds.length) return [];

  const { data: trains, error: trainsErr } = await supabase
    .from('ro_trains')
    .select('id,train_number,plant_id')
    .in('plant_id', plantIds);
  if (trainsErr) throw trainsErr;
  if (!trains?.length) return [];

  const trainIds = trains.map((t) => t.id);
  const now = new Date();
  const rangeStart = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);

  const [roReadingsRes, preReadingsRes, statusRes, existingGapsRes] = await Promise.all([
    supabase.from('ro_train_readings').select('train_id,reading_datetime')
      .in('train_id', trainIds).gte('reading_datetime', rangeStart.toISOString()),
    supabase.from('ro_pretreatment_readings').select('train_id,reading_datetime')
      .in('train_id', trainIds).gte('reading_datetime', rangeStart.toISOString()),
    // Unbounded by date, same reasoning as TrainLogModal's own statusLogRows
    // query — a segment overlapping rangeStart needs to know the status
    // *before* it, and per-train row volume here is a handful of
    // transitions total.
    supabase.from('train_status_log').select('train_id,status,reason,confirmed_at').in('train_id', trainIds),
    supabase.from('ro_train_data_gaps' as any).select('train_id,source_table,gap_start_at').in('train_id', trainIds),
  ]);
  if (roReadingsRes.error) throw roReadingsRes.error;
  if (preReadingsRes.error) throw preReadingsRes.error;
  if (statusRes.error) throw statusRes.error;
  // ro_train_data_gaps may not exist yet in an environment that hasn't run
  // the migration — degrade to "nothing resolved yet" rather than throwing,
  // matching the tolerant pattern logStatusChange() already uses elsewhere
  // for not-yet-migrated tables.
  const existingGapKeys = new Set(
    existingGapsRes.error ? [] : (existingGapsRes.data ?? []).map((g: any) => `${g.train_id}|${g.source_table}|${g.gap_start_at}`),
  );

  const readingsByTrain = new Map<string, { ro: string[]; pre: string[] }>();
  const statusByTrain = new Map<string, TrainStatusRow[]>();
  for (const id of trainIds) { readingsByTrain.set(id, { ro: [], pre: [] }); statusByTrain.set(id, []); }
  (roReadingsRes.data ?? []).forEach((r: any) => readingsByTrain.get(r.train_id)?.ro.push(r.reading_datetime));
  (preReadingsRes.data ?? []).forEach((r: any) => readingsByTrain.get(r.train_id)?.pre.push(r.reading_datetime));
  (statusRes.data ?? []).forEach((r: any) => statusByTrain.get(r.train_id)?.push(r));

  const results: TrainHourlyGap[] = [];
  for (const train of trains) {
    const timeline = buildStatusTimeline(statusByTrain.get(train.id) ?? []);
    const readings = readingsByTrain.get(train.id) ?? { ro: [], pre: [] };
    const bySource: { table: TrainHourlyGap['source_table']; timestamps: string[] }[] = [
      { table: 'ro_train_readings', timestamps: readings.ro },
      { table: 'ro_pretreatment_readings', timestamps: readings.pre },
    ];
    for (const { table, timestamps } of bySource) {
      const gaps = detectHourlyGaps({
        readingTimestamps: timestamps, statusTimeline: timeline, rangeStart, rangeEnd: now, now,
      });
      for (const gap of gaps) {
        if (existingGapKeys.has(`${train.id}|${table}|${gap.gapStartAt}`)) continue; // already explained
        results.push({ train_id: train.id, train_number: train.train_number, plant_id: train.plant_id, source_table: table, gap });
      }
    }
  }
  return results;
}

export function useTrainHourlyGaps(plantIds: string[]) {
  const { data } = useQuery({
    queryKey: ['train-hourly-gaps', plantIds],
    queryFn: () => fetchTrainHourlyGaps(plantIds),
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,  // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s global default, so the app-wide background-sync sweep force-refetched this well before its own interval was due
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });
  return data ?? [];
}
