import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import { BridgeTooltip } from './BridgeTooltip';
import { BridgeLegend } from './BridgeLegend';
import type { BridgeRow } from './types';

function BridgeChart({ rows }: { rows: BridgeRow[] }) {
  return (
    <>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fontWeight: 500 }}
              stroke="hsl(var(--muted-foreground))"
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              stroke="hsl(var(--muted-foreground))"
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
              width={40}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<BridgeTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
            <Bar dataKey="base" stackId="bridge" isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.name} fill="transparent" />)}
            </Bar>
            <Bar dataKey="height" stackId="bridge" radius={[3, 3, 3, 3]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.name} fill={r.fill} />)}
              <LabelList
                dataKey="deltaLabel"
                position="top"
                style={{ fontSize: 10, fontWeight: 600 }}
                fill="hsl(var(--muted-foreground))"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <BridgeLegend />
    </>
  );
}

export { BridgeChart };
