import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { toast } from 'sonner';
import { GridPylonIcon } from '@/components/icons/water-icons';
import { format } from 'date-fns';

interface PowerMeterChangeFormProps {
  plant: any;
  gridMeterCount: number;
  gridMeterNames: string[];
  currentMultipliers: number[];
  readingId?: string;
  initialMeterIndex?: number;
  onSuccess?: () => void;
  onClose: () => void;
}

export function PowerMeterChangeForm({
  plant, gridMeterCount, gridMeterNames, currentMultipliers,
  readingId, initialMeterIndex, onSuccess, onClose,
}: PowerMeterChangeFormProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({
    meterIndex: initialMeterIndex ?? 0,
    changeDate: format(new Date(), 'yyyy-MM-dd'),
    newMultiplier: '',
    oldFinalReading: '',
    newInitialReading: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const oldMultiplier = currentMultipliers[form.meterIndex] ?? 1;
  const getMeterName = (i: number) =>
    gridMeterNames[i] ?? (gridMeterCount === 1 ? 'Grid Meter' : `Grid Meter ${i + 1}`);

  const submit = async () => {
    if (!form.oldFinalReading) { toast.error("Old meter's final reading is required"); return; }
    if (!form.newInitialReading) { toast.error("New meter's initial reading is required"); return; }
    if (!form.changeDate) { toast.error('Date changed is required'); return; }
    let newMult = oldMultiplier;
    if (!readingId) {
      newMult = parseFloat(form.newMultiplier);
      if (!(newMult > 0)) { toast.error('Enter a valid multiplier (must be > 0)'); return; }
    }
    setSaving(true);

    if (!readingId) {
      try {
        const updatedArr = Array.isArray(currentMultipliers) ? [...currentMultipliers] : [];
        while (updatedArr.length <= form.meterIndex) updatedArr.push(1);
        updatedArr[form.meterIndex] = newMult;
        await (supabase.from('plant_power_config' as any) as any).upsert(
          { plant_id: plant.id, grid_meter_multipliers: updatedArr, updated_at: new Date().toISOString() },
          { onConflict: 'plant_id' }
        );
      } catch { /* table may not exist yet */ }
    }

    let replacementRowId: string | null = null;
    try {
      const { data: inserted } = await (supabase.from('power_meter_changes' as any) as any).insert({
        plant_id: plant.id,
        meter_index: form.meterIndex,
        change_date: form.changeDate,
        old_multiplier: oldMultiplier,
        new_multiplier: newMult,
        old_meter_final_reading: +form.oldFinalReading,
        new_meter_initial_reading: +form.newInitialReading,
        notes: form.notes || null,
        changed_by: user?.id ?? null,
        created_at: new Date().toISOString(),
      }).select('id').single();
      replacementRowId = (inserted as any)?.id ?? null;
    } catch { /* ignore if table/columns missing */ }

    if (readingId) {
      try {
        const { error: flagErr } = await (supabase.from('power_readings') as any)
          .update({ is_grid_replacement: true }).eq('id', readingId);
        if (flagErr) await (supabase.from('power_readings') as any).update({ is_meter_replacement: true }).eq('id', readingId);
      } catch { /* non-critical */ }
      if (replacementRowId) {
        try {
          await (supabase.from('power_meter_changes' as any) as any).update({ reading_id: readingId }).eq('id', replacementRowId);
        } catch { /* non-critical */ }
      }
    } else {
      try {
        const { data: latestRow } = await (supabase
          .from('power_readings')
          .select('meter_reading_kwh, grid_meter_readings')
          .eq('plant_id', plant.id)
          .order('reading_datetime', { ascending: false })
          .limit(1) as any).maybeSingle();
        const [y, m, d] = form.changeDate.split('-').map(Number);
        const changeDt  = new Date(y, m - 1, d, 0, 0, 0).toISOString();
        const gmr: Record<string, number> = { ...((latestRow?.grid_meter_readings as Record<string, number> | null) ?? {}) };
        gmr[String(form.meterIndex)] = +form.newInitialReading;
        const { data: insertedReading } = await supabase.from('power_readings').insert({
          plant_id: plant.id,
          reading_datetime: changeDt,
          meter_reading_kwh: form.meterIndex === 0 ? +form.newInitialReading : (latestRow?.meter_reading_kwh ?? 0),
          grid_meter_readings: gmr,
          is_meter_replacement: true,
          recorded_by: user?.id ?? null,
        } as any).select('id').single();
        if (replacementRowId && (insertedReading as any)?.id) {
          await (supabase.from('power_meter_changes' as any) as any)
            .update({ reading_id: (insertedReading as any).id }).eq('id', replacementRowId);
        }
      } catch { /* non-critical — reading row is a convenience, not required */ }
    }

    setSaving(false);
    qc.invalidateQueries({ queryKey: ['plant-power-config', plant.id] });
    qc.invalidateQueries();
    toast.success(
      readingId
        ? `${getMeterName(form.meterIndex)}: meter replacement recorded`
        : `${getMeterName(form.meterIndex)}: meter change recorded · multiplier → ×${newMult}`
    );
    onSuccess?.();
    onClose();
  };

  const newMultNum = parseFloat(form.newMultiplier);
  const newMultValid = readingId ? true : newMultNum > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ChangeMeterIcon className="h-4 w-4 text-primary" /> {readingId ? 'Log Meter Replacement' : 'Change Power Meter'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {gridMeterCount > 1 && (
            <div className="space-y-1">
              <Label htmlFor="powermeters-grid-meter" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Grid Meter
              </Label>
              <Select
                value={String(form.meterIndex)}
                onValueChange={v => setForm(f => ({ ...f, meterIndex: +v }))}
              >
                <SelectTrigger className="h-9" id="powermeters-grid-meter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: gridMeterCount }).map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {getMeterName(i)}
                      <span className="ml-2 text-muted-foreground font-mono text-2xs">
                        ×{currentMultipliers[i] ?? 1}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="powermeters-change-date" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Change Date *
              </Label>
              <Input
                type="date"
                value={form.changeDate}
                onChange={e => setForm(f => ({ ...f, changeDate: e.target.value }))}
                className="h-9"
              id="powermeters-change-date"/>
            </div>
            <div className="space-y-1">
              <Label htmlFor="powermeters-old-meter-s-final-reading-kwh" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Old Meter&apos;s Final Reading * <span className="normal-case font-normal">(kWh)</span>
              </Label>
              <Input
                type="number" step="any"
                value={form.oldFinalReading}
                onChange={e => setForm(f => ({ ...f, oldFinalReading: e.target.value }))}
                className="h-9"
              id="powermeters-old-meter-s-final-reading-kwh"/>
            </div>
          </div>

          <div className={readingId ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
            <div className="space-y-1">
              <Label htmlFor="powermeters-new-meter-s-initial-reading-kwh" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                New Meter&apos;s Initial Reading * <span className="normal-case font-normal">(kWh)</span>
              </Label>
              <Input
                type="number" step="any"
                value={form.newInitialReading}
                onChange={e => setForm(f => ({ ...f, newInitialReading: e.target.value }))}
                className="h-9"
              id="powermeters-new-meter-s-initial-reading-kwh"/>
            </div>
            {!readingId && (
              <div className="space-y-1">
                <Label htmlFor="powermeters-new-multiplier-ct-ratio" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  New Multiplier * <span className="normal-case font-normal">(CT ratio)</span>
                </Label>
                <Input
                  type="number" step="any" min="0.001"
                  placeholder={`was ×${oldMultiplier}`}
                  value={form.newMultiplier}
                  onChange={e => setForm(f => ({ ...f, newMultiplier: e.target.value }))}
                  className="h-9"
                id="powermeters-new-multiplier-ct-ratio"/>
                <p className="text-2xs text-muted-foreground">
                  Current: <span className="font-mono font-semibold">×{oldMultiplier}</span>
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="powermeters-notes-optional" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes <span className="normal-case font-normal">(optional)</span>
            </Label>
            <Input
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. CT meter replaced, new ratio 40:1"
              className="h-9"
            id="powermeters-notes-optional"/>
          </div>

          {newMultValid && form.oldFinalReading && form.newInitialReading && (
            <div className="rounded-lg bg-warn-soft border border-warn p-3 text-xs text-warn space-y-1">
              <p className="font-semibold text-xs">What happens on save</p>
              <p>
                • <strong>{getMeterName(form.meterIndex)}</strong> reading:
                {' '}<span className="font-mono">{form.oldFinalReading}</span>
                {' '}→{' '}<span className="font-mono font-semibold text-primary">{form.newInitialReading}</span>
                {' '}on <strong>{form.changeDate}</strong> — Δ zeroed at rollover
              </p>
              {!readingId && (
                <p>
                  • Multiplier: <span className="font-mono">×{oldMultiplier}</span>
                  {' '}→{' '}<span className="font-mono font-semibold text-primary">×{form.newMultiplier}</span>,
                  effective <strong>{form.changeDate}</strong> onward
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-9">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !newMultValid || !form.changeDate || !form.oldFinalReading || !form.newInitialReading}
            className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {readingId ? 'Log replacement' : 'Record meter change'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
