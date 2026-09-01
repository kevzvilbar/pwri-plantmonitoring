import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, FlaskConical, Zap, Droplet, Tag, Calendar, Download, TrendingUp, Building2 } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { StatCard } from '@/components/dashboard/StatCard';
import { ExportButton } from '@/components/ExportButton';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { DateRangePicker } from '@/components/ui/date-picker';
import { useMonthlyOpex, opexVarianceTone } from '@/hooks/useOpexBudget';
import { fmtNum } from '@/lib/calculations';
import { format, startOfMonth, endOfMonth, subMonths, parseISO, subDays } from 'date-fns';
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

  const setRangePreset = (preset: '30d' | 'this_month' | 'last_month' | '90d') => {
    const now = new Date();
    if (preset === '30d') {
      setFrom(format(subDays(now, 30), 'yyyy-MM-dd'));
      setTo(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'this_month') {
      setFrom(format(startOfMonth(now), 'yyyy-MM-dd'));
      setTo(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'last_month') {
      const prev = subMonths(now, 1);
      setFrom(format(startOfMonth(prev), 'yyyy-MM-dd'));
      setTo(format(endOfMonth(prev), 'yyyy-MM-dd'));
    } else if (preset === '90d') {
      setFrom(format(subDays(now, 90), 'yyyy-MM-dd'));
      setTo(format(now, 'yyyy-MM-dd'));
    }
  };

  // ── Budget badge (Manager/Admin only) ──────────────────────────────────────
  const rangeMonth = (() => {
    const fromD = parseISO(from);
    const isFullMonth = format(startOfMonth(fromD), 'yyyy-MM-dd') === from && format(endOfMonth(fromD), 'yyyy-MM-dd') === to;
    return isFullMonth ? format(startOfMonth(fromD), 'yyyy-MM-dd') : null;
  })();
  const { data: opexRows } = useMonthlyOpex(canViewBudget && rangeMonth ? plantId : '', rangeMonth ? +rangeMonth.slice(0, 4) : new Date().getFullYear());
  const budgetRow = rangeMonth ? opexRows?.find((r) => r.month === rangeMonth && r.budgetId) : undefined;

  const { data } = useQuery({
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
    const total = r.chem + r.power;
    const daysCount = (data ?? []).length || 1;
    return {
      ...r,
      total,
      perM3: r.prod ? total / r.prod : null,
      chemPct: total ? (r.chem / total) * 100 : 0,
      powerPct: total ? (r.power / total) * 100 : 0,
      dailyAvgProd: r.prod / daysCount,
    };
  }, [data]);

  const negativePowerRows = (data ?? []).filter((d: any) => +d.power_cost < 0);
  const hasNegativePower = negativePowerRows.length > 0;

  const chartData = (data ?? []).map((d: any) => ({
    date: d.cost_date ? format(parseISO(d.cost_date), 'MMM d') : '—',
    chem: +d.chem_cost || 0,
    power: +d.power_cost || 0,
    perM3: +d.cost_per_m3 || 0,
  }));

  const plantName = plants?.find(p => p.id === plantId)?.name ?? 'Selected Plant';

  return (
    <div className="space-y-4">
      {/* Filter Toolbar Card */}
      <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5 space-y-1">
              <Label htmlFor="costs-plant-2" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3 w-3 text-primary" />
                <span>Facility</span>
              </Label>
              <PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-2" />
            </div>
            
            <div className="sm:col-span-6 space-y-1">
              <Label htmlFor="costs-from" className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">Date Range</Label>
              <DateRangePicker
                from={from}
                to={to}
                onChange={({ from: f, to: t }) => {
                  setFrom(f);
                  setTo(t);
                }}
                className="h-9 rounded-xl text-xs w-full"
              />
            </div>

            <div className="sm:col-span-1 flex justify-end">
              {plantId && (
                <ExportButton table="production_costs" label="Export" filters={{ plant_id: plantId }} />
              )}
            </div>
          </div>

          {/* Quick Date Presets Bar */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-border/50 text-2xs flex-wrap">
            <span className="text-muted-foreground font-semibold mr-1">Timeframe:</span>
            <button
              type="button"
              onClick={() => setRangePreset('30d')}
              className="px-2.5 py-0.5 rounded-lg bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => setRangePreset('this_month')}
              className="px-2.5 py-0.5 rounded-lg bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setRangePreset('last_month')}
              className="px-2.5 py-0.5 rounded-lg bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last Month
            </button>
            <button
              type="button"
              onClick={() => setRangePreset('90d')}
              className="px-2.5 py-0.5 rounded-lg bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Last 90 Days
            </button>
          </div>
        </CardContent>
      </Card>

      {plantId ? (
        <>
          {/* Negative power cost diagnostic banner */}
          {hasNegativePower && (
            <div className="rounded-2xl border border-destructive/50 bg-destructive/5 p-4 flex items-start gap-3 text-xs shadow-sm">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-destructive">
                  Negative power cost detected on {negativePowerRows.length} day(s) — data is corrupt
                </p>
                <p className="text-muted-foreground">
                  This is caused by an electric bill where <strong>current_reading &lt; previous_reading</strong>. The DB-generated <code>total_kwh</code> becomes negative.
                </p>
                <p className="text-muted-foreground">
                  <strong>Fix:</strong> Go to the <strong>Power</strong> tab → find the bill(s) with negative kWh → delete and re-enter with correct previous/current readings.
                </p>
              </div>
            </div>
          )}

          {/* ── 4 KPI Metric Cards (using shared StatCard component) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Chemical Cost */}
            <StatCard
              icon={FlaskConical}
              accent="text-highlight"
              label="Chemical OPEX"
              value={`₱${fmtNum(totals.chem, 0)}`}
              subtext={<><span className="font-semibold text-highlight font-numeral">{fmtNum(totals.chemPct, 1)}%</span> of total OPEX</>}
            />

            {/* Power Cost */}
            <StatCard
              icon={Zap}
              accent="text-chart-6"
              label="Power OPEX"
              value={`₱${fmtNum(totals.power, 0)}`}
              subtext={<><span className="font-semibold text-chart-6 font-numeral">{fmtNum(totals.powerPct, 1)}%</span> of total OPEX</>}
            />

            {/* Total Production */}
            <StatCard
              icon={Droplet}
              accent="text-info"
              label="Total Production"
              value={fmtNum(totals.prod, 0)}
              unit="m³"
              subtext={<>Daily avg: <span className="font-semibold text-foreground font-numeral">{fmtNum(totals.dailyAvgProd, 0)} m³/day</span></>}
            />

            {/* Unit Cost per m3 + OPEX Budget Variance */}
            <StatCard
              icon={Tag}
              accent="text-primary"
              label="Unit Production Cost"
              value={totals.perM3 ? `₱${totals.perM3.toFixed(2)}` : '—'}
              unit="/ m³"
              badge={budgetRow && budgetRow.variancePct != null ? (
                <StatusPill tone={opexVarianceTone(budgetRow.variancePct) === 'accent' ? 'success' : opexVarianceTone(budgetRow.variancePct)}>
                  {budgetRow.variancePct > 0 ? `+${budgetRow.variancePct.toFixed(1)}%` : `${budgetRow.variancePct.toFixed(1)}%`} vs budget
                </StatusPill>
              ) : undefined}
              subtext={budgetRow ? (
                <span>Budget: ₱{fmtNum(budgetRow.totalBudget, 0)} · Actual: ₱{fmtNum(totals.total, 0)}</span>
              ) : (
                <span>Total OPEX: ₱{fmtNum(totals.total, 0)}</span>
              )}
            />
          </div>

          {/* Daily Costs Stacked Bar Chart */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Daily Production Costs</h4>
                <p className="text-2xs text-muted-foreground">Chemical &amp; power expenses stacked by day</p>
              </div>
              <span className="text-2xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded border border-border">
                {plantName}
              </span>
            </div>

            <div className="h-64 sm:h-72 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="costsChemFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--highlight))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--highlight))" stopOpacity={0.6} />
                    </linearGradient>
                    <linearGradient id="costsPowerFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-6))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-6))" stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v) => `₱${fmtNum(v, 0)}`} />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 12,
                      fontSize: 12,
                      boxShadow: 'var(--shadow-elev)',
                      backdropFilter: 'blur(8px)',
                      padding: '8px 12px',
                    }}
                    formatter={(v: number, name: string) => [`₱${fmtNum(v, 0)}`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Bar dataKey="chem" stackId="c" fill="url(#costsChemFill)" name="Chemical Cost (₱)" radius={[0, 0, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="power" stackId="c" fill="url(#costsPowerFill)" name="Power Cost (₱)" radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <CostInsights rows={data ?? []} totals={totals} from={from} to={to} />
        </>
      ) : (
        <Card className="p-8 text-center rounded-2xl border border-border/80 space-y-2">
          <Building2 className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-bold text-foreground">Select a Facility</p>
          <p className="text-xs text-muted-foreground">Choose a plant facility above to inspect production costs and financial rollups.</p>
        </Card>
      )}
    </div>
  );
}
