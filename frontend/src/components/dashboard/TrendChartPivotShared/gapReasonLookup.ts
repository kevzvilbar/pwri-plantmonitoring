import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const GAP_ENTITY_TYPE_LABEL: Record<string, string> = {
  well: 'Well', locator: 'Locator', ro_train: 'RO Train',
  meter: 'Product Meter', blending: 'Blending Well', power: 'Power',
};

export const GAP_ENTITY_TABLE: Record<string, string> = {
  well: 'wells', locator: 'locators', ro_train: 'ro_trains',
  meter: 'product_meters', blending: 'wells', power: 'plants',
};

export const GAP_DOWN_STATUSES = new Set(['Inactive', 'Offline', 'Maintenance', 'Locked']);

export type GapReasonHit = { category: string; detail: string | null; source: 'gap' | 'status' };

export function useGapReasonLookup(
  entityType: string | undefined,
  entities: { id: string; label: string }[],
  _dates: string[],
): {
  getReason: (entityId: string, dateKey: string) => GapReasonHit | null;
  refetchReasons: () => void;
} {
  const queryClient = useQueryClient();
  const entityIds = useMemo(() => entities.map((e) => e.id).sort(), [entities]);
  const entityIdsKey = entityIds.join(',');
  const gapReasonsQueryKey = ['pivot-gap-reasons', entityType, entityIdsKey];

  const { data: gapReasons } = useQuery({
    queryKey: gapReasonsQueryKey,
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_gap_reasons')
        .select('*')
        .eq('entity_type', entityType!)
        .in('entity_id', entityIds);
      if (error) return [];
      return data ?? [];
    },
  });

  const { data: statusLog } = useQuery({
    queryKey: ['pivot-status-log', entityType, entityIdsKey],
    enabled: !!entityType && entityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_status_audit_log')
        .select('*')
        .eq('entity_type', GAP_ENTITY_TYPE_LABEL[entityType!])
        .in('entity_id', entityIds)
        .order('timestamp', { ascending: true });
      if (error) return [];
      return data ?? [];
    },
  });

  const getReason = useMemo(() => {
    const gapMap = new Map<string, { reason_category: string; reason_detail: string | null }>();
    (gapReasons ?? []).forEach((g) => { gapMap.set(`${g.entity_id}|${g.gap_date}`, g); });

    type StatusRow = NonNullable<typeof statusLog>[number];
    const intervalsByEntity = new Map<string, Array<{ start: number; end: number; category: string | null; detail: string | null }>>();
    const rowsByEntity = new Map<string, StatusRow[]>();
    (statusLog ?? []).forEach((row) => {
      if (!rowsByEntity.has(row.entity_id)) rowsByEntity.set(row.entity_id, []);
      rowsByEntity.get(row.entity_id)!.push(row);
    });
    rowsByEntity.forEach((rows, entityId) => {
      if (!rows) return;
      const intervals: Array<{ start: number; end: number; category: string | null; detail: string | null }> = [];
      rows.forEach((row, i) => {
        if (!GAP_DOWN_STATUSES.has(row.to_status)) return;
        const start = new Date(row.timestamp).getTime();
        const next = rows[i + 1];
        const end = next ? new Date(next.timestamp).getTime() : Date.now();
        intervals.push({ start, end, category: row.reason_category ?? null, detail: row.reason_detail ?? null });
      });
      intervalsByEntity.set(entityId, intervals);
    });

    return (entityId: string, dateKey: string): GapReasonHit | null => {
      const gap = gapMap.get(`${entityId}|${dateKey}`);
      if (gap) return { category: gap.reason_category, detail: gap.reason_detail ?? null, source: 'gap' };

      const intervals = intervalsByEntity.get(entityId);
      if (intervals && intervals.length) {
        const dayStart = new Date(dateKey + 'T00:00:00').getTime();
        const dayEnd   = new Date(dateKey + 'T23:59:59').getTime();
        const hit = intervals.find((iv) => iv.start <= dayEnd && iv.end >= dayStart);
        if (hit && hit.category) return { category: hit.category, detail: hit.detail, source: 'status' };
      }
      return null;
    };
  }, [gapReasons, statusLog]);

  const refetchReasons = () => {
    queryClient.invalidateQueries({ queryKey: gapReasonsQueryKey });
  };

  return { getReason, refetchReasons };
}
