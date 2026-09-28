import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { fmtNum } from '@/lib/calculations';
import { format, subMonths, startOfMonth } from 'date-fns';
import { TrendingDown, TrendingUp, AlertTriangle, CheckCircle, FlaskConical, Scale } from 'lucide-react';
import { DataState } from '@/components/DataState';

export function ChemicalVariance() {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState<string>(selectedPlantId || plants?.[0]?.id || '');
  const [selectedMonth, setSelectedMonth] = useState<string>(
    format(startOfMonth(new Date()), 'yyyy-MM-01')
  );

  // Fallback to first plant once loaded
  useMemo(() => {
    if (!plantId && plants && plants.length > 0) {
      setPlantId(plants[0].id);
    }
  }, [plantId, plants]);

  // Generate last 12 months for selector
  const monthOptions = useMemo(() => {
    const list = [];
    for (let i = 0; i < 12; i++) {
      const d = subMonths(new Date(), i);
      list.push({
        value: format(startOfMonth(d), 'yyyy-MM-01'),
        label: format(d, 'MMMM yyyy'),
      });
    }
    return list;
  }, []);

  // Fetch monthly chemical price variance via RPC fn_chem_monthly_variance
  const { data: varianceRows, isLoading: loadingVariance } = useQuery({
    queryKey: ['chem-monthly-variance', plantId, selectedMonth],
    queryFn: async () => {
      if (!plantId) return [];
      try {
        const { data, error } = await (supabase.rpc as any)('fn_chem_monthly_variance', {
          p_plant_id: plantId,
          p_month: selectedMonth,
        });
        if (error) {
          console.warn('fn_chem_monthly_variance RPC note:', error);
          return [];
        }
        return (data ?? []) as Array<{
          catalog_id: string;
          chemical_name: string;
          base_unit: string;
          total_usage_base: number;
          standard_cost: number;
          actual_delivery_avg_unit_cost: number | null;
          actual_cost: number | null;
          price_variance: number | null;
          has_actual_cost: boolean;
        }>;
      } catch (err) {
        console.warn('fn_chem_monthly_variance error:', err);
        return [];
      }
    },
    enabled: !!plantId,
  });

  // Fetch bottle pack yield events for this plant
  const { data: packEvents, isLoading: loadingPacks } = useQuery({
    queryKey: ['reagent-pack-events', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await (supabase
        .from('reagent_pack_events' as any) as any)
        .select(`
          id,
          event_at,
          tests_since_prev,
          rated_tests,
          yield_pct,
          chemical_catalog ( name, base_unit )
        `)
        .eq('plant_id', plantId)
        .order('event_at', { ascending: false })
        .limit(20);

      if (error) return [];
      return data ?? [];
    },
    enabled: !!plantId,
  });

  // Summary rollups
  const totalStandard = varianceRows?.reduce((s, r) => s + (+r.standard_cost || 0), 0) ?? 0;
  const totalActual = varianceRows?.reduce((s, r) => s + (+r.actual_cost || 0), 0) ?? 0;
  const netVariance = varianceRows?.reduce((s, r) => s + (+r.price_variance || 0), 0) ?? 0;

  return (
    <div className="space-y-4 text-xs">
      {/* Filters Card */}
      <Card className="p-3.5 space-y-2.5 border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Chemical OPEX & Price Variance</h4>
            <p className="text-2xs text-muted-foreground">
              Standard List Dosing Cost vs Actual Delivery Invoiced Cost & Bottle Yields
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-44">
              <Select value={plantId} onValueChange={setPlantId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select plant" />
                </SelectTrigger>
                <SelectContent>
                  {plants?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-40">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3 bg-muted/20 space-y-1">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold">
            Standard Dosing Cost
          </div>
          <div className="text-lg font-mono font-bold text-foreground">
            ₱{fmtNum(totalStandard, 2)}
          </div>
          <div className="text-3xs text-muted-foreground">Standard benchmark rate × usage</div>
        </Card>

        <Card className="p-3 bg-muted/20 space-y-1">
          <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold">
            Actual Delivered Cost
          </div>
          <div className="text-lg font-mono font-bold text-foreground">
            {totalActual > 0 ? `₱${fmtNum(totalActual, 2)}` : '—'}
          </div>
          <div className="text-3xs text-muted-foreground">
            Weighted actual invoice rate × usage
          </div>
        </Card>

        <Card
          className={`p-3 space-y-1 ${
            netVariance > 0
              ? 'bg-rose-500/10 border-rose-500/30'
              : netVariance < 0
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-muted/20'
          }`}
        >
          <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-between">
            <span>Monthly Price Variance</span>
            {netVariance > 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-rose-500" />
            ) : netVariance < 0 ? (
              <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
            ) : null}
          </div>
          <div
            className={`text-lg font-mono font-bold ${
              netVariance > 0
                ? 'text-rose-600 dark:text-rose-400'
                : netVariance < 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-foreground'
            }`}
          >
            {netVariance !== 0 ? `${netVariance > 0 ? '+' : ''}₱${fmtNum(netVariance, 2)}` : '₱0.00'}
          </div>
          <div className="text-3xs text-muted-foreground">
            {netVariance > 0
              ? 'Unfavorable (Deliveries cost more than standard)'
              : netVariance < 0
              ? 'Favorable (Deliveries cost less than standard)'
              : 'On budget'}
          </div>
        </Card>
      </div>

      {/* Monthly Item Variance Table */}
      <Card className="p-4 space-y-3 border-border/60">
        <h4 className="text-sm font-semibold text-foreground">Chemical Item Cost Breakdown</h4>

        <DataState
          loading={loadingVariance}
          isEmpty={!varianceRows?.length}
          emptyTitle="No chemical usage recorded for this month"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3">Product Name</th>
                  <th className="py-2 px-3 text-right">Usage</th>
                  <th className="py-2 px-3 text-right">Standard Cost</th>
                  <th className="py-2 px-3 text-right">Avg Delivered Cost</th>
                  <th className="py-2 px-3 text-right">Actual Cost</th>
                  <th className="py-2 pl-3 text-right">Price Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {varianceRows?.map((row) => (
                  <tr key={row.catalog_id || row.chemical_name} className="hover:bg-muted/30">
                    <td className="py-2 pr-3 font-medium">
                      {row.chemical_name}
                      <span className="text-2xs text-muted-foreground font-normal ml-1">
                        ({row.base_unit})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {fmtNum(row.total_usage_base, 2)} {row.base_unit}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      ₱{fmtNum(row.standard_cost, 2)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.actual_delivery_avg_unit_cost !== null
                        ? `₱${fmtNum(row.actual_delivery_avg_unit_cost, 2)}/${row.base_unit}`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {row.actual_cost !== null ? `₱${fmtNum(row.actual_cost, 2)}` : '—'}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono">
                      {row.price_variance !== null ? (
                        <span
                          className={
                            row.price_variance > 0
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : row.price_variance < 0
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              : 'text-muted-foreground'
                          }
                        >
                          {row.price_variance > 0 ? '+' : ''}₱{fmtNum(row.price_variance, 2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>

      {/* Reagent Bottle Pack Yields */}
      <Card className="p-4 space-y-3 border-border/60">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Liquid Reagent Bottle Yield History</h4>
            <p className="text-2xs text-muted-foreground">
              Tracking actual completed tests per bottle against manufacturer rated capacity
            </p>
          </div>
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
        </div>

        <DataState
          loading={loadingPacks}
          isEmpty={!packEvents?.length}
          emptyTitle="No completed reagent bottles logged yet"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3">Date Completed</th>
                  <th className="py-2 px-3">Reagent</th>
                  <th className="py-2 px-3 text-right">Tests Achieved</th>
                  <th className="py-2 px-3 text-right">Rated Tests</th>
                  <th className="py-2 pl-3 text-right">Yield</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {packEvents?.map((event: any) => {
                  const yieldPct = +event.yield_pct || 100;
                  return (
                    <tr key={event.id} className="hover:bg-muted/30">
                      <td className="py-2 pr-3 font-mono text-muted-foreground">
                        {format(new Date(event.event_at), 'yyyy-MM-dd HH:mm')}
                      </td>
                      <td className="py-2 px-3 font-medium">
                        {event.chemical_catalog?.name ?? 'Liquid Reagent'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {event.tests_since_prev ?? '—'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {event.rated_tests ?? '—'}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono">
                        <Badge
                          variant="outline"
                          className={
                            yieldPct >= 95
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                              : yieldPct >= 80
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                          }
                        >
                          {yieldPct}%
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>
    </div>
  );
}
