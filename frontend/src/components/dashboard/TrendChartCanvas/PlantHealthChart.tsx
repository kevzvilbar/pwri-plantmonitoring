import React from 'react';
import { ResponsiveContainer,  ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine  } from 'recharts';
import { CHART_CURSOR } from './chartShell';

function PhTooltip({ active, payload, label, phActiveData }: any) {
  if (!active || !payload?.length) return null;
  const row = phActiveData.find((d: any) => d.date === label);
  if (!row) return null;
  const pct = row.healthPct ?? 0;
  const dotColor = pct >= 80 ? '#10b981' : pct >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 8, fontSize: 11, padding: '8px 10px',
      minWidth: 170, boxShadow: 'var(--shadow-elev)', opacity: 0.92, backdropFilter: 'blur(4px)',
    }}>
      <p style={{ margin: '0 0 5px', fontWeight: 600 }}>{label}</p>
      <p style={{ margin: '1px 0', color: dotColor, fontWeight: 700 }}>
        Health: {pct != null ? `${pct}%` : '—'}
      </p>
      {row.onlineCount != null && (
        <>
          <p style={{ margin: '1px 0', color: '#10b981' }}>
            ● Online: {row.onlineCount} / {row.totalTrains}
          </p>
          <p style={{ margin: '1px 0', color: 'hsl(var(--danger))' }}>
            ● Offline: {row.offlineCount}
          </p>
        </>
      )}
      {row.offlineTrains.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
          <p style={{ margin: '0 0 3px', fontSize: 10, fontWeight: 600, color: 'hsl(var(--danger))' }}>
            Offline trains:
          </p>
          {row.offlineTrains.map((name: string) => (
            <p key={name} style={{ margin: '1px 0', fontSize: 10, color: 'hsl(var(--danger))', opacity: 0.85 }}>
              · {name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function dotFill(entry: any) {
  const p = entry?.healthPct ?? 0;
  return p >= 80 ? '#10b981' : p >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';
}

export function PlantHealthChart({
  phActiveData, phDrillMode, handlePhDayDotActivate,
}: {
  phActiveData: any[];
  phDrillMode: string;
  handlePhDayDotActivate: (payload: any) => void;
}) {
  const bottomMargin = phDrillMode === 'hourly' ? 32 : 0;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={phActiveData} margin={{ top: 8, right: 8, left: 0, bottom: bottomMargin }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis
        dataKey="date"
        tick={{ fontSize: phDrillMode === 'hourly' ? 8 : 10 }}
        stroke="hsl(var(--muted-foreground))"
        angle={phDrillMode === 'hourly' ? -35 : 0}
        textAnchor={phDrillMode === 'hourly' ? 'end' : 'middle'}
        height={phDrillMode === 'hourly' ? 48 : 20}
        interval={phDrillMode === 'hourly'
          ? Math.max(0, Math.floor(phActiveData.length / 12) - 1)
          : 'preserveStartEnd'}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 10 }}
        stroke="hsl(var(--muted-foreground))"
        domain={[0, 100]}
        tickFormatter={(v) => `${v}%`}
        width={44}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip content={<PhTooltip phActiveData={phActiveData} />} cursor={CHART_CURSOR} />
      <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 3" strokeWidth={1}
        label={{ value: '80%', position: 'right', fontSize: 9, fill: '#10b981' }} />
      <ReferenceLine y={50} stroke="hsl(var(--warn))" strokeDasharray="4 3" strokeWidth={1}
        label={{ value: '50%', position: 'right', fontSize: 9, fill: 'hsl(var(--warn))' }} />
      <Line
        type="monotone"
        dataKey="healthPct"
        name="Plant Health (%)"
        strokeWidth={2}
        dot={(props: any) => {
          const { cx, cy, payload } = props;
          const fill = dotFill(payload);
          const isDrillable = phDrillMode === 'daily' && !!payload?._slotKey;
          if (!isDrillable) {
            return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={fill} stroke={fill} />;
          }
          const activate = () => handlePhDayDotActivate(payload);
          return (
            <g key={`dot-${cx}-${cy}`}>
              <circle
                cx={cx} cy={cy} r={9} fill="transparent"
                role="button"
                tabIndex={0}
                aria-label={`Drill into ${(payload?.date as string) ?? 'this day'}'s hourly health`}
                style={{ cursor: 'pointer', outline: 'none' }}
                onClick={activate}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
                }}
              />
              <circle cx={cx} cy={cy} r={3} fill={fill} stroke={fill} pointerEvents="none" />
            </g>
          );
        }}
        stroke="#10b981"
        connectNulls
      />
    </ComposedChart>
    </ResponsiveContainer>
  );
}
