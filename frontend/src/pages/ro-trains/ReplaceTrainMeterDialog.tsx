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
  trainId, plantId, readingId, defaultMeterType, onClose, onSuccess,
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
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { user, activeOperator } = useAuth();
  const [meterType, setMeterType] = useState<TrainMeterType>(defaultMeterType ?? 'permeate');
  const [busy, setBusy] = useState(false);

  // Current per-meter identity, fetched live by trainId rather than threaded
  // as props — keeps every call site (TrainLogModal, TrainDetail, TrainsList)
  // to just trainId/plantId/readingId, no matter which meter ends up picked.
  const { data: train } = useQuery({
    queryKey: ['train-meter-identity', trainId],
    queryFn: async () => (await supabase.from('ro_trains' as any).select('*').eq('id', trainId).single() as any).data as any,
  });

  const [form, setForm] = useState({
    replacement_date: format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: '', new_brand: '', new_size: '', new_serial: '', new_initial_reading: '',
    new_installed_date: format(new Date(), 'yyyy-MM-dd'), remarks: '',
  });

  const oldSerial: string | null = train ? ((train as any)[`${meterType}_meter_serial`] ?? null) : null;

  const submit = async () => {
    if (!form.new_serial) { toast.error('New serial required'); return; }
    setBusy(true);
    const payload: any = {
      train_id: trainId, plant_id: plantId, reading_id: readingId ?? null,
      meter_type: meterType, replacement_date: form.replacement_date,
      old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
      new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
      new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
      new_meter_installed_date: form.new_installed_date,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    const { error } = await supabase.from('ro_train_meter_replacements' as any).insert(payload);
    if (error) { setBusy(false); toast.error(friendlyError(error)); return; }

    const trainUpdate: any = {
      [`${meterType}_meter_brand`]: form.new_brand,
      [`${meterType}_meter_size`]: form.new_size,
      [`${meterType}_meter_serial`]: form.new_serial,
      [`${meterType}_meter_installed_date`]: form.new_installed_date,
    };
    await supabase.from('ro_trains' as any).update(trainUpdate).eq('id', trainId);

    if (readingId) {
      const flagCol = `is_${meterType}_meter_replacement`;
      // is_meter_replacement itself is DB-trigger-derived (OR of the three
      // granular flags) — no need to set it here too, see the 2026-07-27
      // migration's sync_ro_train_reading_meter_replacement_flag trigger.
      const { error: flagError } = await (supabase.from('ro_train_readings' as any) as any)
        .update({ [flagCol]: true })
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
        <DialogHeader><DialogTitle>Replace Train Meter</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div>
            <Label>Which meter was replaced?</Label>
            <Select value={meterType} onValueChange={(v) => setMeterType(v as TrainMeterType)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="feed">Feed</SelectItem>
                <SelectItem value="permeate">Permeate</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Replacement date</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} /></div>
            <div><Label>Old final reading</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} /></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} /></div>
            <div><Label>New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} /></div>
            <div><Label>New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Initial reading</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} /></div>
            <div><Label>Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} /></div>
          </div>
          <div><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>Save replacement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
