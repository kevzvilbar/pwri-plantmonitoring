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
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="month" fontSize={12} />
          <YAxis fontSize={12} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} />
          <Tooltip formatter={(value: number) => `₱${value.toLocaleString()}`} />
          <Legend />
          <Bar dataKey="cartridge_cost" name="Cartridge (₱)" stackId="filters" fill="#6366f1" />
          <Bar dataKey="bag_cost" name="Bag (₱)" stackId="filters" fill="#f59e0b" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
