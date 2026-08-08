// src/components/costs/FilterCostChart.tsx
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MonthlyFilterCost } from "@/lib/filterReplacements";

interface Props {
  data: MonthlyFilterCost[];
}

export function FilterCostChart({ data }: Props) {
  return (
    <div className="h-72 w-full" data-testid="filter-cost-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cartridgeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#6366f1" stopOpacity={0.55} />
            </linearGradient>
            <linearGradient id="bagFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
          <XAxis dataKey="month" fontSize={12} axisLine={false} tickLine={false} />
          <YAxis fontSize={12} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number) => `₱${value.toLocaleString()}`}
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', backdropFilter: 'blur(8px)' }}
          />
          <Legend />
          {/* stacked: Cartridge sits below Bag, so only the top segment (Bag) is rounded */}
          <Bar dataKey="cartridge_cost" name="Cartridge (₱)" stackId="filters" fill="url(#cartridgeFill)" radius={[0, 0, 0, 0]} maxBarSize={32} />
          <Bar dataKey="bag_cost" name="Bag (₱)" stackId="filters" fill="url(#bagFill)" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
