/**
 * ro-trains/ReplaceTrainMeterDialog.tsx
 *
 * RO trains have three independent flow meters (Feed / Permeate / Reject)
 * sharing a single "Repl." column in the operator log — unlike Wells,
 * Locators, and Product Meters, which each have exactly one meter. Rather
 * than splitting "Repl." into three separate toggle buttons (bigger layout
 * risk across TrainLogModal.tsx and TrainDetail.tsx's already-dense tables),
 * this dialog asks "which meter was replaced?" as its first field, then
 * proceeds like the well/locator/product ReplaceMeterDialog
 * (@/pages/plants/locators/LocatorDialogs).
 *
 * Checking the Repl. box opens this dialog. Unchecking still clears all
 * three granular flags directly at the call site (nothing to log for that).
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { recalculateTrainDeltas } from './helpers';

export type TrainMeterType = 'feed' | 'permeate' | 'reject';

const METER_LABELS: Record<TrainMeterType, string> = {
  feed: 'Feed', permeate: 'Permeate', reject: 'Reject',
};

export function ReplaceTrainMeterDialog({
  trainId, plantId, readingId, defaultMeterType, initial, onClose, onSuccess,
}: {
  trainId: string;
  plantId: string;
  /** When set, this specific reading is flagged is_{type}_meter_replacement =
   *  true (is_meter_replacement stays in sync via a DB trigger) once the
   *  replacement record + ro_trains identity update succeed. */
  readingId?: string;
  /** Pre-select a meter type — e.g. when opened from a per-meter "Replace"
   *  button in TrainsList.tsx rather than the shared operator-log toggle. */
  defaultMeterType?: TrainMeterType;
  /** Edit mode: update this ro_train_meter_replacements row instead of insert. */
  initial?: {
    id: string; readingId?: string | null; replacementDate: string | null; oldFinal: string;
    newBrand: string; newSize: string; newSerial: string; newInitial: string;
    installedDate: string | null; remarks: string; rawMeterType?: string | null;
    rawOldSerial?: string | null;
  } | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { user, activeOperator } = useAuth();
  const isEdit = !!initial?.id;
  const editMeterType = (initial?.rawMeterType ?? null) as TrainMeterType | null;
  const [meterType, setMeterType] = useState<TrainMeterType>(editMeterType ?? defaultMeterType ?? 'permeate');
  const [busy, setBusy] = useState(false);

  // Current per-meter identity, fetched live by trainId rather than threaded
  // as props — keeps every call site (TrainLogModal, TrainDetail, TrainsList)
  // to just trainId/plantId/readingId, no matter which meter ends up picked.
  const { data: train } = useQuery({
    queryKey: ['train-meter-identity', trainId],
    queryFn: async () => {
      const { data } = await supabase.from('ro_trains').select('*').eq('id', trainId).single();
      return data;
    },
  });

  const [form, setForm] = useState(() => ({
    replacement_date: initial?.replacementDate?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: initial?.oldFinal ?? '',
    new_brand: initial?.newBrand ?? '', new_size: initial?.newSize ?? '',
    new_serial: initial?.newSerial ?? '', new_initial_reading: initial?.newInitial ?? '',
    new_installed_date: initial?.installedDate?.slice(0, 10) || format(new Date(), 'yyyy-MM-dd'),
    remarks: initial?.remarks ?? '',
  }));

  const oldSerial: string | null = train
    ? ((train as Record<string, unknown>)[`${meterType}_meter_serial`] as string | null ?? null)
    : (initial?.rawOldSerial ?? null);

  const submit = async () => {
    if (!form.new_serial) { toast.error('New serial required'); return; }
    setBusy(true);
    const payload: Database['public']['Tables']['ro_train_meter_replacements']['Insert'] = {
      train_id: trainId, plant_id: plantId, reading_id: readingId ?? null,
      meter_type: meterType, replacement_date: form.replacement_date,
      old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
      new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
      new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
      new_meter_installed_date: form.new_installed_date,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    if (isEdit) {
      const { error: updErr } = await supabase.from('ro_train_meter_replacements')
        .update({
          replacement_date: form.replacement_date,
          old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
          new_meter_brand: form.new_brand, new_meter_size: form.new_size,
          new_meter_serial: form.new_serial,
          new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
          new_meter_installed_date: form.new_installed_date,
          remarks: form.remarks || null,
        })
        .eq('id', initial!.id);
      if (updErr) { setBusy(false); toast.error(friendlyError(updErr)); return; }
      await recalculateTrainDeltas(trainId);
      setBusy(false);
      toast.success(`${METER_LABELS[meterType]} replacement updated`);
      onSuccess?.();
      onClose();
      return;
    }
    const { error } = await supabase.from('ro_train_meter_replacements').insert(payload);
    if (error) { setBusy(false); toast.error(friendlyError(error)); return; }

    const trainUpdate: Database['public']['Tables']['ro_trains']['Update'] =
      meterType === 'feed'
        ? {
            feed_meter_brand: form.new_brand,
            feed_meter_size: form.new_size,
            feed_meter_serial: form.new_serial,
            feed_meter_installed_date: form.new_installed_date,
          }
        : meterType === 'permeate'
        ? {
            permeate_meter_brand: form.new_brand,
            permeate_meter_size: form.new_size,
            permeate_meter_serial: form.new_serial,
            permeate_meter_installed_date: form.new_installed_date,
          }
        : {
            reject_meter_brand: form.new_brand,
            reject_meter_size: form.new_size,
            reject_meter_serial: form.new_serial,
            reject_meter_installed_date: form.new_installed_date,
          };
    await supabase.from('ro_trains').update(trainUpdate).eq('id', trainId);

    if (readingId) {
      const readingUpdate: Database['public']['Tables']['ro_train_readings']['Update'] =
        meterType === 'feed'
          ? { is_feed_meter_replacement: true }
          : meterType === 'permeate'
          ? { is_permeate_meter_replacement: true }
          : { is_reject_meter_replacement: true };
      const { error: flagError } = await supabase
        .from('ro_train_readings')
        .update(readingUpdate)
        .eq('id', readingId);
      if (flagError) toast.error(`Meter replaced, but couldn't flag the reading: ${friendlyError(flagError)}`);
    }

    await recalculateTrainDeltas(trainId);
    setBusy(false);
    toast.success(`${METER_LABELS[meterType]} meter replaced`);
    onSuccess?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Train Meter Replacement' : 'Replace Train Meter'}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div>
            <Label htmlFor="replacetrainmeterdialog-which-meter-was-replaced">Which meter was replaced?</Label>
            <Select value={meterType} onValueChange={(v) => setMeterType(v as TrainMeterType)} disabled={isEdit}>
              <SelectTrigger className="h-9 text-sm" id="replacetrainmeterdialog-which-meter-was-replaced"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">Feed</SelectItem>
                <SelectItem value="permeate">Permeate</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-3xs text-muted-foreground mt-1">
                Meter locked while editing — delete and re-log to move this swap to a different meter.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="replacetrainmeterdialog-replacement-date">Replacement date</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} id="replacetrainmeterdialog-replacement-date"/></div>
            <div><Label htmlFor="replacetrainmeterdialog-old-final-reading">Old final reading</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} id="replacetrainmeterdialog-old-final-reading"/></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="replacetrainmeterdialog-new-brand">New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} id="replacetrainmeterdialog-new-brand"/></div>
            <div><Label htmlFor="replacetrainmeterdialog-new-size">New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} id="replacetrainmeterdialog-new-size"/></div>
            <div><Label htmlFor="replacetrainmeterdialog-new-serial">New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} id="replacetrainmeterdialog-new-serial"/></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="replacetrainmeterdialog-initial-reading">Initial reading</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} id="replacetrainmeterdialog-initial-reading"/></div>
            <div><Label htmlFor="replacetrainmeterdialog-installed-date">Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} id="replacetrainmeterdialog-installed-date"/></div>
          </div>
          <div><Label htmlFor="replacetrainmeterdialog-remarks">Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} id="replacetrainmeterdialog-remarks"/></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>{isEdit ? 'Save changes' : 'Save replacement'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
