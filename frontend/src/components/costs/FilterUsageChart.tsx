// src/components/costs/FilterUsageChart.tsx
//
// Two small charts, not one dual-axis chart: how many filters got changed
// (the monitoring/frequency signal) and what that cost (the budgeting
// signal) are different questions and easy to misread combined on one
// axis. Meant to sit inside the existing Costs → Rollup tab as a
// classification alongside Power/Chemical, not as a separate page.
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
import { MonthlyFilterUsage } from "@/lib/filterUsage";

interface Props {
  data: MonthlyFilterUsage[];
}

export function FilterUsageChart({ data }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <p className="mb-1 text-sm font-medium text-muted-foreground">Filters Changed</p>
        <div className="h-64 w-full" data-testid="filter-usage-count-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="cartridge_count" name="Cartridge" stackId="usage" fill="#6366f1" />
              <Bar dataKey="bag_count" name="Bag" stackId="usage" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-muted-foreground">Filter Cost</p>
        <div className="h-64 w-full" data-testid="filter-usage-cost-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number) => `₱${value.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="cartridge_cost" name="Cartridge (₱)" stackId="cost" fill="#6366f1" />
              <Bar dataKey="bag_cost" name="Bag (₱)" stackId="cost" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
