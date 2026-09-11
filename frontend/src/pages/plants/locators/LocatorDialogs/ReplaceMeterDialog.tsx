import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

export function ReplaceMeterDialog({
  kind, assetId, plantId, oldSerial, readingId, onSuccess, onClose,
}: {
  kind: 'locator' | 'well' | 'product';
  assetId: string;
  plantId: string;
  oldSerial: string | null;
  /** When passed, this specific reading is flagged is_meter_replacement = true
   *  once the replacement record + asset update succeed — lets the row that
   *  triggered "Replace meter" be marked without a separate manual toggle. */
  readingId?: string;
  /** Called after a successful save. Receives the entered new-meter initial
   *  reading (so a live entry form can prefill its input) and the id of the
   *  replacement record just inserted (so the entry form can link it back to
   *  the actual reading once that reading is saved). Callers that don't need
   *  either value can keep using a plain `() => {...}` — TS allows passing a
   *  handler with fewer params than the declared callback type. */
  onSuccess?: (info?: { newInitialReading: number | null; replacementId: string | null }) => void;
  onClose: () => void;
}) {
  const { user, activeOperator } = useAuth();
  const [form, setForm] = useState({
    replacement_date: format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: '', new_brand: '', new_size: '', new_serial: '', new_initial_reading: '', new_installed_date: format(new Date(), 'yyyy-MM-dd'), remarks: '',
  });
  const submit = async () => {
    // Required: new serial (who's now installed), the old meter's last reading,
    // the new meter's starting reading, and the date it happened — without
    // these the replacement record can't actually zero the delta correctly or
    // tell anyone later what the swap was.
    if (!form.new_serial) { toast.error('New serial required'); return; }
    if (!form.old_final_reading) { toast.error("Old meter's final reading is required"); return; }
    if (!form.new_initial_reading) { toast.error("New meter's initial reading is required"); return; }
    if (!form.replacement_date) { toast.error('Date changed is required'); return; }
    const payload: any = {
      plant_id: plantId, replacement_date: form.replacement_date,
      reading_id: readingId ?? null,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    let replacementTable: 'locator_meter_replacements' | 'well_meter_replacements' | 'product_meter_replacements';
    let assetTable: 'locators' | 'wells' | 'product_meters';
    if (kind === 'locator' || kind === 'product') {
      Object.assign(payload, {
        [kind === 'locator' ? 'locator_id' : 'meter_id']: assetId,
        old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
        new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_meter_installed_date: form.new_installed_date,
      });
      replacementTable = kind === 'locator' ? 'locator_meter_replacements' : 'product_meter_replacements';
      assetTable = kind === 'locator' ? 'locators' : 'product_meters';
    } else {
      Object.assign(payload, {
        well_id: assetId, old_serial: oldSerial, old_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_brand: form.new_brand, new_size: form.new_size, new_serial: form.new_serial,
        new_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_installed_date: form.new_installed_date,
      });
      replacementTable = 'well_meter_replacements';
      assetTable = 'wells';
    }
    const { data: inserted, error } = await supabase.from(replacementTable as any).insert(payload).select('id').single();
    if (error) { toast.error(friendlyError(error)); return; }

    if (assetTable === 'product_meters') {
      await supabase.from(assetTable as any).update({ meter_serial: form.new_serial || null }).eq('id', assetId);
    } else {
      await supabase.from(assetTable as any).update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);
    }

    // For wells and locators: insert two reading rows that correctly represent
    // the meter swap in the reading chain.
    //
    //  Row 1 — old meter's FINAL reading  (is_meter_replacement = false)
    //  Row 2 — new meter's INITIAL reading (is_meter_replacement = true)
    //
    // Both are timestamped to the replacement date: old at 00:00, new at 00:01
    // so the ascending sort order is: old-final → new-initial → next normal readings.
    // Downstream delta computation (buildEntityPivot / StandardRow) sees the REPL row
    // as the correct baseline and computes subsequent deltas from the new meter's chain.
    //
    // The original readingId row (if any) is left untouched — it is a normal reading
    // recorded before/after the swap and its delta will now correctly use the new
    // meter's initial as its predecessor.
    if (kind === 'well' || kind === 'locator') {
      const readingTable = kind === 'well' ? 'well_readings' : 'locator_readings';
      const entityField = kind === 'well' ? 'well_id' : 'locator_id';
      const actorId = activeOperator?.id ?? user?.id ?? null;
      const dtOldFinal   = `${form.replacement_date}T00:00:00`;
      const dtNewInitial = `${form.replacement_date}T00:01:00`;

      // Row 1: old meter final (normal row, not a replacement)
      const { error: oldErr } = await (supabase.from(readingTable as any) as any).insert({
        [entityField]: assetId,
        plant_id: plantId,
        current_reading: +form.old_final_reading,
        reading_datetime: dtOldFinal,
        is_meter_replacement: false,
        recorded_by: actorId,
      });
      if (oldErr) toast.error(`Meter replaced, but couldn't insert old-meter reading: ${friendlyError(oldErr)}`);

      // Row 2: new meter initial (REPL row — zeroes the delta for that entry,
      // seeds lastSeen for all subsequent readings)
      const { error: newErr } = await (supabase.from(readingTable as any) as any).insert({
        [entityField]: assetId,
        plant_id: plantId,
        current_reading: +form.new_initial_reading,
        reading_datetime: dtNewInitial,
        is_meter_replacement: true,
        recorded_by: actorId,
      });
      if (newErr) toast.error(`Meter replaced, but couldn't insert new-meter reading: ${friendlyError(newErr)}`);
    }

    toast.success('Meter replaced');
    onSuccess?.({
      newInitialReading: form.new_initial_reading ? +form.new_initial_reading : null,
      replacementId: (inserted as any)?.id ?? null,
    });
    onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace meter</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-date-changed">Date changed *</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} id="locatordialogs-date-changed"/></div>
            <div><Label htmlFor="locatordialogs-old-meter-s-final-reading">Old meter's final reading *</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} id="locatordialogs-old-meter-s-final-reading"/></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="locatordialogs-new-brand">New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} id="locatordialogs-new-brand"/></div>
            <div><Label htmlFor="locatordialogs-new-size">New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} id="locatordialogs-new-size"/></div>
            <div><Label htmlFor="locatordialogs-new-serial">New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} id="locatordialogs-new-serial"/></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-new-meter-s-initial-reading">New meter's initial reading *</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} id="locatordialogs-new-meter-s-initial-reading"/></div>
            <div><Label htmlFor="locatordialogs-installed-date">Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} id="locatordialogs-installed-date"/></div>
          </div>
          <div><Label htmlFor="locatordialogs-remarks">Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} id="locatordialogs-remarks"/></div>
        </div>
        <DialogFooter><Button onClick={submit}>Save replacement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
