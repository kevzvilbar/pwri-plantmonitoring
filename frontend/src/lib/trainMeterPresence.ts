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
