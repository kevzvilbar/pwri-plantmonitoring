import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/StatusPill';
import { Pencil, X, Check, Loader2 } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { opexVarianceTone, saveOpexBudget, type MonthlyOpex } from '@/hooks/useOpexBudget';
import type { Plant } from '@/hooks/usePlants';

type Metric = 'total' | 'power' | 'chem';

export function BudgetTable({
  rows,
  isLoading,
  metric,
  editMonth,
  editV,
  saving,
  startEdit,
  cancelEdit,
  save,
  plant,
  setEditV,
}: {
  rows: MonthlyOpex[] | undefined;
  isLoading: boolean;
  metric: Metric;
  editMonth: string | null;
  editV: { power: string; chem: string };
  saving: boolean;
  startEdit: (r: MonthlyOpex) => void;
  cancelEdit: () => void;
  save: (month: string) => void;
  plant: Plant | undefined;
  setEditV: React.Dispatch<React.SetStateAction<{ power: string; chem: string }>>;
}) {
  return (
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
  );
}
