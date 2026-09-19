import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { PLANT_CHEMICALS } from '@/lib/chemicals';
import { FILTER_ITEMS, FILTER_UNITS, isFilterPriceEntry } from '@/lib/filterReplacements';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

const CIP_ONLY_CHEMICALS = ['Free Cl Reagent', 'Caustic Soda', 'HCl', 'SLS'];
const KNOWN_CHEMICALS = [...PLANT_CHEMICALS.map((c) => c.name), ...CIP_ONLY_CHEMICALS];

export function useChemicalPriceForm() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { selectedPlantId } = useAppStore();

  const [v, setV] = useState({
    chemical_name: '', custom: '', unit: 'kg', customUnit: '',
    unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd'),
    plant_id: selectedPlantId ?? '', provider: '',
  });

  const [itemCategory, setItemCategory] = useState<'chemical' | 'filter' | 'power'>('chemical');

  const switchCategory = useCallback((cat: 'chemical' | 'filter' | 'power') => {
    if (cat === itemCategory) return;
    setItemCategory(cat);
    setV((prev) => ({
      ...prev,
      chemical_name: '',
      custom: '',
      unit: cat === 'filter' ? 'pcs' : cat === 'power' ? 'kWh' : 'kg',
    }));
  }, [itemCategory]);

  const handleItemChange = useCallback((name: string) => {
    setV((prev) => {
      const filterUnits: readonly string[] = FILTER_UNITS;
      return {
        ...prev,
        chemical_name: name,
        unit: itemCategory === 'filter' ? (filterUnits.includes(prev.unit) ? prev.unit : 'pcs') : (prev.unit === 'set' ? 'kg' : prev.unit),
      };
    });
  }, [itemCategory]);

  const submit = useCallback(async () => {
    if (itemCategory === 'power') {
      if (!v.plant_id) { toast.error('Select a plant'); return; }
      if (!v.unit_price) { toast.error('Rate per kWh is required'); return; }
      const { error } = await supabase.from('power_tariffs').insert({
        plant_id: v.plant_id,
        effective_date: v.effective_date,
        rate_per_kwh: +v.unit_price,
        provider: v.provider.trim() || null,
        remarks: 'Entered from Costs → Prices',
        created_by: user?.id,
      });
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success('Power rate added');
      setV((prev) => ({ ...prev, provider: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') }));
      qc.invalidateQueries({ queryKey: ['tariffs', v.plant_id] });
      return;
    }

    const finalName = v.chemical_name === '__custom__' ? v.custom.trim() : v.chemical_name;
    const finalUnit = v.unit === '__custom__' ? v.customUnit.trim() : v.unit;
    if (!finalName || !v.unit_price || !finalUnit) { toast.error('Item, unit and price required'); return; }
    const { error } = await supabase.from('chemical_prices').insert({
      chemical_name: `${finalName} (${finalUnit})`, unit_price: +v.unit_price,
      effective_date: v.effective_date, updated_by: user?.id,
    });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Price record added');
    setV((prev) => ({ ...prev, chemical_name: '', custom: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') }));
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  }, [itemCategory, v, qc, user]);

  const { data: recentTariffs } = useQuery({
    queryKey: ['tariffs', v.plant_id],
    queryFn: async () => v.plant_id ? (await supabase.from('power_tariffs').select('*').eq('plant_id', v.plant_id).order('effective_date', { ascending: false }).limit(5)).data ?? [] : [],
    enabled: itemCategory === 'power' && !!v.plant_id,
  });

  return { v, setV, itemCategory, switchCategory, handleItemChange, submit, recentTariffs };
}
