import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePlantMeterConfig } from '../../../plants/shared';
import { DEFAULT_CIP_CHEMICALS, CIP_BUILTIN_DB_MAP } from '../../../ro-trains';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

export function useCipForm(plantId: string | null, trainId: string, activeOperator: any, qc: ReturnType<typeof useQueryClient>) {
  const { config: plantConfig } = usePlantMeterConfig(plantId || null);
  const cipChemicals = plantConfig?.cip_chemicals?.length ? plantConfig.cip_chemicals : DEFAULT_CIP_CHEMICALS;

  const { data: trains } = useQuery({
    queryKey: ['cip-trains', plantId],
    queryFn: async () => plantId ? (await supabase.from('ro_trains').select('*').eq('plant_id', plantId)).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: history } = useQuery({
    queryKey: ['cip-history', trainId, plantId],
    enabled: !!plantId,
    queryFn: async () => {
      if (!plantId || !trainId) return [];
      const { data } = await supabase.from('cip_logs')
        .select('*,ro_trains(train_number)')
        .eq('plant_id', plantId)
        .order('start_datetime', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  const { data: cipPrices } = useQuery({
    queryKey: ['chem-current-prices-cip'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase.from('chemical_prices').select('*').lte('effective_date', today).order('effective_date', { ascending: false });
      const map: Record<string, number> = {};
      (data ?? []).forEach((p: any) => {
        const fullName = p.chemical_name as string;
        if (!(fullName in map)) map[fullName] = p.unit_price;
        const baseName = fullName.replace(/\s*\([^)]+\)\s*$/, '').trim();
        if (!(baseName in map)) map[baseName] = p.unit_price;
      });
      return map;
    },
  });

  const selectedTrain = trains?.find((t: any) => t.id === trainId);
  const numVessels = (selectedTrain as any)?.num_vessels ?? 15;

  const [v, setV] = useState<{ start: string; end: string; remarks: string; chemicals: Record<string, string> }>({
    start: '', end: '', remarks: '', chemicals: {},
  });

  const setChemVal = (name: string, val: string) =>
    setV(prev => ({ ...prev, chemicals: { ...prev.chemicals, [name]: val } }));

  const causticKg = +(v.chemicals['Caustic Soda'] || '') || 0;
  const hclL = +(v.chemicals['HCl'] || '') || 0;
  const slsG = +(v.chemicals['SLS'] || '') || 0;
  const totalMassKg = causticKg + slsG / 1000;
  const totalVolumeL = hclL;
  const liveCost =
    causticKg * (cipPrices?.['Caustic Soda'] ?? 0) +
    hclL * (cipPrices?.['HCl'] ?? 0) +
    (slsG / 1000) * (cipPrices?.['SLS'] ?? 0);

  const formDuration = v.start && v.end
    ? Math.round((new Date(v.end).getTime() - new Date(v.start).getTime()) / 60000)
    : null;

  const submit = async (currentTrainId: string) => {
    if (!currentTrainId) { toast.error('Select a train'); return; }

    const payload: Record<string, any> = {
      train_id: currentTrainId, plant_id: plantId,
      start_datetime: v.start ? new Date(v.start).toISOString() : null,
      end_datetime: v.end ? new Date(v.end).toISOString() : null,
      conducted_by: activeOperator?.id,
    };

    cipChemicals.forEach(chem => {
      const col = CIP_BUILTIN_DB_MAP[chem.name];
      const val = v.chemicals[chem.name];
      if (col) payload[col] = val ? +val : null;
    });
    if (!('caustic_soda_kg' in payload)) payload.caustic_soda_kg = null;
    if (!('hcl_l' in payload)) payload.hcl_l = null;
    if (!('sls_g' in payload)) payload.sls_g = null;

    const customChems = cipChemicals.filter(c => !CIP_BUILTIN_DB_MAP[c.name]);
    let remarksOut = v.remarks || null;
    if (customChems.length > 0) {
      const extra: Record<string, { value: string; unit: string }> = {};
      customChems.forEach(c => {
        const val = v.chemicals[c.name];
        if (val) extra[c.name] = { value: val, unit: c.unit };
      });
      if (Object.keys(extra).length > 0) {
        const suffix = `__cip_extra:${JSON.stringify(extra)}`;
        remarksOut = remarksOut ? `${remarksOut} ${suffix}` : suffix;
      }
    }
    payload.remarks = remarksOut;

    const { error } = await supabase.from('cip_logs').insert(payload as any);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('CIP logged');
    qc.invalidateQueries();
    clearForm();
  };

  const clearForm = () => setV({ start: '', end: '', remarks: '', chemicals: {} });

  const getHistoryCost = (c: any) =>
    (c.caustic_soda_kg || 0) * (cipPrices?.['Caustic Soda'] ?? 0) +
    (c.hcl_l || 0) * (cipPrices?.['HCl'] ?? 0) +
    ((c.sls_g || 0) / 1000) * (cipPrices?.['SLS'] ?? 0);

  const getChemType = (c: any) => {
    const parts: string[] = [];
    if (c.caustic_soda_kg > 0) parts.push('Caustic Alkaline');
    if (c.hcl_l > 0) parts.push('Acid HCl');
    if (c.sls_g > 0) parts.push('Anti Scalant');
    try {
      const match = (c.remarks ?? '').match(/__cip_extra:(\{[^}]+\})/);
      if (match) {
        const extra = JSON.parse(match[1]) as Record<string, { value: string }>;
        Object.entries(extra).forEach(([name, { value }]) => {
          if (+value > 0) parts.push(name);
        });
      }
    } catch { /* ignore bad JSON */ }
    return parts.join(' + ') || '—';
  };

  const lastCip = history?.[0];
  const lastCipCost = lastCip ? getHistoryCost(lastCip) : null;
  const comparisonPct = lastCipCost && liveCost
    ? (((liveCost - lastCipCost) / lastCipCost) * 100).toFixed(0)
    : null;

  return {
    trains, history, cipPrices, cipChemicals,
    selectedTrain, numVessels,
    v, setV, setChemVal,
    causticKg, hclL, slsG, totalMassKg, totalVolumeL, liveCost, formDuration,
    submit, clearForm,
    lastCipCost, comparisonPct,
    getHistoryCost, getChemType,
  };
}