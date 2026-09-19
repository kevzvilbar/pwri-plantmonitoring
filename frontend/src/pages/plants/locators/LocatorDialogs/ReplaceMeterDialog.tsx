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
import { resyncLocatorChain, resyncWellChain, resyncProductMeterChain } from '@/data/queries/readingHistory';

const readingTableFor = (k: 'locator' | 'well' | 'product') =>
  k === 'well' ? 'well_readings' : k === 'locator' ? 'locator_readings' : 'product_meter_readings';

/** Find a reading row for this asset at `dtIso` (±1 min clock-skew window) and
 *  turn it into the flagged new-meter-initial row; insert one if none exists.
 *  Returns the row id, or null when the write failed (already toasted). */
const upsertReplRow = async (
  readingTable: string, entityField: string, assetId: string, plantId: string,
  dtIso: string, newInitial: number, actorId: string | null,
): Promise<string | null> => {
  const winFrom = new Date(new Date(dtIso).getTime() - 60_000).toISOString();
  const winTo = new Date(new Date(dtIso).getTime() + 60_000).toISOString();
  const { data: existing } = await (supabase.from(readingTable as any) as any)
    .select('id')
    .eq(entityField as string, assetId)
    .gte('reading_datetime', winFrom)
    .lte('reading_datetime', winTo)
    .order('reading_datetime', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    const { error: repErr } = await (supabase.from(readingTable as any) as any)
      .update({ current_reading: newInitial, reading_datetime: dtIso, is_meter_replacement: true, daily_volume: 0 })
      .eq('id', existing.id);
    if (repErr) { toast.error(`Couldn't flag the installed reading: ${friendlyError(repErr)}`); return null; }
    return existing.id;
  }
  const { data: insertedRow, error: insErr } = await (supabase.from(readingTable as any) as any)
    .insert({
      [entityField]: assetId,
      plant_id: plantId,
      current_reading: newInitial,
      reading_datetime: dtIso,
      is_meter_replacement: true,
      daily_volume: 0,
      recorded_by: actorId,
    })
    .select('id')
    .single();
  if (insErr) { toast.error(`Couldn't insert the new-meter reading: ${friendlyError(insErr)}`); return null; }
  return (insertedRow as any)?.id ?? null;
};

export function ReplaceMeterDialog({
  kind, assetId, plantId, oldSerial, readingId, initial, onSuccess, onClose,
}: {
  kind: 'locator' | 'well' | 'product';
  assetId: string;
  plantId: string;
  oldSerial: string | null;
  readingId?: string;
  /** Edit mode: prefill from an already-logged swap; save becomes an UPDATE
   *  of that record (+ linked reading sync) instead of an INSERT. */
  initial?: {
    id: string; readingId?: string | null; replacementDate: string | null; oldFinal: string;
    newBrand: string; newSize: string; newSerial: string; newInitial: string;
    installedDate: string | null; remarks: string; rawOldSerial?: string | null;
  } | null;
  /** When passed, this specific reading is flagged is_meter_replacement = true
   *  once the replacement record + asset update succeed — lets the row that
   *  triggered "Replace meter" be marked without a separate manual toggle. */
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
  const isEdit = !!initial?.id;
  // The record's original old serial in edit mode — the `oldSerial` prop is the
  // asset's CURRENT serial and would clobber history if written back on edit.
  const effectiveOldSerial = isEdit ? (initial?.rawOldSerial ?? oldSerial) : oldSerial;
  const [form, setForm] = useState(() => ({
    replacement_date: initial?.replacementDate || format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    old_final_reading: initial?.oldFinal ?? '',
    new_brand: initial?.newBrand ?? '', new_size: initial?.newSize ?? '',
    new_serial: initial?.newSerial ?? '', new_initial_reading: initial?.newInitial ?? '',
    new_installed_date: initial?.installedDate || format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    remarks: initial?.remarks ?? '',
  }));
  const submit = async () => {
    // Required: new serial (who's now installed), the old meter's last reading,
    // the new meter's starting reading, and the date it happened — without
    // these the replacement record can't actually zero the delta correctly or
    // tell anyone later what the swap was.
    if (!form.new_serial) { toast.error('New serial required'); return; }
    if (form.old_final_reading === '' || form.old_final_reading == null) { toast.error("Old meter's final reading is required"); return; }
    if (form.new_initial_reading === '' || form.new_initial_reading == null) { toast.error("New meter's initial reading is required"); return; }
    if (!form.replacement_date) { toast.error('Date & time changed is required'); return; }

    // ── Normalization rule: the two swap timestamps must be at least 1 minute
    // apart — equal/closer times would collapse into one ambiguous row in
    // history. Auto-correct instead of blocking: installed = changed + 1 min.
    let installedLocal = form.new_installed_date || form.replacement_date;
    const changedMs = new Date(form.replacement_date).getTime();
    if (new Date(installedLocal).getTime() < changedMs + 60_000) {
      installedLocal = format(new Date(changedMs + 60_000), "yyyy-MM-dd'T'HH:mm");
      toast.info('Installed time adjusted — it must be at least 1 minute after the date & time changed');
    }

    // Convert local datetime inputs to proper ISO timestamps with timezone
    // so the exact local time (e.g. 08:58 AM / 09:00 AM) is preserved and
    // does not get shifted by UTC offsets.
    const dtOldFinal = new Date(form.replacement_date).toISOString();
    const dtNewInitial = new Date(installedLocal).toISOString();

    const replDateOnly = form.replacement_date ? form.replacement_date.slice(0, 10) : '';
    const instDateOnly = installedLocal.slice(0, 10);

    const payload: any = {
      plant_id: plantId, replacement_date: replDateOnly,
      reading_id: readingId ?? null,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    let replacementTable: 'locator_meter_replacements' | 'well_meter_replacements' | 'product_meter_replacements';
    let assetTable: 'locators' | 'wells' | 'product_meters';
    if (kind === 'locator' || kind === 'product') {
      Object.assign(payload, {
        [kind === 'locator' ? 'locator_id' : 'meter_id']: assetId,
        old_meter_serial: effectiveOldSerial, old_meter_final_reading: form.old_final_reading !== '' ? +form.old_final_reading : null,
        new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
        new_meter_initial_reading: form.new_initial_reading !== '' ? +form.new_initial_reading : null,
        new_meter_installed_date: instDateOnly,
      });
      replacementTable = kind === 'locator' ? 'locator_meter_replacements' : 'product_meter_replacements';
      assetTable = kind === 'locator' ? 'locators' : 'product_meters';
    } else {
      Object.assign(payload, {
        well_id: assetId, old_serial: effectiveOldSerial, old_final_reading: form.old_final_reading !== '' ? +form.old_final_reading : null,
        new_brand: form.new_brand, new_size: form.new_size, new_serial: form.new_serial,
        new_initial_reading: form.new_initial_reading !== '' ? +form.new_initial_reading : null,
        new_installed_date: instDateOnly,
      });
      replacementTable = 'well_meter_replacements';
      assetTable = 'wells';
    }
    if (isEdit) {
      const editPayload = { ...payload };
      delete (editPayload as any).plant_id;
      delete (editPayload as any).reading_id;
      delete (editPayload as any).replaced_by;
      const { error: updErr } = await (supabase.from(replacementTable as any) as any)
        .update(editPayload)
        .eq('id', initial!.id);
      if (updErr) { toast.error(friendlyError(updErr)); return; }

      const readingTable = readingTableFor(kind);
      const entityField = kind === 'well' ? 'well_id' : kind === 'locator' ? 'locator_id' : 'meter_id';
      const actorId = user?.id ?? activeOperator?.id ?? null;

      // Pre-edit fingerprints of the synthetic rows this record created — used
      // to find them again (and to tell the synthetic REPL row apart from a
      // real operator reading that merely got flagged).
      const prevChangedLocal = initial!.replacementDate ?? '';
      const prevInstalledLocal = initial!.installedDate ?? '';
      const prevNewInitial = initial!.newInitial !== '' && initial!.newInitial != null ? +initial!.newInitial : null;
      const prevOldFinal = initial!.oldFinal !== '' && initial!.oldFinal != null ? +initial!.oldFinal : null;
      const sameInstant = (a: string, b: string) => {
        const ta = new Date(a).getTime(); const tb = new Date(b).getTime();
        return !isNaN(ta) && !isNaN(tb) && Math.abs(ta - tb) < 60_000;
      };

      const linkedId = readingId ?? initial!.readingId ?? null;

      // ── Step 1: restore a wrongly-flagged real reading ──────────────────
      // If the linked row is NOT the synthetic new-initial row (its value or
      // datetime doesn't match the pre-edit swap), unflag it and keep its
      // value/datetime untouched — it was a real reading that just carried the
      // flag, and history must not lose it.
      let linkedIsSynthetic = false;
      if (linkedId && prevNewInitial != null) {
        const { data: linkedRow } = await (supabase.from(readingTable as any) as any)
          .select('id, current_reading, reading_datetime')
          .eq('id', linkedId)
          .maybeSingle();
        if (linkedRow) {
          const sameVal = linkedRow.current_reading != null
            && Math.abs(+linkedRow.current_reading - prevNewInitial) < 1e-6;
          linkedIsSynthetic = !!(sameVal && prevInstalledLocal && sameInstant(String(linkedRow.reading_datetime), prevInstalledLocal));
          if (!linkedIsSynthetic) {
            const { error: unflagErr } = await (supabase.from(readingTable as any) as any)
              .update({ is_meter_replacement: false })
              .eq('id', linkedId);
            if (unflagErr) toast.error(`Couldn't restore the previously flagged reading: ${friendlyError(unflagErr)}`);
          }
        }
      }

      // ── Step 2: upsert the new meter's initial reading row (the true REPL row)
      let replRowId: string | null = null;
      if (linkedId && linkedIsSynthetic) {
        const { error: linkErr } = await (supabase.from(readingTable as any) as any)
          .update({
            current_reading: +form.new_initial_reading,
            reading_datetime: dtNewInitial,
            is_meter_replacement: true,
            daily_volume: 0,
          })
          .eq('id', linkedId);
        if (linkErr) toast.error(`Replacement updated, but couldn't sync the reading: ${friendlyError(linkErr)}`);
        else replRowId = linkedId;
      } else {
        replRowId = await upsertReplRow(readingTable, entityField, assetId, plantId, dtNewInitial, +form.new_initial_reading, actorId);
      }

      // Keep the replacement record pointing at the row that carries the flag.
      if (replRowId && replRowId !== (initial!.readingId ?? null)) {
        await (supabase.from(replacementTable as any) as any)
          .update({ reading_id: replRowId })
          .eq('id', initial!.id);
      }

      // ── Step 3: keep the old meter's final reading row in sync ──────────
      // Locate the synthetic old-final row created at save time (datetime
      // matching the PRE-edit change time, value = PRE-edit old final);
      // update it. Legacy records that never had one get a fresh row.
      {
        const baseLocal = prevChangedLocal || form.replacement_date;
        const prevOldIso = new Date(baseLocal).toISOString();
        const winFrom = new Date(new Date(prevOldIso).getTime() - 60_000).toISOString();
        const winTo = new Date(new Date(prevOldIso).getTime() + 60_000).toISOString();
        let q = (supabase.from(readingTable as any) as any)
          .select('id')
          .eq(entityField as string, assetId)
          .gte('reading_datetime', winFrom)
          .lte('reading_datetime', winTo)
          .order('reading_datetime', { ascending: true })
          .limit(1);
        if (prevOldFinal != null) q = q.eq('current_reading', prevOldFinal);
        const { data: prevOldRow } = await q.maybeSingle();
        if (prevOldRow?.id && prevOldRow.id !== replRowId) {
          await (supabase.from(readingTable as any) as any)
            .update({ current_reading: +form.old_final_reading, reading_datetime: dtOldFinal })
            .eq('id', prevOldRow.id);
        } else if (!prevOldRow?.id) {
          await (supabase.from(readingTable as any) as any).insert({
            [entityField]: assetId,
            plant_id: plantId,
            current_reading: +form.old_final_reading,
            reading_datetime: dtOldFinal,
            is_meter_replacement: false,
            recorded_by: actorId,
          });
        }
      }

      // Keep the asset's current-meter identity in sync with the edit too.
      if (assetTable === 'product_meters') {
        await supabase.from(assetTable as any).update({ meter_serial: form.new_serial || null }).eq('id', assetId);
      } else {
        await supabase.from(assetTable as any).update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: instDateOnly }).eq('id', assetId);
      }

      // ── Step 4: renormalize the chain so downstream rows' Δ recomputes ──
      if (kind === 'well') await resyncWellChain(assetId);
      else if (kind === 'locator') await resyncLocatorChain(assetId);
      else await resyncProductMeterChain(assetId);

      toast.success('Replacement updated');
      onSuccess?.({ newInitialReading: form.new_initial_reading !== '' ? +form.new_initial_reading : null, replacementId: initial!.id });
      onClose();
      return;
    }
    const { data: inserted, error } = await supabase.from(replacementTable as any).insert(payload).select('id').single();
    if (error) { toast.error(friendlyError(error)); return; }

    if (assetTable === 'product_meters') {
      await supabase.from(assetTable as any).update({ meter_serial: form.new_serial || null }).eq('id', assetId);
    } else {
      await supabase.from(assetTable as any).update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: instDateOnly }).eq('id', assetId);
    }

    const readingTable = kind === 'well' ? 'well_readings' : kind === 'locator' ? 'locator_readings' : 'product_meter_readings';
    const entityField = kind === 'well' ? 'well_id' : kind === 'locator' ? 'locator_id' : 'meter_id';
    const actorId = user?.id ?? activeOperator?.id ?? null;

    if (readingId) {
        // The user clicked the Repl. checkbox on a specific row (`readingId`):
        // 1. Update that row to become the new meter's initial reading row:
        //    - current_reading = new initial reading (e.g. 0.00)
        //    - reading_datetime = installed datetime (e.g. 09:00 AM)
        //    - is_meter_replacement = true (checkbox checked [✓], repl. tag shown, Δ = 0.00)
        //    - daily_volume = 0
        const { error: updateErr } = await (supabase.from(readingTable as any) as any)
          .update({
            current_reading: +form.new_initial_reading,
            reading_datetime: dtNewInitial,
            is_meter_replacement: true,
            daily_volume: 0,
          })
          .eq('id', readingId);
        if (updateErr) toast.error(`Meter replaced, but couldn't update replacement reading: ${friendlyError(updateErr)}`);

        // 2. Insert the old meter's final reading row:
        //    - current_reading = old final reading (e.g. 5331.00)
        //    - reading_datetime = date & time changed (e.g. 08:58 AM)
        //    - is_meter_replacement = false
        const { error: oldErr } = await (supabase.from(readingTable as any) as any).insert({
          [entityField]: assetId,
          plant_id: plantId,
          current_reading: +form.old_final_reading,
          reading_datetime: dtOldFinal,
          is_meter_replacement: false,
          recorded_by: actorId,
        });
        if (oldErr) toast.error(`Meter replaced, but couldn't insert old-meter reading: ${friendlyError(oldErr)}`);
      } else {
        // No specific row targeted: insert both rows fresh into the readings table
        // Row 1: old meter final
        const { error: oldErr } = await (supabase.from(readingTable as any) as any).insert({
          [entityField]: assetId,
          plant_id: plantId,
          current_reading: +form.old_final_reading,
          reading_datetime: dtOldFinal,
          is_meter_replacement: false,
          recorded_by: actorId,
        });
        if (oldErr) toast.error(`Meter replaced, but couldn't insert old-meter reading: ${friendlyError(oldErr)}`);

        // Row 2: new meter initial (REPL row)
        const { error: newErr } = await (supabase.from(readingTable as any) as any).insert({
          [entityField]: assetId,
          plant_id: plantId,
          current_reading: +form.new_initial_reading,
          reading_datetime: dtNewInitial,
          is_meter_replacement: true,
          daily_volume: 0,
          recorded_by: actorId,
        });
        if (newErr) toast.error(`Meter replaced, but couldn't insert new-meter reading: ${friendlyError(newErr)}`);
    }

    // Renormalize the chain so downstream rows' Δ/daily_volume recompute
    // against the new baseline instead of the old meter's final reading.
    if (kind === 'well') await resyncWellChain(assetId);
    else if (kind === 'locator') await resyncLocatorChain(assetId);
    else await resyncProductMeterChain(assetId);

    toast.success('Meter replaced');
    onSuccess?.({
      newInitialReading: form.new_initial_reading !== '' ? +form.new_initial_reading : null,
      replacementId: (inserted as any)?.id ?? null,
    });
    onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit meter replacement' : 'Replace meter'}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-date-changed">Date &amp; time changed *</Label><Input type="datetime-local" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} id="locatordialogs-date-changed"/></div>
            <div><Label htmlFor="locatordialogs-old-meter-s-final-reading">Old meter's final reading *</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} id="locatordialogs-old-meter-s-final-reading"/></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{effectiveOldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="locatordialogs-new-brand">New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} id="locatordialogs-new-brand"/></div>
            <div><Label htmlFor="locatordialogs-new-size">New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} id="locatordialogs-new-size"/></div>
            <div><Label htmlFor="locatordialogs-new-serial">New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} id="locatordialogs-new-serial"/></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-new-meter-s-initial-reading">New meter's initial reading *</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} id="locatordialogs-new-meter-s-initial-reading"/></div>
            <div><Label htmlFor="locatordialogs-installed-date">Installed date &amp; time</Label><Input type="datetime-local" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} id="locatordialogs-installed-date"/><p className="text-3xs text-muted-foreground mt-0.5">Must be at least 1 minute after Date &amp; time changed</p></div>
          </div>
          <div><Label htmlFor="locatordialogs-remarks">Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} id="locatordialogs-remarks"/></div>
        </div>
        <DialogFooter><Button onClick={submit}>{isEdit ? 'Save changes' : 'Save replacement'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
