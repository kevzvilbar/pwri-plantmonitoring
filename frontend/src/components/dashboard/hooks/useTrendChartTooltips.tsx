import { format } from 'date-fns';

export function NegativeAwareTooltip({ active, payload, label, trendRows, viewGran }: any) {
  if (!active || !payload?.length) return null;
  const chartRow: any = trendRows.find((d: any) => d.date === label);
  const replacements: string[] = chartRow?._meterReplacements ?? [];
  const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];
  const dayCount: number | undefined = chartRow?._dayCount;
  const isPartial: boolean | undefined = chartRow?._partial;

  let expectedBucketDays: number | null = null;
  if (viewGran === 'weekly') {
    expectedBucketDays = 7;
  } else if (viewGran === 'monthly' && chartRow?.isoDate) {
    const d = new Date(`${chartRow.isoDate}T00:00:00`);
    if (!isNaN(d.getTime())) {
      expectedBucketDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    }
  }

  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 10,
      fontSize: 11,
      padding: '9px 12px',
      minWidth: 148,
      maxWidth: 300,
      boxShadow: 'var(--shadow-elev)',
      backdropFilter: 'blur(8px)',
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 12, letterSpacing: '-0.01em' }}>{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ margin: '2px 0', color: entry.color ?? entry.stroke, fontWeight: 500 }}>
          {entry.name}:{' '}
          <span style={{ fontWeight: 700 }}>{entry.value != null ? entry.value.toLocaleString() : '—'}</span>
        </p>
      ))}
      {replacements.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          {replacements.map((name: string) => (
            <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--warn))', marginBottom: 2 }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
              <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                <strong>{name} was Replaced</strong>
              </span>
            </div>
          ))}
        </div>
      )}
      {permeateSourceNames.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--muted-foreground))' }}>
          <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
          <span style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.85 }}>
            Source: Permeate meter ({permeateSourceNames.join(', ')})
          </span>
        </div>
      )}
      {viewGran !== 'daily' && dayCount != null && expectedBucketDays != null && (
        <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
          <span>Coverage: </span>
          <strong style={{ color: dayCount < expectedBucketDays ? 'hsl(var(--warn))' : 'inherit' }}>
            {dayCount} of {expectedBucketDays} days reported
          </strong>
          {isPartial ? ' · partial' : ''}
        </div>
      )}
    </div>
  );
}

export function PvTooltip({ active, payload, label, trendRows, viewGran }: any) {
  if (!active || !payload?.length) return null;
  const row: any = trendRows.find((d: any) => d.date === label);
  if (!row) return null;
  const gridPv  = row.production > 0 ? +(row.kwh / row.production).toFixed(2) : null;
  const totalPv = row.production > 0 && (row.kwh + row.solarKwh) > 0
    ? +((row.kwh + row.solarKwh) / row.production).toFixed(2) : null;
  const hasSolar = row.solarKwh > 0;
  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 8, fontSize: 11, padding: '8px 10px',
      minWidth: 200, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
    }}>
      <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '1px 0', color: '#4A90D9' }}>
        Grid PV: <strong>{gridPv != null ? `${gridPv} kWh/m³` : '0 kWh/m³'}</strong>
      </p>
      {hasSolar && (
        <p style={{ margin: '1px 0', color: '#34C759' }}>
          (Grid+Solar) PV: <strong>{totalPv != null ? `${totalPv} kWh/m³` : '—'}</strong>
        </p>
      )}
      <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
        <p style={{ margin: '1px 0', color: '#34C759' }}>
          Volume: <span>{row.production > 0 ? row.production.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' m³' : '—'}</span>
        </p>
        <p style={{ margin: '1px 0', color: '#4A90D9' }}>
          Grid Power: <span>{row.kwh > 0 ? row.kwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
        </p>
        <p style={{ margin: '1px 0', color: '#34C759' }}>
          Solar: <span>{row.solarKwh > 0 ? row.solarKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' kWh' : '—'}</span>
        </p>
      </div>
      {viewGran !== 'daily' && row?._dayCount != null && (
        <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid hsl(var(--border))', fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>
          <span>Coverage: </span>
          <strong>{row._dayCount} {row._dayCount === 1 ? 'day' : 'days'} reported</strong>
          {row._partial ? ' · partial' : ''}
        </div>
      )}
    </div>
  );
}
