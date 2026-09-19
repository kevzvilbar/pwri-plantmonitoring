import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { logPlantEdit } from '../shared';

type PlantTab = 'locators' | 'wells' | 'product' | 'trains' | 'power' | 'configuration';
const VALID_PLANT_TABS = new Set<PlantTab>(['locators', 'wells', 'product', 'trains', 'power', 'configuration']);

export function usePlantDetail(plantId: string) {
  const navigate = useNavigate();
  const { data: plants } = usePlants();
  const { isManager, user } = useAuth();
  const qc = useQueryClient();
  const plant = plants?.find((p: any) => p.id === plantId);

  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as PlantTab | null;
  const [tab, setTabState] = useState<PlantTab>(urlTab && VALID_PLANT_TABS.has(urlTab) ? urlTab : 'locators');
  useEffect(() => {
    if (urlTab && VALID_PLANT_TABS.has(urlTab) && urlTab !== tab) setTabState(urlTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);
  const setTab = (next: PlantTab) => {
    setTabState(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    sp.delete('highlight');
    setSearchParams(sp, { replace: true });
  };
  const highlightId = searchParams.get('highlight');

  const [editingInfo, setEditingInfo] = useState(false);
  const [infoSaving, setInfoSaving] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: '', address: '', capacity: '' });

  const { data: trainCounts } = useQuery({
    queryKey: ['ro-trains-count', plantId],
    queryFn: async () => {
      const ONE_HOUR_MS = 60 * 60 * 1000;
      const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS).toISOString();
      const { data: trains } = await supabase
        .from('ro_trains')
        .select('id, status')
        .eq('plant_id', plantId);
      const total = (trains as any[])?.length ?? 0;
      if (!total) return { active: 0, total: 0 };
      const trainIds = (trains as any[]).map((t: any) => t.id);
      const { data: recentReadings } = await supabase
        .from('ro_train_readings')
        .select('train_id')
        .in('train_id', trainIds)
        .gte('reading_datetime', oneHourAgo);
      const recentSet = new Set((recentReadings ?? []).map((r: any) => r.train_id));
      const active = (trains as any[]).filter((t: any) =>
        t.status !== 'Maintenance' && recentSet.has(t.id)
      ).length;
      return { active, total };
    },
  });

  const openInfoEdit = () => {
    if (!plant) return;
    setInfoForm({
      name: plant.name ?? '',
      address: plant.address ?? '',
      capacity: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : '',
    });
    setEditingInfo(true);
  };

  const saveInfo = async () => {
    if (!plant) return;
    setInfoSaving(true);
    const payload: Record<string, any> = {};
    const changes: { field: string; old: string | null; next: string | null }[] = [];

    if (infoForm.name.trim() !== (plant.name ?? '')) {
      changes.push({ field: 'name', old: plant.name ?? null, next: infoForm.name.trim() || null });
      payload.name = infoForm.name.trim() || null;
    }
    if (infoForm.address.trim() !== (plant.address ?? '')) {
      changes.push({ field: 'address', old: plant.address ?? null, next: infoForm.address.trim() || null });
      payload.address = infoForm.address.trim() || null;
    }
    const newCap = infoForm.capacity ? parseFloat(infoForm.capacity) : null;
    if (newCap !== (plant.design_capacity_m3 ?? null)) {
      changes.push({
        field: 'design_capacity_m3',
        old: plant.design_capacity_m3 != null ? String(plant.design_capacity_m3) : null,
        next: newCap != null ? String(newCap) : null,
      });
      payload.design_capacity_m3 = newCap;
    }

    if (!Object.keys(payload).length) {
      setEditingInfo(false);
      setInfoSaving(false);
      return;
    }

    const { error } = await supabase.from('plants').update(payload as any).eq('id', plant.id);
    setInfoSaving(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }

    const now = new Date().toISOString();
    await Promise.all(
      changes.map((c) =>
        logPlantEdit({
          plant_id: plant.id,
          user_id: user?.id ?? null,
          field_changed: c.field,
          old_value: c.old,
          new_value: c.next,
          timestamp: now,
        }),
      ),
    );

    toast.success('Plant details updated');
    setEditingInfo(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
    qc.invalidateQueries({ queryKey: ['ro-trains-count', plantId] });
  };

  return {
    plant,
    trainCounts,
    tab,
    setTab,
    highlightId,
    editingInfo,
    setEditingInfo,
    infoSaving,
    infoForm,
    setInfoForm,
    openInfoEdit,
    saveInfo,
    isManager,
  };
}
