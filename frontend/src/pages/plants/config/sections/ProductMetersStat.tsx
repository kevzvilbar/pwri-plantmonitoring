import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';
import { lastReadingFreshness, STALE_READING_HOURS } from '@/lib/format';

export function ProductMetersStat({ plantId }: { plantId: string }) {
  const { data: meters } = useQuery({
    queryKey: ['product-meters-stat', plantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_meters' as any).select('id, status').eq('plant_id', plantId);
      if (error?.message?.includes('status')) {
        const { data: fallback } = await supabase
          .from('product_meters' as any).select('id').eq('plant_id', plantId);
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }
      return (data ?? []) as any[];
    },
  });

  const { data: latest } = useQuery({
    queryKey: ['product-meters-stat-latest', plantId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('product_meter_readings_latest' as any) as any)
        .select('meter_id, reading_datetime')
        .eq('plant_id', plantId);
      if (error) throw error;
      return (data ?? []) as { meter_id: string; reading_datetime: string }[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const freshSet = useMemo(() => {
    const cutoff = Date.now() - STALE_READING_HOURS * 60 * 60 * 1000;
    return new Set(
      (latest ?? [])
        .filter((r) => new Date(r.reading_datetime).getTime() >= cutoff)
        .map((r) => r.meter_id),
    );
  }, [latest]);

  const total = meters?.length ?? 0;
  const active = (meters ?? []).filter((m: any) => (m.status ?? 'Active') === 'Active' && freshSet.has(m.id)).length;
  return (
    <div>
      <div className="font-mono-num text-lg font-bold">
        <span className={active === total && total > 0 ? 'text-accent' : active > 0 ? 'text-accent' : 'opacity-70'}>{active}</span>
        <span className="opacity-40 font-normal text-base">/{total}</span>
      </div>
      <div className="opacity-40 text-2xs mt-0.5">active / total</div>
    </div>
  );
}
