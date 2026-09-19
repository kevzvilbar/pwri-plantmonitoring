export type BlendingRowProps = {
  well: any;
  plantId: string;
  plantName?: string;
  todayVolume: number;
  previousVolume: number | null;
  previousDate: string | null;
  avgVol?: number | null;
  dbLatestRaw?: { reading: number; date: string; is_estimated?: boolean } | null;
  userId?: string | null;
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  onSaved: () => void;
};
