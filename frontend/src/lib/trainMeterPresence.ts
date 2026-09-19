export interface TrainMeterPresence {
  has_feed_meter: boolean | null;
  has_permeate_meter: boolean | null;
  has_reject_meter: boolean | null;
}

export type MeterStream = 'feed' | 'permeate' | 'reject';

export function trainHasMeter(
  train: TrainMeterPresence | null | undefined,
  stream: MeterStream,
): boolean {
  if (!train) return true;
  return train[`has_${stream}_meter`] ?? true;
}

export function trainMeterFlags(
  train: TrainMeterPresence | null | undefined,
): { feed: boolean; permeate: boolean; reject: boolean } {
  return {
    feed: trainHasMeter(train, 'feed'),
    permeate: trainHasMeter(train, 'permeate'),
    reject: trainHasMeter(train, 'reject'),
  };
}

/**
 * Water-meter streams the operator must still enter a reading for.
 *
 * A stream is either metered (its meter is configured for the train) → the
 * reading is REQUIRED, or unmetered (has_*_meter = false in Plant Config) →
 * its volume is auto-calculated from the other two via water balance and it
 * is never asked for. There is deliberately no "leave any one blank and we'll
 * infer it" shortcut: that made a configured meter skippable.
 */
export function missingRequiredMeters(
  flags: { feed: boolean; permeate: boolean; reject: boolean },
  readings: { feed?: string | null; permeate?: string | null; reject?: string | null },
): MeterStream[] {
  return (['feed', 'permeate', 'reject'] as const).filter(
    (stream) => flags[stream] && String(readings[stream] ?? '').trim() === '',
  );
}
