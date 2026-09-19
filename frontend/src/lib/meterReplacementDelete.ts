import { supabase } from '@/integrations/supabase/client';

/**
 * Deletes a well meter replacement record and restores meter state:
 * 1. Cleans up or unflags any linked reading in `well_readings`.
 * 2. Deletes the replacement record from `well_meter_replacements`.
 * 3. Reverts the active meter attributes on the `wells` table to the
 *    prior remaining replacement (or original serial).
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

    // 2. Clean up synthetic reading if present
    if (repl.reading_id) {
      const { data: reading } = await supabase
        .from('well_readings')
        .select('id, is_meter_replacement, remarks')
        .eq('id', repl.reading_id)
        .maybeSingle();

      if (reading) {
        if (reading.remarks?.includes('[METER REPLACEMENT]')) {
          // Synthetic row created purely for replacement; safe to remove
          await supabase.from('well_readings').delete().eq('id', reading.id);
        } else {
          // Real reading that carried the flag; keep reading but unflag
          await supabase.from('well_readings').update({ is_meter_replacement: false }).eq('id', reading.id);
        }
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

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

