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

/**
 * Whether a single stream is considered "measured" given its manual meter
 * reading and/or its EM flow value.
 *
 * Rules:
 *   - A manual meter reading is present when the string is non-empty.
 *   - An EM flow reading is present when it parses to a number STRICTLY > 0.
 *     Zero is not accepted: 0 m³/hr on a running RO train is physically
 *     implausible and was the exact loophole operators used to type past the
 *     required-field check while leaving the stream effectively unread.
 */
export function streamIsMeasured(opts: {
  /** Whether the stream has a physical manual-totalizer meter installed. */
  hasManualMeter: boolean;
  /** Whether the stream is configured for electromagnetic-flowmeter input. */
  isEM: boolean;
  /** The raw string value from the manual-meter "current reading" input. */
  meterReading: string | null | undefined;
  /** The raw string value from the EM flow input field. */
  emFlow: string | null | undefined;
}): boolean {
  // Manual meter: any non-empty entry counts.
  if (opts.hasManualMeter && String(opts.meterReading ?? '').trim() !== '') return true;
  // EM flow: must parse to a number strictly above zero.
  if (opts.isEM) {
    const v = parseFloat(String(opts.emFlow ?? ''));
    if (!isNaN(v) && v > 0) return true;
  }
  return false;
}

/**
 * Returns every configured stream that is not yet measured.
 *
 * A stream is "configured" when its meter flag is true (installed in Plant
 * Config). A stream is "measured" per the rules in {@link streamIsMeasured}.
 *
 * This is the single source of truth for the save-time hard block and replaces
 * the earlier dual-path checks (manual-meter path + separate EM-count path)
 * that could be bypassed by typing 0 into an EM field.
 */
export function missingMeasuredStreams(
  meterFlags: { feed: boolean; permeate: boolean; reject: boolean },
  emFlags: { feedIsEM: boolean; permIsEM: boolean; rejIsEM: boolean },
  meterReadings: { feed?: string | null; permeate?: string | null; reject?: string | null },
  emReadings: { feed?: string | null; permeate?: string | null; reject?: string | null },
): MeterStream[] {
  return (['feed', 'permeate', 'reject'] as const).filter((stream) => {
    if (!meterFlags[stream]) return false; // not installed → auto-inferred, never required
    const isEM = stream === 'feed' ? emFlags.feedIsEM
               : stream === 'permeate' ? emFlags.permIsEM
               : emFlags.rejIsEM;
    return !streamIsMeasured({
      hasManualMeter: meterFlags[stream],
      isEM,
      meterReading: meterReadings[stream],
      emFlow: emReadings[stream],
    });
  });
}

/**
 * Counts how many of the 3 absolute water flow streams (Feed, Permeate, Reject)
 * are actually measured (manual meter entered, or EM flow strictly > 0).
 *
 * Fundamental RO Rule:
 * For water balance (Feed = Permeate + Reject) to be physically solvable,
 * AT LEAST 2 OUT OF THE 3 STREAMS MUST BE MEASURED.
 * If fewer than 2 streams are measured, saving is hard-blocked because
 * the third cannot be calculated.
 */
export function countMeasuredStreams(
  meterFlags: { feed: boolean; permeate: boolean; reject: boolean },
  emFlags: { feedIsEM: boolean; permIsEM: boolean; rejIsEM: boolean },
  meterReadings: { feed?: string | null; permeate?: string | null; reject?: string | null },
  emReadings: { feed?: string | null; permeate?: string | null; reject?: string | null },
): number {
  return (['feed', 'permeate', 'reject'] as const).filter((stream) => {
    const isEM = stream === 'feed' ? emFlags.feedIsEM
               : stream === 'permeate' ? emFlags.permIsEM
               : emFlags.rejIsEM;
    return streamIsMeasured({
      hasManualMeter: meterFlags[stream],
      isEM,
      meterReading: meterReadings[stream],
      emFlow: emReadings[stream],
    });
  }).length;
}


