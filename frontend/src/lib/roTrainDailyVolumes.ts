// ─── Shared RO train daily volumes helper ────────────────────────────────────
// Provides the single source of truth for per-train, per-day permeate/feed/
// reject volume aggregation and the recovery % formula that every Recovery %
// figure in the app now shares (Trendline, Water Balance, Data Summary popup).
//
// Mirrors the plant-level PRIMARY/FALLBACK inference chains so that a train
// day with only permeate + reject (no feed meter) still gets a feed estimate
// via feed = permeate + reject, and a day with only permeate (no feed, no
// reject) falls back to feed = permeate (reject = 0).
import { format } from 'date-fns';
import type { ROReading } from '@/integrations/supabase/types';

/** Per-train, per-day volume totals (m³). */
export interface DailyVolumes {
  permeate: number;
  feed: number;
  reject: number;
}

/**
 * Aggregate RO readings into per-train, per-day permeate/feed/reject volumes.
 *
 * Inference chain (mirrors plant-level logic in useTrendChartData.ts):
 *   PRIMARY   — sum each meter's daily delta directly from readings that carry
 *                the meter value (permeate_today_m3, feed_today_m3,
 *                reject_today_m3).
 *   FALLBACK  — if a meter is missing but the other two are present, infer it:
 *                • feed  = permeate + reject   (when feed missing, perm+rej known)
 *                • reject = feed - permeate     (when reject missing, perm+feed known)
 *                • permeate = feed - reject     (when permeate missing, feed+rej known)
 *   LAST RESORT — if only one of the three is present, treat the missing two as 0
 *                 (e.g. permeate-only day → feed = permeate, reject = 0).
 */
export function computeRoTrainDailyVolumes(
  readings: (ROReading | any)[],
): Map<string, Map<string, DailyVolumes>> {
  // dateKey → trainId → accumulator
  const acc = new Map<string, Map<string, { perm: number; feed: number; rej: number }>>();

  for (const r of readings) {
    if (!r.train_id || !r.reading_datetime) continue;
    const dk = format(new Date(r.reading_datetime), 'yyyy-MM-dd');
    if (!acc.has(dk)) acc.set(dk, new Map());
    const tMap = acc.get(dk)!;
    let entry = tMap.get(r.train_id);
    if (!entry) {
      entry = { perm: 0, feed: 0, rej: 0 };
      tMap.set(r.train_id, entry);
    }

    // PRIMARY: accumulate whatever meters are present on this reading
    const perm = r.permeate_today_m3 != null ? +r.permeate_today_m3 : 0;
    const feed = r.feed_today_m3 != null ? +r.feed_today_m3 : 0;
    const rej = r.reject_today_m3 != null ? +r.reject_today_m3 : 0;

    entry.perm += perm;
    entry.feed += feed;
    entry.rej += rej;
  }

  // FALLBACK / LAST RESORT: infer missing meters per train-day
  const out = new Map<string, Map<string, DailyVolumes>>();
  acc.forEach((tMap, dk) => {
    const dayMap = new Map<string, DailyVolumes>();
    tMap.forEach((v, tid) => {
      let { perm, feed, rej } = v;

      // If feed is missing but we have permeate and reject, infer feed
      if (feed === 0 && perm > 0 && rej > 0) {
        feed = perm + rej;
      }
      // If reject is missing but we have permeate and feed, infer reject
      if (rej === 0 && perm > 0 && feed > perm) {
        rej = feed - perm;
      }
      // If permeate is missing but we have feed and reject, infer permeate
      if (perm === 0 && feed > 0 && rej > 0) {
        perm = feed - rej;
      }
      // Last resort: if only permeate present, set feed = permeate, reject = 0
      if (perm > 0 && feed === 0 && rej === 0) {
        feed = perm;
      }
      // Last resort: if only feed present, set permeate = feed, reject = 0
      if (feed > 0 && perm === 0 && rej === 0) {
        perm = feed;
      }
      // Last resort: if only reject present, set feed = reject, permeate = 0
      if (rej > 0 && perm === 0 && feed === 0) {
        feed = rej;
      }

      dayMap.set(tid, { permeate: perm, feed, reject: rej });
    });
    out.set(dk, dayMap);
  });

  return out;
}

/**
 * Recovery % from volume totals.
 *
 * This is the ONE formula every Recovery % figure in the app now shares:
 *   recovery % = (permeate / feed) × 100   when feed > 0
 *   null                              otherwise
 *
 * This matches ROTrainWaterFlowChart.tsx:182-186 which computes
 * ΣPermeate ÷ ΣFeed × 100 from meter volumes.
 */
export function recoveryFromVolumes(
  permeate: number,
  feed: number,
  reject: number,
): number | null {
  if (feed > 0) {
    return +((permeate / feed) * 100).toFixed(1);
  }
  // If no feed but we have permeate and reject, use inferred feed
  if (permeate > 0 && reject > 0) {
    const inferredFeed = permeate + reject;
    return +((permeate / inferredFeed) * 100).toFixed(1);
  }
  return null;
}
