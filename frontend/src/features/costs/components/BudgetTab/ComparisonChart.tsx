import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export function ComparisonChart({ data }: { data: { month: string; budget: number; actual: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="budgetFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.7} />
            <stop offset="100%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.3} />
          </linearGradient>
          <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 10,
            fontSize: 12,
            boxShadow: 'var(--shadow-elev)',
            backdropFilter: 'blur(8px)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="budget" fill="url(#budgetFill)" name="Budget (₱)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="actual" fill="url(#actualFill)" name="Actual (₱)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
