/**
 * frontend/src/lib/trainEmMeter.ts
 *
 * Per-stream EM-vs-manual meter helper for RO trains.
 *
 * A train feed/permeate/reject streams can independently be configured as
 * electromagnetic-flowmeter-capable or manual-totalizer-only. This module
 * centralizes the precedence so the reading form, the calculation hook, and
 * the config UI all agree.
 *
 * WHY THIS LIVES IN src/lib/ INSTEAD OF A PAGE TREE:
 * Both the RO Train log form (pages/ROTrains/pretreatment/) and the Plant
 * Configuration settings (pages/plants/config/) need it. The two page folders
 * have different casing (ROTrains vs ro-trains-style paths), so a cross-folder
 * import breaks the case-sensitive Linux/Vercel build. Anything both sides
 * need belongs at the shared level (src/lib), never imported page-to-page.
 */

export interface TrainEmMeterConfig {
  uses_em_meter: boolean | null;
  em_all_streams: boolean | null;
  em_stream_feed: boolean | null;
  em_stream_permeate: boolean | null;
  em_stream_reject: boolean | null;
}

export type EmStream = 'feed' | 'permeate' | 'reject';

/**
 * Returns true when the given stream on the given train should accept an
 * electromagnetic flowmeter reading. Precedence:
 *   1. Train has no EM meter at all ? manual for every stream.
 *   2. Train's "all streams EM" flag is on ? EM for every stream.
 *   3. Otherwise ? the per-stream flag decides (default false = manual).
 *
 * A manual-only stream never falls back to an EM-derived estimate — it always
 * uses its own manual-meter calculation (meter delta ÷ duration), even on a
 * day that reading is missing.
 */
export function trainUsesEmForStream(
  train: TrainEmMeterConfig | null | undefined,
  stream: EmStream,
): boolean {
  if (!train) return true; // no train row ? default EM (existing behavior)
  if (!train.uses_em_meter) return false;
  if (train.em_all_streams) return true;
  return train[`em_stream_${stream}`] ?? false; // default false = manual
}

/**
 * Convenience: returns the EM flag for all three streams at once. Useful for
 * passing into the calculation hook and the reading form.
 */
export function trainEmFlags(
  train: TrainEmMeterConfig | null | undefined,
): { feedIsEM: boolean; permIsEM: boolean; rejIsEM: boolean } {
  return {
    feedIsEM: trainUsesEmForStream(train, 'feed'),
    permIsEM: trainUsesEmForStream(train, 'permeate'),
    rejIsEM: trainUsesEmForStream(train, 'reject'),
  };
}