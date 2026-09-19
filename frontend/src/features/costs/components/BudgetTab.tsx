import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { BudgetToolbar } from './BudgetTab/BudgetToolbar';
import { KpiCards } from './BudgetTab/KpiCards';
import { BudgetTable } from './BudgetTab/BudgetTable';
import { ChartControls } from './BudgetTab/ChartControls';
import { MonthSelector } from './BudgetTab/MonthSelector';
import { WaterfallChart } from './BudgetTab/WaterfallChart';
import { ComparisonChart } from './BudgetTab/ComparisonChart';
import { ChartLegend } from './BudgetTab/ChartLegend';
import { useBudgetWaterfall } from './BudgetTab/useBudgetWaterfall';
import { useMonthlyOpex, opexVarianceTone, saveOpexBudget, type MonthlyOpex } from '@/hooks/useOpexBudget';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

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

  const totals = useMemo(
    (): {
      budget: number;
      actual: number;
      powerBudget: number;
      powerActual: number;
      chemBudget: number;
      chemActual: number;
      solar: number;
      hasBudget: boolean;
    } =>
      (rows ?? []).reduce(
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
        { budget: 0, actual: 0, powerBudget: 0, powerActual: 0, chemBudget: 0, chemActual: 0, solar: 0, hasBudget: false as boolean },
      ),
    [rows],
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
    const { error, savedLocally } = await saveOpexBudget({ plantId, month, powerBudget: power, chemBudget: chem, userId: user?.id });
    setSaving(false);
    if (error && !savedLocally) {
      toast.error(friendlyError(error));
      return;
    }
    if (savedLocally) {
      toast.success('Budget saved (Stored in app cache)');
    } else {
      toast.success('Budget saved');
    }
    setEditMonth(null);
    qc.invalidateQueries({ queryKey: ['opex-monthly', plantId, year] });
  };

  const [selectedMonth, setSelectedMonth] = useState<string>('YTD');
  const [waterfallMode, setWaterfallMode] = useState<'cost-breakdown' | 'monthly-steps'>('cost-breakdown');

  const activeMonths = useMemo(() => (rows ?? []).filter((r) => r.totalBudget > 0 || r.totalActual > 0), [rows]);

  const comparisonData = useMemo(
    () =>
      (rows ?? []).map((r) => ({
        month: r.label.split(' ')[0],
        budget: metric === 'power' ? r.powerBudget : metric === 'chem' ? r.chemBudget : r.totalBudget,
        actual: metric === 'power' ? r.powerActual : metric === 'chem' ? r.chemActual : r.totalActual,
      })),
    [rows, metric],
  );

  const waterfallRows = useBudgetWaterfall({
    rows,
    metric,
    waterfallMode,
    selectedMonth,
    activeMonths,
    totals,
  });

  return (
    <div className="space-y-3">
      <BudgetToolbar plantId={plantId} setPlantId={setPlantId} year={year} setYear={setYear} />

      {!plantId && (
        <Card className="p-8 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">Select a plant</p>
          <p className="text-3xs text-muted-foreground">Choose a facility from the picker above to inspect OPEX budget performance.</p>
        </Card>
      )}

      {plantId && (
        <>
          <KpiCards totals={totals} totalVariancePct={totalVariancePct} totalTone={totalTone} plant={plant} />

          <BudgetTable
            rows={rows}
            isLoading={isLoading}
            metric={metric}
            editMonth={editMonth}
            editV={editV}
            saving={saving}
            startEdit={startEdit}
            cancelEdit={cancelEdit}
            save={save}
            plant={plant}
            setEditV={setEditV}
          />

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
              <ChartControls
                chartView={chartView}
                setChartView={setChartView}
                waterfallMode={waterfallMode}
                setWaterfallMode={setWaterfallMode}
                metric={metric}
                setMetric={setMetric}
              />
            </div>

            {chartView === 'waterfall' && waterfallMode === 'cost-breakdown' && (
              <MonthSelector selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} rows={rows} />
            )}

            <div className="h-72 pt-2">
              {chartView === 'waterfall' ? (
                <WaterfallChart waterfallRows={waterfallRows} />
              ) : (
                <ComparisonChart data={comparisonData} />
              )}
            </div>

            {chartView === 'waterfall' && <ChartLegend />}
          </Card>
        </>
      )}
    </div>
  );
}
