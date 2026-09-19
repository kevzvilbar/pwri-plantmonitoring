import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import type { EditTrainDialogProps } from './EditTrainDialog';

export type { EditTrainDialogProps } from './EditTrainDialog';
export type TrainFormState = ReturnType<typeof useTrainForm>;

export function useTrainForm(props: EditTrainDialogProps) {
  const { train, plant, onClose } = props;
  const qc = useQueryClient();
  const { isManager } = useAuth();

  const plantMediaType: 'AFM' | 'MMF' = plant.filter_media_type ?? 'AFM';
  const plantFilterType: 'Cartridge Filter' | 'Bag Filter' = plant.filter_housing_type ?? 'Cartridge Filter';

  const [form, setForm] = useState({
    name: train.name ?? '',
    num_afm: String(train.num_afm ?? 0),
    num_booster_pumps: String(train.num_booster_pumps ?? 0),
    num_hp_pumps: String(train.num_hp_pumps ?? 0),
    hpp_target_pressure_psi: train.hpp_target_pressure_psi != null ? String(train.hpp_target_pressure_psi) : '',
    num_cartridge_filters: String(train.num_cartridge_filters ?? 0),
    num_controllers: String(train.num_controllers ?? 0),
    num_filter_housings: String(train.num_filter_housings ?? 0),
    filter_media_type: train.filter_media_type ?? plantMediaType,
    filter_housing_type: train.filter_housing_type ?? plantFilterType,
    well_id: train.well_id ?? '',
  });
  const [saving, setSaving] = useState(false);

  const parsedBoosterTargets = useMemo(() => {
    const raw = train.booster_pump_targets as any;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { psi_mode: raw.psi_mode !== false, targets: (raw.targets ?? {}) as Record<string, number> };
    }
    return { psi_mode: true, targets: {} as Record<string, number> };
  }, [train.booster_pump_targets]);
  const [boosterPsiMode, setBoosterPsiMode] = useState(parsedBoosterTargets.psi_mode);
  const [boosterTargets, setBoosterTargets] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsedBoosterTargets.targets)) {
      if (v != null) out[Number(k)] = String(v);
    }
    return out;
  });

  const { data: plantWells = [] } = useQuery({
    queryKey: ['plant-wells-for-train-edit', train.plant_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('wells')
        .select('id, name')
        .eq('plant_id', train.plant_id)
        .order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });

  const num = useCallback((v: string) => (v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0)), []);

  const save = useCallback(async () => {
    setSaving(true);
    const payload: any = {
      name: form.name.trim() || null,
      num_afm: num(form.num_afm),
      num_booster_pumps: num(form.num_booster_pumps),
      booster_pump_targets: num(form.num_booster_pumps) > 0
        ? {
            psi_mode: boosterPsiMode,
            targets: Object.fromEntries(
              Array.from({ length: num(form.num_booster_pumps) }, (_, i) => i + 1)
                .filter(u => (boosterTargets[u] ?? '') !== '')
                .map(u => [String(u), Number(boosterTargets[u])]),
            ),
          }
        : null,
      num_hp_pumps: num(form.num_hp_pumps),
      hpp_target_pressure_psi: form.hpp_target_pressure_psi === '' ? null : Number(form.hpp_target_pressure_psi),
      num_cartridge_filters: num(form.num_cartridge_filters),
      num_controllers: num(form.num_controllers),
      num_filter_housings: num(form.num_filter_housings),
      filter_media_type: form.filter_media_type,
      filter_housing_type: form.filter_housing_type,
      well_id: form.well_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('ro_trains').update(payload).eq('id', train.id);
    setSaving(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`Train ${train.train_number} updated`);
    qc.invalidateQueries({ queryKey: ['ro-trains', train.plant_id] });
    onClose();
  }, [form, boosterPsiMode, boosterTargets, num, train, qc, onClose]);

  const mediaType = form.filter_media_type as 'AFM' | 'MMF';
  const filterHousingType = form.filter_housing_type as 'Cartridge Filter' | 'Bag Filter';
  const usingPlantMedia = mediaType === plantMediaType;
  const usingPlantFilter = filterHousingType === plantFilterType;

  return {
    form, setForm, saving, setSaving,
    plantMediaType, plantFilterType,
    parsedBoosterTargets, boosterPsiMode, setBoosterPsiMode, boosterTargets, setBoosterTargets,
    plantWells, num, save,
    mediaType, filterHousingType, usingPlantMedia, usingPlantFilter,
    isManager,
  };
}
