import { supabase } from '@/integrations/supabase/client';
import { resyncWellChain } from '@/data/queries/readingHistory';

/**
 * Deletes a well meter replacement record and restores meter state:
 * 1. Cleans up or unflags any linked reading in `well_readings`.
 * 2. Deletes the replacement record from `well_meter_replacements`.
 * 3. Reverts the active meter attributes on the `wells` table to the
 *    prior remaining replacement (or original serial).
 * 4. Re-synchronizes the well readings chain so deltas and volumes recalculate.
 */
export async function deleteWellMeterReplacement(params: {
  replacementId: string;
  wellId: string;
  plantId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { replacementId, wellId } = params;

    // 1. Fetch the replacement being deleted
    const { data: repl, error: fetchErr } = await (supabase.from('well_meter_replacements' as any) as any)
      .select('*')
      .eq('id', replacementId)
      .single();

    if (fetchErr || !repl) {
      return { success: false, error: fetchErr?.message ?? 'Replacement record not found' };
    }

    // 2. Clean up or unflag linked reading if present
    if (repl.reading_id) {
      const { data: reading } = await supabase
        .from('well_readings')
        .select('id, is_meter_replacement')
        .eq('id', repl.reading_id)
        .maybeSingle();

      if (reading) {
        // Unflag the replacement reading
        await supabase
          .from('well_readings')
          .update({ is_meter_replacement: false })
          .eq('id', reading.id);
      }
    }

    // 3. Delete the replacement record
    const { error: delErr } = await (supabase.from('well_meter_replacements' as any) as any)
      .delete()
      .eq('id', replacementId);

    if (delErr) {
      return { success: false, error: delErr.message };
    }

    // 4. Revert well current meter fields to previous replacement (if any) or old serial
    const { data: remaining } = await (supabase.from('well_meter_replacements' as any) as any)
      .select('*')
      .eq('well_id', wellId)
      .order('replacement_date', { ascending: false })
      .limit(1);

    const latestRemaining = remaining?.[0];
    if (latestRemaining) {
      await supabase.from('wells').update({
        meter_serial: latestRemaining.new_serial,
        meter_brand: latestRemaining.new_brand,
        meter_size: latestRemaining.new_size,
        meter_installed_date: latestRemaining.new_installed_date,
      }).eq('id', wellId);
    } else if (repl.old_serial) {
      await supabase.from('wells').update({
        meter_serial: repl.old_serial,
      }).eq('id', wellId);
    }

    // 5. Renormalize the well reading chain so deltas recompute cleanly
    await resyncWellChain(wellId);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
