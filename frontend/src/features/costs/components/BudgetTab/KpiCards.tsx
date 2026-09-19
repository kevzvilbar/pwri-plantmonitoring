import { StatusPill } from '@/components/StatusPill';
import { StatCard } from '@/components/dashboard/StatCard';
import { Calculator, Banknote, Scale, TrendingUp, Sun } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { opexVarianceTone } from '@/hooks/useOpexBudget';
import type { Plant } from '@/hooks/usePlants';

export function KpiCards({ totals, totalVariancePct, totalTone, plant }: {
  totals: {
    budget: number;
    actual: number;
    powerBudget: number;
    powerActual: number;
    chemBudget: number;
    chemActual: number;
    solar: number;
    hasBudget: boolean;
  };
  totalVariancePct: number | null;
  totalTone: ReturnType<typeof opexVarianceTone>;
  plant: Plant | undefined;
}) {
  return (
    <>
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
    </>
  );
}
