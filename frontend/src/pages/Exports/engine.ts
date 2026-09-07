import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { ExportTable } from './constants';

export async function runExport(
  table: ExportTable,
  plantId: string,
  from: string,
  to: string,
): Promise<{ count: number } | null> {
  let q = (supabase.from(table.id as any) as any).select('*').limit(50_000);
  if (plantId !== 'all' && !table.noPlantFilter) {
    q = q.eq('plant_id', plantId);
  }
  if (table.dateCol) {
    q = q.gte(table.dateCol, from).lte(table.dateCol, `${to}T23:59:59`);
  }
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) return null;
  downloadCSV(`${table.id}_${from}_to_${to}.csv`, data);
  return { count: data.length };
}
