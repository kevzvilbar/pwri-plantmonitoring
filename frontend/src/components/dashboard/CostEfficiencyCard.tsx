import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Zap,
  FlaskConical,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  Gauge,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtNum } from '@/lib/calculations';
import { useCostComposition } from '@/hooks/useCostComposition';
import { useMonthlyOpex, opexVarianceTone } from '@/hooks/useOpexBudget';
import { useAppStore } from '@/store/appStore';
import { formatRangeLabel, rangeKeyToDays } from './types';
import { format, subDays, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const GEO_FONT = "'JetBrains Mono', 'IBM Plex Mono', monospace";

interface CostEfficiencyCardProps {
  plantIds: string[];
}

export function CostEfficiencyCard({ plantIds }: CostEfficiencyCardProps) {
  const navigate = useNavigate();

  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const days = rangeKeyToDays(chartRange, chartFrom, chartTo);

  const isCustomRange = chartRange === 'CUSTOM' || chartRange === 'MONTHLY';
  const resolvedTo = isCustomRange ? chartTo : format(new Date(), 'yyyy-MM-dd');
  const resolvedFrom = isCustomRange ? chartFrom : format(subDays(new Date(), days), 'yyyy-MM-dd');

  const rangeLabel = formatRangeLabel(chartRange, chartFrom, chartTo, resolvedFrom, resolvedTo);

  // 1. Cost composition data (Power, Solar, Chem, Filters)
  const { data: costComp, isLoading: isCostCompLoading } = useCostComposition(
    plantIds,
    days,
    resolvedFrom,
    resolvedTo,
  );

  // 2. Production volume in period for unit cost calculation (₱/m³)
  const { data: prodData, isLoading: isProdLoading } = useQuery({
    queryKey: ['cost-efficiency-prod', plantIds, resolvedFrom, resolvedTo],
    queryFn: async () => {
      if (!plantIds.length) return { totalProdM3: 0, rowCount: 0 };
      const { data, error } = await supabase
        .from('production_costs')
        .select('production_m3, power_cost, chem_cost, filter_cost')
        .in('plant_id', plantIds)
        .gte('cost_date', resolvedFrom)
        .lte('cost_date', resolvedTo);

      if (error) throw error;
      const rows = data ?? [];
      const totalProdM3 = rows.reduce((s, r) => s + (Number(r.production_m3) || 0), 0);
      return { totalProdM3, rowCount: rows.length };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });

  // 3. Grid vs Solar kWh in period for tariff and solar savings
  const { data: powerData } = useQuery({
    queryKey: ['cost-efficiency-power-kwh', plantIds, resolvedFrom, resolvedTo],
    queryFn: async () => {
      if (!plantIds.length) return { gridKwh: 0, solarKwh: 0, avgTariff: 0 };
      const sinceIso = `${resolvedFrom}T00:00:00`;
      const toIso = `${resolvedTo}T23:59:59`;

      const [readingsRes, tariffRes] = await Promise.all([
        supabase
          .from('power_readings')
          .select('daily_grid_kwh, daily_solar_kwh')
          .in('plant_id', plantIds)
          .gte('reading_datetime', sinceIso)
          .lte('reading_datetime', toIso),
        supabase
          .from('power_tariffs')
          .select('rate_per_kwh, plant_id, effective_date')
          .in('plant_id', plantIds)
          .lte('effective_date', resolvedTo)
          .order('effective_date', { ascending: false }),
      ]);

      const readings = readingsRes.data ?? [];
      const tariffs = tariffRes.data ?? [];

      const gridKwh = readings.reduce((s, r) => s + (Number(r.daily_grid_kwh) || 0), 0);
      const solarKwh = readings.reduce((s, r) => s + (Number(r.daily_solar_kwh) || 0), 0);

      // Latest tariff rate average across plants
      const plantTariffMap = new Map<string, number>();
      for (const t of tariffs) {
        if (!plantTariffMap.has(t.plant_id)) {
          plantTariffMap.set(t.plant_id, Number(t.rate_per_kwh) || 0);
        }
      }
      const tariffRates = Array.from(plantTariffMap.values());
      const avgTariff = tariffRates.length
        ? tariffRates.reduce((s, r) => s + r, 0) / tariffRates.length
        : 0;

      return { gridKwh, solarKwh, avgTariff };
    },
    enabled: plantIds.length > 0,
    staleTime: 60_000,
  });

  // 4. Budget check (for single plant or primary plant in current year)
  const currentYear = new Date().getFullYear();
  const primaryPlantId = plantIds[0] ?? '';
  const { data: opexList } = useMonthlyOpex(primaryPlantId, currentYear);

  const currentMonthKey = `${format(new Date(), 'yyyy-MM')}-01`;
  const currentMonthBudget = opexList?.find((m) => m.month === currentMonthKey && m.budgetId);

  const isLoading = isCostCompLoading || isProdLoading;

  // ── Derived Metrics ──────────────────────────────────────────────────────────
  const powerCost = costComp?.powerTotal ?? 0;
  const chemCost = costComp?.chemCostTotal ?? 0;
  const filterCost = costComp?.filterCostTotal ?? 0;
  const solarNotional = costComp?.solarTotal ?? 0;
  const totalBilledCost = powerCost + chemCost + filterCost;

  const totalProdM3 = prodData?.totalProdM3 ?? 0;
  const unitCostPerM3 = totalProdM3 > 0 ? totalBilledCost / totalProdM3 : null;

  const gridKwh = powerData?.gridKwh ?? 0;
  const solarKwh = powerData?.solarKwh ?? 0;
  const totalKwh = gridKwh + solarKwh;
  const solarEnergySharePct = totalKwh > 0 ? (solarKwh / totalKwh) * 100 : 0;
  const avgTariff = powerData?.avgTariff ?? (gridKwh > 0 ? powerCost / gridKwh : 0);

  // Chemical unit intensity
  const chemCostPerM3 = totalProdM3 > 0 ? chemCost / totalProdM3 : null;

  if (isLoading) {
    return (
      <Card className="p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between mb-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-[210px] w-full rounded-xl" />
      </Card>
    );
  }

  return (
    <Card className="p-3.5 flex flex-col justify-between h-full bg-card border-border/80 shadow-2xs">
      {/* ── Card Header ────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold tracking-tight text-foreground">
              Unit Economics & OPEX Efficiency
            </span>
            <StatusPill tone={unitCostPerM3 && unitCostPerM3 > 25 ? 'warn' : 'accent'} showDot={false}>
              {rangeLabel}
            </StatusPill>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/costs?tab=rollup')}
            className="h-6 px-2 text-2xs text-muted-foreground hover:text-foreground hover:bg-muted gap-1 shrink-0 font-medium"
          >
            <span>Rollup Details</span>
            <ArrowUpRight className="h-3 w-3" />
          </Button>
        </div>

        {/* ── Hero Unit Economics Box ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border/80 bg-muted/30 p-2.5 mb-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
                <Gauge className="h-3 w-3 text-primary shrink-0" />
                <span>Specific Production Cost</span>
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span
                  className="text-xl font-extrabold text-foreground tracking-tight tabular-nums"
                  style={{ fontFamily: GEO_FONT }}
                >
                  {unitCostPerM3 != null ? `₱${unitCostPerM3.toFixed(2)}` : '—'}
                </span>
                <span className="text-xs text-muted-foreground font-medium">/ m³ produced</span>
              </div>
            </div>

            {/* Budget status or production volume context */}
            <div className="text-right">
              {currentMonthBudget && currentMonthBudget.variancePct != null ? (
                <div className="space-y-0.5">
                  <div className="text-3xs text-muted-foreground uppercase font-semibold">MTD Budget</div>
                  <StatusPill
                    tone={
                      opexVarianceTone(currentMonthBudget.variancePct) === 'accent'
                        ? 'success'
                        : opexVarianceTone(currentMonthBudget.variancePct)
                    }
                  >
                    {currentMonthBudget.variancePct > 0
                      ? `+${currentMonthBudget.variancePct.toFixed(1)}%`
                      : `${currentMonthBudget.variancePct.toFixed(1)}%`}
                  </StatusPill>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <div className="text-3xs text-muted-foreground uppercase font-semibold">Treated Volume</div>
                  <div className="text-xs font-bold text-foreground tabular-nums font-numeral">
                    {totalProdM3 > 0 ? `${fmtNum(totalProdM3, 0)} m³` : '—'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Breakdown Efficiency Rows ────────────────────────────────────────── */}
        <div className="space-y-2">
          {/* Energy & Power Economics */}
          <div className="p-2 rounded-lg border border-border/70 bg-card/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-md bg-chart-6/15 text-chart-6 flex items-center justify-center shrink-0">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">Power & Energy Tariff</div>
                <div className="text-3xs text-muted-foreground">
                  Effective grid rate: {avgTariff > 0 ? `₱${avgTariff.toFixed(2)}/kWh` : '—'}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-foreground tabular-nums font-numeral">
                ₱{fmtNum(powerCost, 0)}
              </div>
              <div className="text-3xs font-semibold text-chart-6">
                {totalBilledCost > 0 ? `${((powerCost / totalBilledCost) * 100).toFixed(1)}% OPEX` : '0%'}
              </div>
            </div>
          </div>

          {/* Solar Offset / Avoided Cost */}
          <div className="p-2 rounded-lg border border-border/70 bg-card/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-md bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">Solar Value & Savings</div>
                <div className="text-3xs text-muted-foreground">
                  {solarEnergySharePct > 0 ? `${solarEnergySharePct.toFixed(1)}% clean energy share` : 'Grid offset'}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-emerald-500 dark:text-emerald-400 tabular-nums font-numeral">
                {solarNotional > 0 ? `+₱${fmtNum(solarNotional, 0)}` : '₱0'}
              </div>
              <div className="text-3xs text-muted-foreground font-medium">avoided cost</div>
            </div>
          </div>

          {/* Chemical Intensity */}
          <div className="p-2 rounded-lg border border-border/70 bg-card/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-md bg-highlight/15 text-highlight flex items-center justify-center shrink-0">
                <FlaskConical className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">Chemical Dosing Intensity</div>
                <div className="text-3xs text-muted-foreground">
                  {chemCostPerM3 != null ? `₱${chemCostPerM3.toFixed(2)}/m³ treated` : 'Dosing rate benchmark'}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-foreground tabular-nums font-numeral">
                ₱{fmtNum(chemCost, 0)}
              </div>
              <div className="text-3xs font-semibold text-highlight">
                {totalBilledCost > 0 ? `${((chemCost / totalBilledCost) * 100).toFixed(1)}% OPEX` : '0%'}
              </div>
            </div>
          </div>

          {/* Filter Replacements */}
          <div className="p-2 rounded-lg border border-border/70 bg-card/60 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-6 w-6 rounded-md bg-chart-4/15 text-chart-4 flex items-center justify-center shrink-0">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground truncate">Filter Consumables</div>
                <div className="text-3xs text-muted-foreground">
                  Cartridge & bag replacements in period
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-foreground tabular-nums font-numeral">
                ₱{fmtNum(filterCost, 0)}
              </div>
              <div className="text-3xs font-semibold text-chart-4">
                {totalBilledCost > 0 ? `${((filterCost / totalBilledCost) * 100).toFixed(1)}% OPEX` : '0%'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer Actions & Context ───────────────────────────────────────────── */}
      <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between text-2xs">
        <span className="text-3xs text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" />
          <span>Period billed OPEX: ₱{fmtNum(totalBilledCost, 0)}</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/costs?tab=power')}
            className="text-3xs font-medium text-primary hover:underline"
          >
            Tariff Table →
          </button>
          <span className="text-border">·</span>
          <button
            type="button"
            onClick={() => navigate('/costs?tab=budget')}
            className="text-3xs font-medium text-primary hover:underline"
          >
            Budget Plan →
          </button>
        </div>
      </div>
    </Card>
  );
}
