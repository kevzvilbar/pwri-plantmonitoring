import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum } from '@/lib/calculations';
import { ExportButton } from '@/components/ExportButton';
import { PLANT_CHEMICALS, CHEM_DOSING_COLUMN } from '@/features/ro-trains';

import { AddStockDialog } from './AddStockDialog';

export function ChemInventory() {
  const { isManager } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const ids = useMemo(
    () => (selectedPlantId ? [selectedPlantId] : plants?.map((p) => p.id) ?? []),
    [selectedPlantId, plants]
  );

  const { data: stockRows } = useQuery({
    queryKey: ['chem-stock-computed', ids],
    queryFn: async () => {
      if (!ids.length) return [];

      const plantNameMap = new Map((plants ?? []).map((p) => [p.id, p.name]));

      // 1. Try calling server-side RPC fn_chem_stock for each plant
      try {
        const rpcResults = await Promise.all(
          ids.map(async (plantId) => {
            const { data, error } = await (supabase.rpc as any)('fn_chem_stock', {
              p_plant_id: plantId,
            });
            if (error || !data) return [];
            return (data as any[]).map((row) => ({
              plant_id: plantId,
              plant_name: plantNameMap.get(plantId) ?? '',
              chemical_name: row.chemical_name,
              unit: row.base_unit,
              received: +row.delivered_base || 0,
              used: +row.used_base || 0,
              current: +row.stock_on_hand || 0,
              daily_avg_7d: row.daily_avg_7d !== null ? +row.daily_avg_7d : null,
              days_of_supply: row.days_of_supply !== null ? +row.days_of_supply : null,
            }));
          })
        );

        const flattened = rpcResults.flat();
        // Only return if RPC returned meaningful rows (has deliveries or items)
        if (flattened.some((r) => r.received > 0 || r.used > 0)) {
          return flattened.filter((r) => r.received > 0 || r.used > 0);
        }
      } catch (rpcErr) {
        console.warn('fn_chem_stock RPC fallback:', rpcErr);
      }

      // 2. Client-side fallback computation
      const [{ data: deliveries }, { data: dosing }, { data: plantsData }] = await Promise.all([
        supabase
          .from('chemical_deliveries')
          .select('plant_id,chemical_name,quantity,unit,qty_base')
          .in('plant_id', ids),
        supabase
          .from('chemical_dosing_logs')
          .select('plant_id,chlorine_kg,smbs_kg,anti_scalant_l,soda_ash_kg')
          .in('plant_id', ids),
        supabase.from('plants').select('id,name').in('id', ids),
      ]);

      const plantName = new Map((plantsData ?? []).map((p: any) => [p.id, p.name]));
      const map = new Map<
        string,
        {
          plant_id: string;
          plant_name: string;
          chemical_name: string;
          unit: string;
          received: number;
          used: number;
          daily_avg_7d: number | null;
          days_of_supply: number | null;
        }
      >();
      const key = (p: string, c: string) => `${p}::${c}`;

      (deliveries ?? []).forEach((d: any) => {
        const k = key(d.plant_id, d.chemical_name);
        const cur = map.get(k) ?? {
          plant_id: d.plant_id,
          plant_name: plantName.get(d.plant_id) ?? '',
          chemical_name: d.chemical_name,
          unit: d.unit,
          received: 0,
          used: 0,
          daily_avg_7d: null,
          days_of_supply: null,
        };
        cur.received += +(d.qty_base ?? d.quantity) || 0;
        map.set(k, cur);
      });

      const dosingMap: Array<[string, string]> = PLANT_CHEMICALS.map((c) => [
        c.name,
        c.defaultUnit,
      ]);
      (dosing ?? []).forEach((row: any) => {
        for (const [name, unit] of dosingMap) {
          const usedQty = +row[CHEM_DOSING_COLUMN[name]] || 0;
          if (!usedQty) continue;
          const k = key(row.plant_id, name);
          const cur = map.get(k) ?? {
            plant_id: row.plant_id,
            plant_name: plantName.get(row.plant_id) ?? '',
            chemical_name: name,
            unit,
            received: 0,
            used: 0,
            daily_avg_7d: null,
            days_of_supply: null,
          };
          cur.used += usedQty;
          map.set(k, cur);
        }
      });

      return Array.from(map.values()).map((r) => ({ ...r, current: r.received - r.used }));
    },
    enabled: ids.length > 0,
  });

  const { data: thresholds } = useQuery({
    queryKey: ['chem-thresholds', ids],
    queryFn: async () =>
      ids.length
        ? (
            await supabase
              .from('chemical_inventory')
              .select('plant_id,chemical_name,low_stock_threshold')
              .in('plant_id', ids)
          ).data ?? []
        : [],
    enabled: ids.length > 0,
  });

  const thresholdMap = useMemo(() => {
    const m = new Map<string, number>();
    (thresholds ?? []).forEach((t: any) =>
      m.set(`${t.plant_id}::${t.chemical_name}`, +t.low_stock_threshold || 0)
    );
    return m;
  }, [thresholds]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Stock = Received Deliveries − Actual Dosing Consumption
        </p>
        <div className="flex gap-2">
          <ExportButton table="chemical_deliveries" label="Deliveries" />
          <ExportButton table="chemical_dosing_logs" label="Dosing" />
          {isManager && <AddStockDialog />}
        </div>
      </div>

      {stockRows?.map((c) => {
        const threshold = thresholdMap.get(`${c.plant_id}::${c.chemical_name}`) ?? 10;
        const ratio = threshold ? (c.current / (threshold * 4)) * 100 : 0;
        return (
          <Card key={`${c.plant_id}::${c.chemical_name}`} className="p-3">
            <div className="flex justify-between text-sm">
              <div>
                <div className="font-medium">{c.chemical_name}</div>
                <div className="text-xs text-muted-foreground">{c.plant_name}</div>
                <div className="text-2xs text-muted-foreground font-mono-num">
                  +{fmtNum(c.received, 2)} / -{fmtNum(c.used, 2)} {c.unit}
                  {c.days_of_supply !== null && c.days_of_supply !== undefined && (
                    <span className="ml-2 text-foreground font-medium">
                      · {fmtNum(c.days_of_supply, 1)} days supply
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono-num text-base font-semibold">
                  {fmtNum(c.current, 2)} {c.unit}
                </div>
                {c.current < threshold && <StatusPill tone="danger">Low stock</StatusPill>}
              </div>
            </div>
            <Progress value={Math.max(0, Math.min(100, ratio))} className="mt-2 h-1.5" />
          </Card>
        );
      })}
      {!stockRows?.length && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No stock yet — log a delivery to begin tracking.
        </Card>
      )}
    </div>
  );
}
