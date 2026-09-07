import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useDraft } from '@/hooks/useDraft';

const CLOSE_INITIAL = {
  root_cause: '',
  corrective_action: '',
  preventive_measures: '',
};

export { CLOSE_INITIAL };

export function useIncidentsData() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const activePlant = plants?.find((p) => p.id === selectedPlantId) ?? plants?.[0];

  const { data: openIncidents = [] } = useQuery({
    queryKey: ['incidents-open-count', selectedPlantId],
    queryFn: async () => {
      let q = supabase.from('incidents').select('id,severity,status').in('status', ['Open', 'InProgress']);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: resolved30dCount = 0 } = useQuery({
    queryKey: ['incidents-resolved-30d', selectedPlantId],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      let q = supabase.from('incidents')
        .select('id', { count: 'exact', head: true })
        .in('status', ['Resolved', 'Closed'])
        .gte('created_at', since);
      if (selectedPlantId) q = q.eq('plant_id', selectedPlantId);
      const { count } = await q;
      return count ?? 0;
    },
  });

  const criticalHighCount = openIncidents.filter((i) => i.severity === 'Critical' || i.severity === 'High').length;

  return { selectedPlantId, activePlant, openIncidents, resolved30dCount, criticalHighCount, CLOSE_INITIAL };
}
