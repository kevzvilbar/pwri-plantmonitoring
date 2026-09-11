import React from 'react';
import { ResponsiveContainer,  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid  } from 'recharts';
import { C_TDS, C_RECOVERY, INSTRUMENT_TOOLTIP_STYLE } from '@/lib/chartColors';

const CHART_CURSOR = {
  stroke: 'hsl(var(--highlight))',
  strokeWidth: 1,
  strokeDasharray: '3 3',
};

export function RoDrillByHourChart({
  roHourDrillData, metric, roUnit,
}: {
  roHourDrillData: any[];
  metric: string;
  roUnit: string;
}) {
  const strokeColor = metric === 'tds' ? C_TDS : C_RECOVERY;
  const areaLabel = metric === 'tds' ? 'Avg TDS (ppm)' : 'Avg Recovery (%)';
  const tooltipLabel = metric === 'tds' ? 'Avg TDS' : 'Avg Recovery';

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={roHourDrillData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="hourlyDrillFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.28} />
          <stop offset="95%" stopColor={strokeColor} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 9, fontWeight: 500 }}
        stroke="hsl(var(--muted-foreground))"
        interval={Math.max(0, Math.floor(roHourDrillData.length / 12) - 1)}
        angle={-35}
        textAnchor="end"
        height={48}
        axisLine={false}
        tickLine={false}
      />
      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={44} axisLine={false} tickLine={false} />
      <Tooltip
        contentStyle={INSTRUMENT_TOOLTIP_STYLE}
        cursor={CHART_CURSOR}
        formatter={(v: any) => [v != null ? `${v} ${roUnit}` : '—', tooltipLabel]}
        labelFormatter={(label: string) => label}
      />
      <Area
        type="monotone"
        dataKey="value"
        name={areaLabel}
        stroke={strokeColor}
        strokeWidth={2.5}
        fill="url(#hourlyDrillFill)"
        dot={false}
      />
    </AreaChart>
    </ResponsiveContainer>
  );
}
