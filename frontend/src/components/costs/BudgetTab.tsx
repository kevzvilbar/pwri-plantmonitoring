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
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div><Label className="text-xs">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
          <div className="w-24">
            <Label className="text-xs">Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[year - 1, year, year + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}

      {plantId && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">Budget YTD</div><div className="font-mono-num text-lg">₱{fmtNum(totals.budget, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Actual YTD</div><div className="font-mono-num text-lg">₱{fmtNum(totals.actual, 0)}</div></Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Variance</div>
              <div className={`font-mono-num text-lg ${toneTextClass(totalTone)}`}>
                {totalVariancePct != null ? `${totals.actual >= totals.budget ? '+' : '-'}₱${fmtNum(Math.abs(totals.actual - totals.budget), 0)}` : '—'}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Variance %</div>
              <div className="text-lg">
                {totalVariancePct != null ? (
                  <StatusPill tone={totalTone}>{totalVariancePct >= 0 ? '+' : ''}{totalVariancePct.toFixed(1)}%</StatusPill>
                ) : '—'}
              </div>
            </Card>
          </div>

          {plant?.has_solar && (
            <Card className="p-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Sun className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Solar generation this year avoided about ₱{fmtNum(totals.solar, 0)} in grid cost. Solar has no
                opex line of its own here — it's capex, grid-tied, no battery — shown for context only.
              </span>
            </Card>
          )}

          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Monthly budget vs actual</h4>
              <span className="text-[10px] text-muted-foreground">Manager/Admin only</span>
            </div>

            {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full my-2" />)}

            {!isLoading && (rows ?? []).map((r) => {
              const tone = opexVarianceTone(r.variancePct);
              const isEditing = editMonth === r.month;
              return (
                <div key={r.month} className="py-2 border-b last:border-0">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium">{r.label}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Power budget ₱</Label>
                          <Input className="h-7 text-xs font-mono-num" type="number" min="0" step="any"
                            value={editV.power} onChange={(e) => setEditV({ ...editV, power: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-[10px]">Chem budget ₱</Label>
                          <Input className="h-7 text-xs font-mono-num" type="number" min="0" step="any"
                            value={editV.chem} onChange={(e) => setEditV({ ...editV, chem: e.target.value })} />
                        </div>
                      </div>
                      <div className="flex gap-1.5 justify-end">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={cancelEdit} disabled={saving}>
                          <X className="h-3 w-3" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1 bg-teal-700 hover:bg-teal-800 text-white" onClick={() => save(r.month)} disabled={saving}>
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[56px_1fr_1fr_72px_28px] gap-2 items-center text-xs">
                      <div className="font-mono-num">{r.label}</div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Budget ₱{fmtNum(r.powerBudget, 0)}</div>
                        <div className="font-mono-num font-medium">₱{fmtNum(r.powerActual, 0)}</div>
                        {plant?.has_solar && (
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Sun className="h-2.5 w-2.5" />
                            ₱{fmtNum(r.solarOffset, 0)} offset{r.solarSharePct != null ? ` · ${r.solarSharePct.toFixed(0)}% of load` : ''}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Budget ₱{fmtNum(r.chemBudget, 0)}</div>
                        <div className="font-mono-num font-medium">₱{fmtNum(r.chemActual, 0)}</div>
                      </div>
                      <div>
                        {r.variancePct != null
                          ? <StatusPill tone={tone}>{r.variancePct >= 0 ? '+' : ''}{r.variancePct.toFixed(1)}%</StatusPill>
                          : <span className="text-muted-foreground text-[10px]">No budget</span>}
                      </div>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        title="Edit budget" aria-label={`Edit budget for ${r.label}`} onClick={() => startEdit(r)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Budget vs actual</h4>
              <div className="flex gap-1">
                {(['total', 'power', 'chem'] as Metric[]).map((m) => (
                  <Button key={m} size="sm" variant="outline"
                    className={`h-7 text-xs ${metric === m ? 'bg-teal-700 hover:bg-teal-800 text-white border-teal-700' : ''}`}
                    onClick={() => setMetric(m)}>
                    {m === 'total' ? 'Total' : m === 'power' ? 'Power' : 'Chemicals'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="budget" fill="hsl(var(--muted-foreground))" name="Budget ₱" />
                  <Bar dataKey="actual" fill="hsl(var(--chart-1))" name="Actual ₱" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
