import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Auto-flag RO trains as Offline when no readings have been logged in >= 2 hours.
 * Checks both RO Train and Pre-Treatment logs for activity.
 * Returns the list of trains needing operator confirmation to remain Running.
 */
export const AUTO_OFFLINE_THRESHOLD_HOURS = 2;

/**
 * Train IDs with an auto-flag write currently in flight. Guards against the
 * double-mount of useTrainAutoOffline on the Dashboard (useDashboardAggregates
 * + useDashboardAlerts both call it) writing duplicate Offline status-log rows
 * for the same train in the same tick.
 */
const flagInFlight = new Set<string>();

export interface TrainGap {
  train_id: string;
  train_number: number;
  plant_id: string;
  last_reading_at: string | null;
  hours_gap: number;
  current_status: string;
}

export interface RawReadingRow {
  train_id: string;
  reading_datetime: string | null;
}

export interface RawTrainRow {
  id: string;
  train_number: number;
  plant_id: string;
  status: string;
}

export function shouldAutoFlagTrainOffline(hoursGap: number, currentStatus: string): boolean {
  return hoursGap >= AUTO_OFFLINE_THRESHOLD_HOURS && currentStatus === 'Running';
}

/**
 * Reduces reading rows (from ro_train_readings and/or ro_pretreatment_readings)
 * down to each train's single most recent reading_datetime. Order-independent —
 * safe to feed both tables' rows in without pre-sorting.
 */
export function latestReadingByTrain(rows: RawReadingRow[]): Map<string, string> {
  const lastBy = new Map<string, string>();
  for (const r of rows) {
    if (!r.reading_datetime) continue;
    const curr = lastBy.get(r.train_id);
    if (!curr || new Date(r.reading_datetime).getTime() > new Date(curr).getTime()) {
      lastBy.set(r.train_id, r.reading_datetime);
    }
  }
  return lastBy;
}

export function computeTrainGaps(
  trains: RawTrainRow[],
  lastBy: Map<string, string>,
  nowMs: number,
): TrainGap[] {
  return trains.map((t) => {
    const last = lastBy.get(t.id) ?? null;
    const hours = last ? (nowMs - new Date(last).getTime()) / 1000 / 60 / 60 : Infinity;
    return {
      train_id: t.id, train_number: t.train_number, plant_id: t.plant_id,
      last_reading_at: last, hours_gap: hours, current_status: t.status,
    };
  });
}

/**
 * A candidate only ever lands on hours_gap === Infinity when the windowed
 * "recent readings" fetch in the queryFn below (bounded by a `since` cutoff
 * computed from the requesting device's own clock) found NO row at all for
 * that train. That's supposed to mean "no reading in the last ~24h" — but if
 * the requesting device's clock is wrong (drifted, unsynced, wrong timezone —
 * genuinely possible for a plant-floor operator terminal), the computed
 * `since` cutoff can itself land after the real "now", silently excluding a
 * train's genuinely-recent reading from the fetch and reporting Infinity for
 * a train that was never actually stale. That's precisely how a train got
 * auto-flagged Offline with an ">24h" reason moments after a real reading had
 * just been logged for it.
 *
 * Any other finite hours_gap came from a reading the windowed fetch DID find,
 * so it isn't at risk of this specific failure mode.
 */
export function needsUnboundedConfirmation(gap: TrainGap): boolean {
  return gap.hours_gap === Infinity;
}

/**
 * Given a candidate that hit hours_gap===Infinity, and the result of a
 * follow-up *unbounded* (no since-filter) lookup for that train's true latest
 * reading, decide whether the candidate should actually be flagged Offline.
 *
 * Returns null when the unbounded check finds a reading recent enough that
 * the train should NOT be flagged — i.e. the windowed fetch's `since` cutoff
 * was the problem, not a real gap. Returns the (possibly corrected) candidate
 * otherwise.
 */
export function reconcileOfflineCandidate(
  candidate: TrainGap,
  confirmedLastReadingAt: string | null,
  nowMs: number,
): TrainGap | null {
  if (!needsUnboundedConfirmation(candidate)) return candidate;
  const hours = confirmedLastReadingAt
    ? (nowMs - new Date(confirmedLastReadingAt).getTime()) / 1000 / 60 / 60
    : Infinity;
  if (!shouldAutoFlagTrainOffline(hours, candidate.current_status)) return null;
  return { ...candidate, last_reading_at: confirmedLastReadingAt, hours_gap: hours };
}

/** Single most recent reading for one train, with no time-window filter to get wrong. */
async function fetchLatestReadingUnbounded(trainId: string): Promise<string | null> {
  const [roRes, preRes] = await Promise.all([
    supabase
      .from('ro_train_readings')
      .select('reading_datetime')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: false })
      .limit(1),
    supabase
      .from('ro_pretreatment_readings')
      .select('reading_datetime')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: false })
      .limit(1),
  ]);
  if (roRes.error) throw roRes.error;
  if (preRes.error) throw preRes.error;

  const candidates = [roRes.data?.[0]?.reading_datetime, preRes.data?.[0]?.reading_datetime]
    .filter((v): v is string => !!v);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (new Date(a).getTime() > new Date(b).getTime() ? a : b));
}

export function useTrainAutoOffline(plantIds: string[]) {
  const qc = useQueryClient();
  const { data: gaps } = useQuery({
    queryKey: ['train-gaps', plantIds],
    queryFn: async (): Promise<TrainGap[]> => {
      if (!plantIds.length) return [];
      const { data: trains, error: trainsErr } = await supabase
        .from('ro_trains')
        .select('id,train_number,plant_id,status')
        .in('plant_id', plantIds);
      if (trainsErr) throw trainsErr;
      if (!trains?.length) return [];

      const trainIds = trains.map((t) => t.id);

      // ── Preferred path: server-time RPC ──────────────────────────────────
      // The RPC returns each train's latest reading (across both reading
      // tables, unbounded) AND the database's now() in one round trip, so the
      // staleness decision never involves this device's clock. A drifted /
      // ahead-of-time plant terminal previously produced both the ">24h
      // moments after a real reading" false flag (windowed `since` cutoff
      // landed after real now) and finite-gap false flags (~1h clock skew
      // turning a 1h-old reading into a 2h+ gap).
      try {
        const { data: rpcRows, error: rpcErr } = await (supabase as any)
          .rpc('get_train_last_readings', { train_ids: trainIds });
        if (!rpcErr && rpcRows) {
          const lastBy = new Map<string, string>();
          let serverNowMs = Date.now();
          for (const row of rpcRows as Array<{ train_id: string; last_reading_at: string | null; server_now: string }>) {
            if (row.last_reading_at) lastBy.set(row.train_id, row.last_reading_at);
            if (row.server_now) serverNowMs = new Date(row.server_now).getTime();
          }
          return computeTrainGaps(trains as RawTrainRow[], lastBy, serverNowMs)
            .filter((g) => shouldAutoFlagTrainOffline(g.hours_gap, g.current_status));
          // No unbounded-confirmation pass needed here: lastBy came from an
          // unbounded, clock-independent lookup already.
        }
        if (rpcErr) throw rpcErr;
      } catch {
        // RPC not deployed yet (migration pending) — fall through to the
        // legacy client-side path below so the flagger keeps working.
      }

      // ── Legacy fallback (pre-RPC behavior, kept for migration lag) ───────
      const since = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

      const [roRecentRes, preRecentRes] = await Promise.all([
        supabase
          .from('ro_train_readings')
          .select('train_id,reading_datetime')
          .in('train_id', trainIds)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: false }),
        supabase
          .from('ro_pretreatment_readings')
          .select('train_id,reading_datetime')
          .in('train_id', trainIds)
          .gte('reading_datetime', since)
          .order('reading_datetime', { ascending: false }),
      ]);
      if (roRecentRes.error) throw roRecentRes.error;
      if (preRecentRes.error) throw preRecentRes.error;

      const lastBy = latestReadingByTrain([
        ...(roRecentRes.data ?? []),
        ...(preRecentRes.data ?? []),
      ]);

      const now = Date.now();
      const candidates = computeTrainGaps(trains as RawTrainRow[], lastBy, now)
        .filter((g) => shouldAutoFlagTrainOffline(g.hours_gap, g.current_status));

      // Every candidate above came from the `since`-windowed fetch, which
      // trusts this device's own clock to build its cutoff. Before writing
      // Offline for anyone who only qualified via hours_gap===Infinity
      // ("no reading found at all"), double-check with an unbounded,
      // clock-independent lookup — see needsUnboundedConfirmation's doc
      // comment for why that specific case needs re-verifying and others
      // don't. This only ever runs for the handful of trains about to be
      // flagged, not for every train on every poll.
      const confirmed: TrainGap[] = [];
      for (const g of candidates) {
        if (!needsUnboundedConfirmation(g)) {
          confirmed.push(g);
          continue;
        }
        try {
          const trueLast = await fetchLatestReadingUnbounded(g.train_id);
          const reconciled = reconcileOfflineCandidate(g, trueLast, now);
          if (reconciled) confirmed.push(reconciled);
        } catch (e) {
          // Can't confirm either way this cycle — fail safe by leaving the
          // train un-flagged rather than acting on an unverified signal.
          console.warn('[useTrainAutoOffline] Could not confirm offline candidate, skipping this cycle', g.train_id, e);
        }
      }
      return confirmed;
    },
    enabled: plantIds.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Auto-mark stale trains Offline (operator must confirm to bring back Running)
  useEffect(() => {
    if (!gaps?.length) return;
    (async () => {
      let flaggedAny = false;
      for (const g of gaps) {
        // ── Single-writer guard ────────────────────────────────────────────
        // useTrainAutoOffline is mounted twice on the Dashboard (via
        // useDashboardAggregates AND useDashboardAlerts), so both instances
        // can receive the same gaps array and both run this effect. Without
        // this guard each bogus write went in twice. Skip if a write for
        // this train is already in flight on this page instance...
        if (flagInFlight.has(g.train_id)) continue;
        flagInFlight.add(g.train_id);
        try {
          // ...and re-check the train is STILL Running right before writing:
          // the other mount (or the 5-min refetch on a sibling tab) may have
          // already flipped it, and status-log rows shouldn't be duplicated.
          const { data: cur, error: curErr } = await supabase
            .from('ro_trains')
            .select('status')
            .eq('id', g.train_id)
            .maybeSingle();
          if (curErr || (cur as any)?.status !== 'Running') continue;

          const { error } = await supabase.from('ro_trains').update({ status: 'Offline' }).eq('id', g.train_id);
          if (error) {
            console.warn('[useTrainAutoOffline] Failed to auto-flag train offline', g.train_id, error);
            continue;
          }
          await supabase.from('train_status_log').insert({
            train_id: g.train_id,
            plant_id: g.plant_id,
            status: 'Offline',
            reason: `Auto-flagged: no reading for ${g.hours_gap === Infinity ? '>24' : g.hours_gap.toFixed(1)}h`,
            confirmed_at: g.last_reading_at ? new Date(g.last_reading_at).toISOString() : new Date().toISOString(),
          });
          flaggedAny = true;
        } finally {
          flagInFlight.delete(g.train_id);
        }
      }
      if (flaggedAny) {
        qc.invalidateQueries({ queryKey: ['trains'] });
        qc.invalidateQueries({ queryKey: ['ro-trains'] });
        qc.invalidateQueries({ queryKey: ['train-latest-status-log'] });
        qc.invalidateQueries({ queryKey: ['train-status-log'] });
        qc.invalidateQueries({ queryKey: ['train-hourly-gaps'] });
      }
    })();
  }, [gaps, qc]);

  return gaps ?? [];
}
