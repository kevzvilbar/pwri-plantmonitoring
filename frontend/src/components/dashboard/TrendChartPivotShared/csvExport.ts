import type { GridMeterBreakdown } from './gridMeterBreakdown';

export function csvField(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildKwhSummaryCsv(
  overviewRows: { date: string; kwh?: number | null; solarKwh?: number | null }[],
  breakdown: GridMeterBreakdown,
  dates: string[],
): string {
  const s1: string[] = [
    'Solar vs Grid',
    'date,solar_kwh,grid_kwh,total_kwh,solar_pct',
  ];
  for (const r of overviewRows) {
    const solar = +(r.solarKwh ?? 0);
    const grid = +(r.kwh ?? 0);
    const total = solar + grid;
    s1.push([
      csvField(r.date),
      solar !== 0 ? +solar.toFixed(2) : '',
      grid !== 0 ? +grid.toFixed(2) : '',
      total > 0 ? +total.toFixed(2) : '',
      total > 0 && solar > 0 ? +((solar / total) * 100).toFixed(1) : '',
    ].join(','));
  }

  const GRID_METER_OTHER_KEY = '__other__';
  const cols: { key: string; label: string }[] = breakdown.hasUnattributed
    ? [...breakdown.columns, { key: GRID_METER_OTHER_KEY, label: 'Other' }]
    : breakdown.columns;
  const s2: string[] = [
    'Grid by Meter',
    ['date', ...cols.map((c) => csvField(c.label)), 'total_kwh'].join(','),
  ];
  for (const dk of dates) {
    const row = breakdown.byDate.get(dk);
    s2.push([
      csvField(dk),
      ...cols.map((c) => {
        const v = row?.values[c.key];
        return v != null ? +v.toFixed(2) : '';
      }),
      row && row.total > 0 ? +row.total.toFixed(2) : '',
    ].join(','));
  }

  return [s1.join('\n'), '', s2.join('\n')].join('\n');
}
