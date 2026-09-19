/* eslint-disable @typescript-eslint/no-explicit-any */
export type ReplacementKind = 'well' | 'locator' | 'product' | 'power' | 'train' | 'blending';

export interface ReplacementTarget {
  kind: ReplacementKind;
  readingId: string | null;
  entityId: string;
  plantId?: string | null;
  meterIndex?: number | null;
  meterType?: string | null;
  entityName?: string | null;
  readingDatetime?: string | null;
}

export interface NormalizedReplacement {
  id: string;
  table: string;
  meterLabel?: string | null;
  oldSerial?: string | null;
  oldBrand?: string | null;
  oldSize?: string | null;
  oldFinal?: number | null;
  replacementDate?: string | null;
  newBrand?: string | null;
  newSize?: string | null;
  newSerial?: string | null;
  newInitial?: number | null;
  installedDate?: string | null;
  oldMultiplier?: number | null;
  newMultiplier?: number | null;
  replacedBy?: string | null;
  replacerName?: string | null;
  remarks?: string | null;
  raw: any;
}

export interface ReplacementDetailHost {
  target: ReplacementTarget;
  settingsHref?: string | null;
  canEdit?: boolean;
}
