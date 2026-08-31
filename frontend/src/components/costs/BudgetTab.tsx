import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/StatusPill';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
} from 'recharts';
import { useMonthlyOpex, opexVarianceTone, saveOpexBudget, type MonthlyOpex } from '@/hooks/useOpexBudget';
import { StatCard } from '@/components/dashboard/StatCard';
import {
  Calculator,
  Banknote,
  Scale,
  TrendingUp,
  Sun,
  Pencil,
  Check,
  X,
  Loader2,
  BarChart3,
  GitCommit,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Metric = 'total' | 'power' | 'chem';
type ChartView = 'waterfall' | 'comparison';

const toneTextClass = (tone: ReturnType<typeof opexVarianceTone>) =>
  tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn-foreground' : tone === 'accent' ? 'text-accent' : '';

export function BudgetTab() {
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const qc = useQueryClient();

  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [year, setYear] = useState(new Date().getFullYear());
  const [metric, setMetric] = useState<Metric>('total');
  const [chartView, setChartView] = useState<ChartView>('waterfall');
  const [editMonth, setEditMonth] = useState<string | null>(null);
  const [editV, setEditV] = useState({ power: '', chem: '' });
  const [saving, setSaving] = useState(false);

  const plant = plants?.find((p) => p.id === plantId);
  const { data: rows, isLoading } = useMonthlyOpex(plantId, year);

  const totals = (rows ?? []).reduce(
    (acc, r) => {
      acc.budget += r.totalBudget;
      acc.actual += r.totalActual;
      acc.powerBudget += r.powerBudget;
      acc.powerActual += r.powerActual;
      acc.chemBudget += r.chemBudget;
      acc.chemActual += r.chemActual;
      acc.solar += r.solarOffset;
      if (r.budgetId) acc.hasBudget = true;
      return acc;
    },
    { budget: 0, actual: 0, powerBudget: 0, powerActual: 0, chemBudget: 0, chemActual: 0, solar: 0, hasBudget: false },
  );
  const totalVariancePct = totals.hasBudget && totals.budget > 0 ? ((totals.actual - totals.budget) / totals.budget) * 100 : null;
  const totalTone = opexVarianceTone(totalVariancePct);

  const startEdit = (r: MonthlyOpex) => {
    setEditMonth(r.month);
    setEditV({ power: r.powerBudget ? String(r.powerBudget) : '', chem: r.chemBudget ? String(r.chemBudget) : '' });
  };
  const cancelEdit = () => setEditMonth(null);

  const save = async (month: string) => {
    const power = parseFloat(editV.power) || 0;
    const chem = parseFloat(editV.chem) || 0;
    if (power < 0 || chem < 0) { toast.error('Budget amounts must be 0 or more'); return; }
    setSaving(true);
    const { error } = await saveOpexBudget({ plantId, month, powerBudget: power, chemBudget: chem, userId: user?.id });
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Budget saved');
    setEditMonth(null);
    qc.invalidateQueries({ queryKey: ['opex-monthly', plantId, year] });
  };

  // ── Monthly comparison data ──────────────────────────────────────────────────
  const comparisonData = (rows ?? []).map((r) => ({
    month: r.label.split(' ')[0],
    budget: metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget,
    actual: metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual,
  }));

  // ── Waterfall selection & calculation ─────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>('YTD');
  const [waterfallMode, setWaterfallMode] = useState<'cost-breakdown' | 'monthly-steps'>('cost-breakdown');

  const activeMonths = useMemo(() => {
    return (rows ?? []).filter((r) => r.totalBudget > 0 || r.totalActual > 0);
  }, [rows]);

  const waterfallRows = useMemo(() => {
    if (!rows || rows.length === 0) return [];

    // Mode A: Cost Breakdown (Monthly Budget -> Power -> Chemicals -> Other -> Total Actual -> Variance)
    if (waterfallMode === 'cost-breakdown') {
      let b = 0;
      let p = 0;
      let c = 0;
      let o = 0;
      let a = 0;
      let titlePrefix = selectedMonth === 'YTD' ? 'YTD' : rows.find((r) => r.month === selectedMonth)?.label.split(' ')[0] ?? '';

      if (selectedMonth === 'YTD') {
        b = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget), 0);
        p = activeMonths.reduce((sum, r) => sum + r.powerActual, 0);
        c = activeMonths.reduce((sum, r) => sum + r.chemActual, 0);
        o = activeMonths.reduce((sum, r) => sum + r.otherActual, 0);
        a = metric === 'power' ? p : metric === 'chem' ? c : p + c + o;
      } else {
        const target = rows.find((r) => r.month === selectedMonth);
        if (target) {
          b = metric === 'power' ? target.powerBudget : metric === 'chem' ? target.chemBudget : target.totalBudget;
          p = target.powerActual;
          c = target.chemActual;
          o = target.otherActual;
          a = metric === 'power' ? p : metric === 'chem' ? c : target.totalActual;
        }
      }

      const variance = a - b;

      const items: Array<{
        name: string;
        base: number;
        height: number;
        fill: string;
        deltaLabel: string;
        rawAmount: number;
        budget: number;
        actual: number;
        kind: 'start' | 'delta' | 'end' | 'variance';
      }> = [];

      // 1. Budget Baseline (Pillar)
      items.push({
        name: `${titlePrefix} Budget`,
        base: 0,
        height: b,
        fill: '#00b4d8', // Cyan
        deltaLabel: `₱${fmtNum(b, 0)}`,
        rawAmount: b,
        budget: b,
        actual: 0,
        kind: 'start',
      });

      // When viewing 'total', show Power, Chemicals, and Other (if > 0)
      if (metric === 'total') {
        // 2. Power Cost Step
        items.push({
          name: 'Power Cost',
          base: 0,
          height: p,
          fill: '#f59e0b', // Amber
          deltaLabel: `+₱${fmtNum(p, 0)}`,
          rawAmount: p,
          budget: selectedMonth === 'YTD' ? totals.powerBudget : (rows.find((r) => r.month === selectedMonth)?.powerBudget ?? 0),
          actual: p,
          kind: 'delta',
        });

        // 3. Chemical Cost Step
        items.push({
          name: 'Chemical Cost',
          base: p,
          height: c,
          fill: '#8b5cf6', // Purple
          deltaLabel: `+₱${fmtNum(c, 0)}`,
          rawAmount: c,
          budget: selectedMonth === 'YTD' ? totals.chemBudget : (rows.find((r) => r.month === selectedMonth)?.chemBudget ?? 0),
          actual: c,
          kind: 'delta',
        });

        // 4. Other Cost Step (Filters / Cartridges / Maintenance)
        if (o > 0 || selectedMonth === 'YTD') {
          items.push({
            name: 'Other Cost',
            base: p + c,
            height: Math.max(o, 1),
            fill: '#06b6d4', // Teal
            deltaLabel: o > 0 ? `+₱${fmtNum(o, 0)}` : '₱0',
            rawAmount: o,
            budget: 0,
            actual: o,
            kind: 'delta',
          });
        }
      }

      // 5. Total Actual (Pillar)
      items.push({
        name: `${titlePrefix} Actual`,
        base: 0,
        height: a,
        fill: '#3b82f6', // Vibrant Blue
        deltaLabel: `₱${fmtNum(a, 0)}`,
        rawAmount: a,
        budget: b,
        actual: a,
        kind: 'end',
      });

      // 6. Variance Pillar / Step
      if (b > 0) {
        items.push({
          name: 'Variance',
          base: variance > 0 ? b : a,
          height: Math.max(Math.abs(variance), 1),
          fill: variance > 0 ? '#ef4444' : '#10b981', // Red if over budget, Emerald if savings
          deltaLabel: `${variance >= 0 ? '+' : '−'}₱${fmtNum(Math.abs(variance), 0)}`,
          rawAmount: variance,
          budget: b,
          actual: a,
          kind: 'variance',
        });
      } else {
        items.push({
          name: 'Variance',
          base: 0,
          height: a,
          fill: '#ef4444',
          deltaLabel: 'Unbudgeted',
          rawAmount: a,
          budget: 0,
          actual: a,
          kind: 'variance',
        });
      }

      return items;
    }

    // Mode B: Monthly Progression Steps (Jan -> Feb -> Mar -> ... -> Actual YTD)
    const totalB = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget), 0);
    const totalA = activeMonths.reduce((sum, r) => sum + (metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual), 0);

    const items: Array<{
      name: string;
      base: number;
      height: number;
      fill: string;
      deltaLabel: string;
      rawAmount: number;
      budget: number;
      actual: number;
      kind: 'start' | 'delta' | 'end' | 'variance';
    }> = [];

    items.push({
      name: 'Budget YTD',
      base: 0,
      height: totalB,
      fill: '#00b4d8',
      deltaLabel: `₱${fmtNum(totalB, 0)}`,
      rawAmount: totalB,
      budget: totalB,
      actual: 0,
      kind: 'start',
    });

    let current = totalB;
    for (const r of activeMonths) {
      const monthName = r.label.split(' ')[0];
      const b = metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget;
      const a = metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual;
      const diff = a - b;
      const next = current + diff;

      items.push({
        name: monthName,
        base: Math.min(current, next),
        height: Math.max(Math.abs(diff), 1),
        fill: diff > 0 ? '#f59e0b' : diff < 0 ? '#10b981' : 'hsl(var(--muted-foreground))',
        deltaLabel: diff === 0 ? '₱0' : `${diff > 0 ? '+' : '−'}₱${fmtNum(Math.abs(diff), 0)}`,
        rawAmount: diff,
        budget: b,
        actual: a,
        kind: 'delta',
      });
      current = next;
    }

    items.push({
      name: 'Actual YTD',
      base: 0,
      height: totalA,
      fill: '#3b82f6',
      deltaLabel: `₱${fmtNum(totalA, 0)}`,
      rawAmount: totalA,
      budget: totalB,
      actual: totalA,
      kind: 'end',
    });

    return items;
  }, [rows, metric, waterfallMode, selectedMonth, activeMonths, totals]);

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="p-1.5 rounded-xl border border-border/50 bg-card flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="flex-1">
            <PlantPicker value={plantId} onChange={setPlantId} id="budgettab-plant" />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-2xs text-muted-foreground font-semibold">Year:</span>
          <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
            <SelectTrigger id="budgettab-year" className="h-8 w-24 rounded-lg text-xs font-medium bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[year - 1, year, year + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!plantId && (
        <Card className="p-8 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">Select a plant</p>
          <p className="text-3xs text-muted-foreground">Choose a facility from the picker above to inspect OPEX budget performance.</p>
        </Card>
      )}

      {plantId && (
        <>
          {/* ── 4 KPI Stat Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <StatCard
              icon={Calculator}
              accent="text-muted-foreground"
              label="Budget YTD"
              value={`₱${fmtNum(totals.budget, 0)}`}
              subtext="Accumulated baseline plan"
            />
            <StatCard
              icon={Banknote}
              accent="text-primary"
              label="Actual YTD"
              value={`₱${fmtNum(totals.actual, 0)}`}
              subtext="Total power, chem & other expenses"
            />
            <StatCard
              icon={Scale}
              accent="text-highlight"
              label="Variance"
              value={totalVariancePct != null ? `${totals.actual >= totals.budget ? '+' : '-'}₱${fmtNum(Math.abs(totals.actual - totals.budget), 0)}` : '—'}
              subtext={totals.hasBudget ? 'Net variance vs budget' : 'No budget configured'}
            />
            <StatCard
              icon={TrendingUp}
              label="Variance %"
              value={totalVariancePct != null ? `${totalVariancePct >= 0 ? '+' : ''}${totalVariancePct.toFixed(1)}%` : '—'}
              badge={totalVariancePct != null ? (
                <StatusPill tone={totalTone === 'accent' ? 'success' : totalTone}>
                  {totalVariancePct <= 0 ? 'On Track' : totalVariancePct > 15 ? 'Critical' : 'Over'}
                </StatusPill>
              ) : undefined}
              subtext={totals.hasBudget ? 'Relative budget delta' : 'Unbudgeted period'}
            />
          </div>

          {plant?.has_solar && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
              <Sun className="h-4 w-4 text-warn shrink-0 mt-0.5" />
              <span>
                Solar generation this year avoided about <strong className="text-foreground font-mono-num">₱{fmtNum(totals.solar, 0)}</strong> in grid cost. (Informational offset — solar is capex, grid-tied, no battery).
              </span>
            </div>
          )}

          {/* ── Monthly Budget vs Actual Table ── */}
          <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Monthly Budget vs Actual</h4>
                <p className="text-2xs text-muted-foreground">Detailed breakdown by month for Power and Chemicals</p>
              </div>
              <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded">
                Manager/Admin only
              </span>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[80px_1fr_1fr_90px_40px] gap-2 text-3xs uppercase tracking-wider font-semibold text-muted-foreground pb-2 border-b">
              <div>Month</div>
              <div>Power OPEX</div>
              <div>Chemical OPEX</div>
              <div className="text-center">Variance</div>
              <div className="text-right">Action</div>
            </div>

            {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full my-1 rounded-lg" />)}

            {!isLoading && (
              <div className="divide-y divide-border/40">
                {(rows ?? []).map((r) => {
                  const tone = opexVarianceTone(r.variancePct);
                  const isEditing = editMonth === r.month;
                  return (
                    <div key={r.month} className="py-2 hover:bg-muted/20 transition-colors">
                      {isEditing ? (
                        <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 space-y-2">
                          <div className="text-xs font-semibold text-foreground">{r.label}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="budgettab-power-budget" className="text-3xs uppercase font-medium text-muted-foreground">Power budget (₱)</Label>
                              <Input className="h-8 text-xs font-mono-num bg-background" type="number" min="0" step="any"
                                value={editV.power} onChange={(e) => setEditV({ ...editV, power: e.target.value })} id="budgettab-power-budget"/>
                            </div>
                            <div>
                              <Label htmlFor="budgettab-chem-budget" className="text-3xs uppercase font-medium text-muted-foreground">Chem budget (₱)</Label>
                              <Input className="h-8 text-xs font-mono-num bg-background" type="number" min="0" step="any"
                                value={editV.chem} onChange={(e) => setEditV({ ...editV, chem: e.target.value })} id="budgettab-chem-budget"/>
                            </div>
                          </div>
                          <div className="flex gap-1.5 justify-end pt-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={cancelEdit} disabled={saving}>
                              <X className="h-3 w-3" /> Cancel
                            </Button>
                            <Button size="sm" className="h-7 text-xs gap-1 shadow-xs" onClick={() => save(r.month)} disabled={saving}>
                              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[80px_1fr_1fr_90px_40px] gap-2 items-center text-xs">
                          <div className="font-semibold text-foreground font-mono-num">{r.label.split(' ')[0]}</div>
                          <div>
                            <div className="font-mono-num font-medium text-foreground">₱{fmtNum(r.powerActual, 0)}</div>
                            <div className="text-3xs text-muted-foreground font-mono-num">
                              Plan: ₱{fmtNum(r.powerBudget, 0)}
                              {plant?.has_solar && r.solarOffset > 0 && (
                                <span className="ml-1 text-chart-6">· ₱{fmtNum(r.solarOffset, 0)} solar</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="font-mono-num font-medium text-foreground">₱{fmtNum(r.chemActual, 0)}</div>
                            <div className="text-3xs text-muted-foreground font-mono-num">Plan: ₱{fmtNum(r.chemBudget, 0)}</div>
                          </div>
                          <div className="text-center">
                            {r.variancePct != null ? (
                              <StatusPill tone={tone === 'accent' ? 'success' : tone}>
                                {r.variancePct >= 0 ? '+' : ''}{r.variancePct.toFixed(1)}%
                              </StatusPill>
                            ) : (
                              <span className="text-muted-foreground/60 text-2xs">—</span>
                            )}
                          </div>
                          <div className="text-right">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Edit budget" aria-label={`Edit budget for ${r.label}`} onClick={() => startEdit(r)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── Visual Comparison & Waterfall Variance Chart ── */}
          <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {chartView === 'waterfall' ? 'Budget vs Actual Variance Waterfall' : 'Budget vs Actual Variance Chart'}
                </h4>
                <p className="text-2xs text-muted-foreground">
                  {chartView === 'waterfall'
                    ? waterfallMode === 'cost-breakdown'
                      ? 'Monthly Budget, Power Cost, Chemical Cost, Other, and Net Variance bridge'
                      : 'Monthly sequential build-up and variance progression'
                    : 'Monthly side-by-side expense comparisons'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* View Switcher: Waterfall (Default) vs Monthly Bars */}
                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border/60">
                  <button
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                      chartView === 'waterfall'
                        ? 'bg-background text-primary shadow-xs font-bold border border-border/60'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setChartView('waterfall')}
                    title="View Waterfall variance bridge"
                  >
                    <GitCommit className="h-3 w-3" />
                    Waterfall
                  </button>
                  <button
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                      chartView === 'comparison'
                        ? 'bg-background text-primary shadow-xs font-bold border border-border/60'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setChartView('comparison')}
                    title="View side-by-side monthly comparison"
                  >
                    <BarChart3 className="h-3 w-3" />
                    Monthly Bars
                  </button>
                </div>

                {/* Sub-mode switcher for Waterfall (Cost Breakdown vs Monthly Steps) */}
                {chartView === 'waterfall' && (
                  <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
                    <button
                      className={`px-2 py-0.5 text-3xs font-medium rounded transition-all ${
                        waterfallMode === 'cost-breakdown'
                          ? 'bg-background text-foreground shadow-2xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setWaterfallMode('cost-breakdown')}
                    >
                      Cost Breakdown
                    </button>
                    <button
                      className={`px-2 py-0.5 text-3xs font-medium rounded transition-all ${
                        waterfallMode === 'monthly-steps'
                          ? 'bg-background text-foreground shadow-2xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setWaterfallMode('monthly-steps')}
                    >
                      Monthly Steps
                    </button>
                  </div>
                )}

                {/* Metric Selector: Total, Power, Chemicals */}
                <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
                  {(['total', 'power', 'chem'] as Metric[]).map((m) => (
                    <button
                      key={m}
                      className={`px-2.5 py-1 text-2xs font-medium rounded-md transition-all ${
                        metric === m ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setMetric(m)}
                    >
                      {m === 'total' ? 'Total' : m === 'power' ? 'Power' : 'Chemicals'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Interactive Month Selector Bar (for Cost Breakdown Mode) ── */}
            {chartView === 'waterfall' && waterfallMode === 'cost-breakdown' && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1 pt-0.5 border-b border-border/40 text-2xs">
                <span className="text-3xs uppercase font-semibold text-muted-foreground mr-1 shrink-0">Period:</span>
                <button
                  className={`px-2.5 py-1 rounded-md font-medium shrink-0 transition-all ${
                    selectedMonth === 'YTD'
                      ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                      : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  onClick={() => setSelectedMonth('YTD')}
                >
                  YTD Full Year
                </button>
                {(rows ?? []).map((r) => {
                  const hasData = r.totalBudget > 0 || r.totalActual > 0;
                  const isSel = selectedMonth === r.month;
                  return (
                    <button
                      key={r.month}
                      className={`px-2 py-1 rounded-md font-medium shrink-0 transition-all ${
                        isSel
                          ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                          : hasData
                          ? 'bg-muted/40 text-foreground hover:bg-muted/80 font-medium'
                          : 'bg-muted/20 text-muted-foreground/50 hover:text-muted-foreground'
                      }`}
                      onClick={() => setSelectedMonth(r.month)}
                    >
                      {r.label.split(' ')[0]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Chart Canvas ── */}
            <div className="h-72 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {chartView === 'waterfall' ? (
                  <BarChart data={waterfallRows} margin={{ top: 20, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fontWeight: 500, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 10.5, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `₱${(v / 1000).toFixed(0)}k` : `₱${v}`)}
                      axisLine={false}
                      tickLine={false}
                      width={55}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const data = payload[0]?.payload;
                        if (!data) return null;

                        return (
                          <div className="p-3 rounded-xl bg-card/95 border border-border shadow-xl backdrop-blur-md text-xs space-y-1.5 min-w-[200px]">
                            <div className="font-bold text-foreground border-b border-border/60 pb-1 flex items-center justify-between gap-2">
                              <span>{data.name}</span>
                              {data.kind === 'start' ? (
                                <span className="text-3xs font-mono uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-semibold">
                                  Baseline Target
                                </span>
                              ) : data.kind === 'end' ? (
                                <span className="text-3xs font-mono uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">
                                  Total Actual OPEX
                                </span>
                              ) : data.kind === 'variance' ? (
                                data.rawAmount > 0 ? (
                                  <span className="text-3xs font-mono uppercase bg-danger-soft text-danger px-1.5 py-0.5 rounded font-bold">
                                    Over Budget (+Cost)
                                  </span>
                                ) : data.rawAmount < 0 ? (
                                  <span className="text-3xs font-mono uppercase bg-accent-soft text-accent px-1.5 py-0.5 rounded font-bold">
                                    Under Budget (Savings)
                                  </span>
                                ) : (
                                  <span className="text-3xs font-mono uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                    On Target
                                  </span>
                                )
                              ) : (
                                <span className="text-3xs font-mono uppercase bg-muted/60 text-foreground px-1.5 py-0.5 rounded font-medium">
                                  Cost Component
                                </span>
                              )}
                            </div>

                            {data.kind === 'start' && (
                              <div className="space-y-0.5">
                                <div className="text-muted-foreground">
                                  Planned Budget: <strong className="text-foreground font-mono-num">₱{fmtNum(data.rawAmount, 0)}</strong>
                                </div>
                              </div>
                            )}

                            {data.kind === 'delta' && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Expense Amount:</span>
                                  <span className="font-mono-num font-bold text-foreground">₱{fmtNum(data.rawAmount, 0)}</span>
                                </div>
                                {data.budget > 0 && (
                                  <div className="flex justify-between text-muted-foreground border-t border-border/40 pt-0.5">
                                    <span>Allocated Plan:</span>
                                    <span className="font-mono-num">₱{fmtNum(data.budget, 0)}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {data.kind === 'end' && (
                              <div className="space-y-1">
                                <div className="text-muted-foreground">
                                  Total Actual Spent: <strong className="text-primary font-mono-num font-bold">₱{fmtNum(data.rawAmount, 0)}</strong>
                                </div>
                                <div className="text-3xs text-muted-foreground border-t border-border/40 pt-1 flex justify-between">
                                  <span>Net Variance:</span>
                                  <span className={cn('font-mono-num font-bold', data.rawAmount > data.budget ? 'text-danger' : 'text-accent')}>
                                    {data.rawAmount >= data.budget ? '+' : ''}₱{fmtNum(data.rawAmount - data.budget, 0)} (
                                    {(((data.rawAmount - data.budget) / (data.budget || 1)) * 100).toFixed(1)}%)
                                  </span>
                                </div>
                              </div>
                            )}

                            {data.kind === 'variance' && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Budget Baseline:</span>
                                  <span className="font-mono-num">₱{fmtNum(data.budget, 0)}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Actual Incurred:</span>
                                  <span className="font-mono-num font-semibold text-foreground">₱{fmtNum(data.actual, 0)}</span>
                                </div>
                                <div className="flex justify-between border-t border-border/40 pt-1">
                                  <span className="font-medium">Variance Delta:</span>
                                  <span
                                    className={cn(
                                      'font-mono-num font-bold',
                                      data.rawAmount > 0 ? 'text-danger' : data.rawAmount < 0 ? 'text-accent' : 'text-muted-foreground'
                                    )}
                                  >
                                    {data.rawAmount > 0 ? '+' : ''}₱{fmtNum(data.rawAmount, 0)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    {/* Transparent Base Bar (with individual transparent Cells to avoid Recharts fallback fill bug) */}
                    <Bar dataKey="base" stackId="bridge" isAnimationActive={false}>
                      {waterfallRows.map((r, i) => (
                        <Cell key={`base-${r.name}-${i}`} fill="transparent" />
                      ))}
                    </Bar>
                    {/* Floating Delta / Total Bar */}
                    <Bar
                      dataKey="height"
                      stackId="bridge"
                      radius={[4, 4, 4, 4]}
                      isAnimationActive={false}
                    >
                      {waterfallRows.map((r, i) => (
                        <Cell key={`bar-${r.name}-${i}`} fill={r.fill} />
                      ))}
                      <LabelList
                        dataKey="deltaLabel"
                        position="top"
                        style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'monospace' }}
                        fill="hsl(var(--foreground))"
                      />
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={comparisonData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                )}
              </ResponsiveContainer>
            </div>

            {/* ── Waterfall Legend (Visible in Waterfall View) ── */}
            {chartView === 'waterfall' && (
              <div className="flex flex-wrap items-center justify-center gap-4 pt-2 border-t border-border/40 text-2xs text-muted-foreground font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#00b4d8]" />
                  <span>Budget Target</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#f59e0b]" />
                  <span>Power Cost</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#8b5cf6]" />
                  <span>Chemical Cost</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#06b6d4]" />
                  <span>Other (Filters)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#3b82f6]" />
                  <span>Total Actual</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-xs bg-[#ef4444]" />
                  <span>Variance (+Over / −Savings)</span>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

