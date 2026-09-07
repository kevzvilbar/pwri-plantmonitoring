export type DSMTab = 'overview' | 'production' | 'consumption' | 'grid-by-meter';

export const TH = 'px-3 py-2 text-right text-2xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/80 align-bottom sticky top-0 z-20 bg-card/95 backdrop-blur-sm';
export const TH_DATE = 'px-3.5 py-2 text-left text-2xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border/80 sticky left-0 top-0 z-30 bg-card/95 backdrop-blur-sm w-[84px] min-w-[84px]';
export const TH_TOTAL = 'px-3 py-2 text-right text-2xs font-extrabold border-b border-l border-border/80 sticky right-0 top-0 z-30 bg-primary-soft text-primary align-bottom w-[90px] min-w-[90px]';
export const TD = 'px-3 py-2 text-right font-mono tabular-nums text-xs text-foreground/90';
export const TD_TOTAL_ROW = 'px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-primary bg-primary/5';
export const TD_TOTAL_COL = 'px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-primary sticky right-0 z-10 border-l border-border/60 bg-primary-soft/40 w-[90px] min-w-[90px]';

export function fmtV(v: number | null | undefined, dec = 2) {
  if (v == null || v === 0) return <span className="text-muted-foreground/40">—</span>;
  return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
