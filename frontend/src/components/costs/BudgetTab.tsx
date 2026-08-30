import { useState } from 'react';
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
import { Pencil, Check, X, Loader2, Sun } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useMonthlyOpex, opexVarianceTone, saveOpexBudget, type MonthlyOpex } from '@/hooks/useOpexBudget';

type Metric = 'total' | 'power' | 'chem';

const toneTextClass = (tone: ReturnType<typeof opexVarianceTone>) =>
  tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn-foreground' : tone === 'accent' ? 'text-accent' : '';

import { StatCard } from '@/components/dashboard/StatCard';
import { Calculator, Banknote, Scale, TrendingUp, Sun, Pencil, Check, X, Loader2 } from 'lucide-react';

export function BudgetTab() {
  const { user } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const qc = useQueryClient();

  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [year, setYear] = useState(new Date().getFullYear());
  const [metric, setMetric] = useState<Metric>('total');
  const [editMonth, setEditMonth] = useState<string | null>(null);
  const [editV, setEditV] = useState({ power: '', chem: '' });
  const [saving, setSaving] = useState(false);

  const plant = plants?.find((p) => p.id === plantId);
  const { data: rows, isLoading } = useMonthlyOpex(plantId, year);

  const totals = (rows ?? []).reduce(
    (acc, r) => {
      acc.budget += r.totalBudget; acc.actual += r.totalActual; acc.solar += r.solarOffset;
      if (r.budgetId) acc.hasBudget = true;
      return acc;
    },
    { budget: 0, actual: 0, solar: 0, hasBudget: false },
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

  const chartData = (rows ?? []).map((r) => ({
    month: r.label.split(' ')[0],
    budget: metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget,
    actual: metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual,
  }));

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
              subtext="Total power & chem expenses"
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

          {/* ── Visual Comparison Chart ── */}
          <Card className="p-4 space-y-3 border-border/60 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Budget vs Actual Variance Chart</h4>
                <p className="text-2xs text-muted-foreground">Monthly expense comparisons</p>
              </div>
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
            <div className="h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₱${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, boxShadow: 'var(--shadow-elev)', backdropFilter: 'blur(8px)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="budget" fill="url(#budgetFill)" name="Budget (₱)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="actual" fill="url(#actualFill)" name="Actual (₱)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
