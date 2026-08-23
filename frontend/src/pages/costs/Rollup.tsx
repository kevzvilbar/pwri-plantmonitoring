import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { ExportButton } from '@/components/ExportButton';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { useMonthlyOpex, opexVarianceTone } from '@/hooks/useOpexBudget';
import { fmtNum } from '@/lib/calculations';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';
import { CostInsights } from './CostInsights';

export function Rollup() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isManager, isAdmin } = useAuth();
  const canViewBudget = usePermission('costs', 'budget');
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [from, setFrom] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // ── Budget badge (Manager/Admin only) — only when the selected range is
  // exactly one calendar month, so we're comparing like with like. ────────────
  const rangeMonth = (() => {
    const fromD = parseISO(from);
    const isFullMonth = format(startOfMonth(fromD), 'yyyy-MM-dd') === from && format(endOfMonth(fromD), 'yyyy-MM-dd') === to;
    return isFullMonth ? format(startOfMonth(fromD), 'yyyy-MM-dd') : null;
  })();
  const { data: opexRows } = useMonthlyOpex(canViewBudget && rangeMonth ? plantId : '', rangeMonth ? +rangeMonth.slice(0, 4) : new Date().getFullYear());
  const budgetRow = rangeMonth ? opexRows?.find((r) => r.month === rangeMonth && r.budgetId) : undefined;

  const { data, refetch } = useQuery({
    queryKey: ['cost-rollup', plantId, from, to],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase.from('production_costs')
        .select('*').eq('plant_id', plantId)
        .gte('cost_date', from).lte('cost_date', to)
        .order('cost_date');
      return data ?? [];
    },
    enabled: !!plantId,
  });

  const totals = useMemo(() => {
    const r = (data ?? []).reduce((acc: any, x: any) => {
      acc.chem += +x.chem_cost || 0; acc.power += +x.power_cost || 0;
      acc.prod += +x.production_m3 || 0;
      return acc;
    }, { chem: 0, power: 0, prod: 0 });
    return { ...r, total: r.chem + r.power, perM3: r.prod ? (r.chem + r.power) / r.prod : null };
  }, [data]);

  // Detect rows with negative power cost — a sure sign of bad meter readings in
  // electric_bills (current_reading < previous_reading causes negative GENERATED
  // total_kwh, which the production_costs view propagates as negative power cost).
  const negativePowerRows = (data ?? []).filter((d: any) => +d.power_cost < 0);
  const hasNegativePower = negativePowerRows.length > 0;

  const chartData = (data ?? []).map((d: any) => ({
    date: d.cost_date ? format(parseISO(d.cost_date), 'MMM d') : '—',
    chem: +d.chem_cost || 0,
    power: +d.power_cost || 0,
    perM3: +d.cost_per_m3 || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div><Label htmlFor="costs-plant-2" className="text-xs">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-2" /></div>
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0"><Label htmlFor="costs-from" className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} id="costs-from"/></div>
            <div className="flex-1 min-w-0"><Label htmlFor="costs-to" className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} id="costs-to"/></div>
          </div>
        </div>
      </Card>
      {plantId && (
        <>
          <div className="flex justify-end">
            <ExportButton table="production_costs" label="Export rollup" filters={{ plant_id: plantId }} />
          </div>

          {/* ── Negative power cost diagnostic banner ───────────────────── */}
          {hasNegativePower && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 flex items-start gap-2 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-destructive">
                  Negative power cost detected on {negativePowerRows.length} day(s) — data is corrupt
                </p>
                <p className="text-muted-foreground">
                  This is caused by an electric bill where <strong>current_reading &lt; previous_reading</strong>
                  (readings imported in the wrong order). The DB-generated <code>total_kwh</code> becomes
                  negative, which the cost view carries forward as a negative power cost.
                </p>
                <p className="text-muted-foreground">
                  <strong>Fix:</strong> Go to the <strong>Power</strong> tab → find the bill(s) with a
                  negative kWh value (shown in red) → delete and re-enter with the correct
                  previous/current readings, or re-import the corrected CSV.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">Chem cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.chem, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Power cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.power, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Production</div><div className="font-mono-num text-lg">{fmtNum(totals.prod, 0)} m³</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Cost/m³</div><div className="font-mono-num text-lg">{totals.perM3 ? `₱${totals.perM3.toFixed(2)}` : '—'}</div></Card>
          </div>
          {budgetRow && budgetRow.variancePct != null && (
            <div className="flex justify-end">
              <StatusPill tone={opexVarianceTone(budgetRow.variancePct)}>
                {budgetRow.variancePct >= 0 ? '+' : ''}{budgetRow.variancePct.toFixed(1)}% vs budget
              </StatusPill>
            </div>
          )}
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Daily costs</h4>
            <div className="h-64 sm:h-72">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <defs>
                    <linearGradient id="costsChemFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.55} />
                    </linearGradient>
                    <linearGradient id="costsPowerFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow-elev)', backdropFilter: 'blur(8px)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* stacked: chem sits below power, so only the top segment (power) is rounded — same convention as the kWh Solar/Grid stack in TrendChart.tsx */}
                  <Bar dataKey="chem" stackId="c" fill="url(#costsChemFill)" name="Chem ₱" radius={[0, 0, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="power" stackId="c" fill="url(#costsPowerFill)" name="Power ₱" radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <CostInsights rows={data ?? []} totals={totals} from={from} to={to} />
        </>
      )}
      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}
    </div>
  );
}
