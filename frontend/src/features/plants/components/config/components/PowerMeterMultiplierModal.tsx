import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Loader2, AlertTriangle, RotateCw, Zap } from 'lucide-react';
import { GridPylonIcon } from '@/features/plants/shared';

import { usePlantPowerConfig, type PlantPowerConfig, normalizePowerConfig } from '@/features/plants/hooks/usePlantPowerConfig';

export interface PowerMeterWorkflowTarget {
  name: string;
  powerKind: 'grid' | 'solar';
  meterIndex: number;
  meter_serial?: string | null;
  meter_multiplier?: number;
  multiplier_enabled?: boolean;
  last_reading?: number | null;
}

interface PowerMeterMultiplierModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantId: string;
  target: PowerMeterWorkflowTarget | null;
  eventType: 'physical_replacement' | 'multiplier_cutover';
  onSuccess?: () => void;
}

export function PowerMeterMultiplierModal({
  open,
  onOpenChange,
  plantId,
  target,
  eventType,
  onSuccess,
}: PowerMeterMultiplierModalProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { powerConfig, savePowerConfig } = usePlantPowerConfig(plantId);
  const [submitting, setSubmitting] = useState(false);

  const isPhysical = eventType === 'physical_replacement';

  const [effectiveAt, setEffectiveAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [oldReading, setOldReading] = useState<string>('');
  const [oldSerial, setOldSerial] = useState<string>('');
  const [newSerial, setNewSerial] = useState<string>('');
  const [newReading, setNewReading] = useState<string>('');
  const [newMultiplier, setNewMultiplier] = useState<string>('1');
  const [newMultiplierEnabled, setNewMultiplierEnabled] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (target && open) {
      setEffectiveAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      setOldSerial(target.meter_serial || '');
      setNewSerial(target.meter_serial || '');
      setOldReading(target.last_reading != null ? String(target.last_reading) : '');
      setNewReading(isPhysical ? '0' : (target.last_reading != null ? String(target.last_reading) : ''));
      setNewMultiplier(String(target.meter_multiplier ?? 1));
      setNewMultiplierEnabled(target.multiplier_enabled ?? ((target.meter_multiplier ?? 1) > 1));
      setNotes('');
    }
  }, [target, open, isPhysical]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plantId) {
      toast.error('Missing plant context');
      return;
    }
    if (isPhysical) {
      if (oldReading === '' || isNaN(Number(oldReading))) {
        toast.error("Old meter's final reading is required for physical replacement");
        return;
      }
      if (newReading === '' || isNaN(Number(newReading))) {
        toast.error("New meter's starting reading is required for physical replacement");
        return;
      }
    } else {
      if (newReading !== '' && isNaN(Number(newReading))) {
        toast.error('Starting reading must be a valid number');
        return;
      }
    }
    const multNum = Number(newMultiplier);
    if (newMultiplier === '' || isNaN(multNum) || multNum <= 0) {
      toast.error('Multiplier factor must be a positive number (> 0)');
      return;
    }

    setSubmitting(true);
    try {
      const datePart = effectiveAt.slice(0, 10);
      const isoDatetime = new Date(effectiveAt).toISOString();

      // 1. Fetch current power config to preserve other meters in array
      let currentCfg: PlantPowerConfig = powerConfig;
      try {
        const { data: dbCfg } = await (supabase.from('plant_power_config' as any) as any)
          .select('*')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (dbCfg) currentCfg = normalizePowerConfig(dbCfg);
      } catch {
        /* DB read failed, fall back to current hook powerConfig */
      }

      const isGrid = target.powerKind === 'grid';
      const count = isGrid ? (currentCfg?.grid_meter_count ?? 1) : (currentCfg?.solar_meter_count ?? 1);

      const multipliers = isGrid
        ? [...(currentCfg?.grid_meter_multipliers || [])]
        : [...(currentCfg?.solar_meter_multipliers || [])];

      const enabledFlags = isGrid
        ? [...(currentCfg?.grid_meter_multipliers_enabled || [])]
        : [...(currentCfg?.solar_meter_multipliers_enabled || [])];

      while (multipliers.length < count) multipliers.push(1);
      while (enabledFlags.length < count) enabledFlags.push(true);

      multipliers[target.meterIndex] = multNum;
      enabledFlags[target.meterIndex] = newMultiplierEnabled;

      const updatedPowerCfg: PlantPowerConfig = {
        ...currentCfg,
        ...(isGrid
          ? { grid_meter_multipliers: multipliers, grid_meter_multipliers_enabled: enabledFlags }
          : { solar_meter_multipliers: multipliers, solar_meter_multipliers_enabled: enabledFlags }),
      };

      await savePowerConfig(updatedPowerCfg);

      // 2. Insert audit record into power_meter_changes
      const { data: insertedChange, error: changeErr } = await (supabase.from('power_meter_changes' as any) as any)
        .insert({
          plant_id: plantId,
          meter_index: target.meterIndex,
          power_kind: target.powerKind,
          event_type: eventType,
          change_date: datePart,
          old_multiplier: target.meter_multiplier ?? 1,
          old_multiplier_enabled: target.multiplier_enabled ?? true,
          new_multiplier: multNum,
          new_multiplier_enabled: newMultiplierEnabled,
          old_meter_final_reading: oldReading !== '' ? Number(oldReading) : null,
          new_meter_initial_reading: newReading !== '' ? Number(newReading) : null,
          notes: notes.trim() || null,
          changed_by: user?.id || null,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (changeErr) {
        toast.error(friendlyError(changeErr));
        setSubmitting(false);
        return;
      }

      // 3. If physical replacement, log rollover reading to reset delta
      if (isPhysical && newReading !== '') {
        try {
          const { data: latestRow } = await (supabase
            .from('power_readings')
            .select('meter_reading_kwh, grid_meter_readings, solar_meter_readings')
            .eq('plant_id', plantId)
            .order('reading_datetime', { ascending: false })
            .limit(1) as any).maybeSingle();

          const [y, m, d] = datePart.split('-').map(Number);
          const changeDt = new Date(y, m - 1, d, 0, 0, 0).toISOString();

          if (isGrid) {
            const gmr: Record<string, number> = {
              ...((latestRow?.grid_meter_readings as Record<string, number> | null) ?? {}),
            };
            gmr[String(target.meterIndex)] = Number(newReading);

            const { data: insertedReading } = await supabase.from('power_readings').insert({
              plant_id: plantId,
              reading_datetime: changeDt,
              meter_reading_kwh: target.meterIndex === 0 ? Number(newReading) : (latestRow?.meter_reading_kwh ?? 0),
              grid_meter_readings: gmr,
              is_meter_replacement: true,
              recorded_by: user?.id ?? null,
            } as any).select('id').single();

            if (insertedChange?.id && (insertedReading as any)?.id) {
              await (supabase.from('power_meter_changes' as any) as any)
                .update({ reading_id: (insertedReading as any).id })
                .eq('id', insertedChange.id);
            }
          }
        } catch {
          // non-critical reading row
        }
      }

      toast.success(
        isPhysical
          ? `Meter replacement logged for ${target.name}`
          : `Multiplier configuration updated for ${target.name}`
      );

      // Invalidate queries
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] }),
        qc.invalidateQueries({ queryKey: ['power-meter-changes', plantId] }),
        qc.invalidateQueries({ queryKey: ['power-readings', plantId] }),
        qc.invalidateQueries({ queryKey: ['plants'] }),
      ]);

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(`Error: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              {isPhysical ? <RotateCw className="h-4 w-4" /> : <GridPylonIcon className="h-4 w-4" />}
            </div>
            <div>
              <DialogTitle className="text-base">
                {isPhysical ? `Replace Meter — ${target.name}` : `Multiplier Cutover — ${target.name}`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isPhysical
                  ? 'Record physical power meter swap, update serial/multiplier, and establish a baseline reset boundary.'
                  : 'Configure CT / dial multiplier and establish a reset boundary so historical energy readings remain valid.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Current status pill */}
        <div className="rounded-lg bg-muted/40 p-2.5 border border-border text-xs flex items-center justify-between">
          <div>
            <span className="text-muted-foreground">Current Multiplier: </span>
            <span className="font-semibold text-foreground">
              {target.multiplier_enabled
                ? `×${target.meter_multiplier ?? 1} (Active)`
                : `×${target.meter_multiplier ?? 1} (Off)`}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Source: </span>
            <span className="font-medium text-foreground uppercase tracking-wide text-3xs font-mono">
              {target.powerKind}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="power_effective_at" className="text-xs font-medium">
              Effective Date &amp; Time
            </Label>
            <Input
              id="power_effective_at"
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              className="text-xs h-8"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="power_old_reading" className="text-xs font-medium">
                {isPhysical ? 'Old Meter Final Reading (kWh)' : 'Last Reading (Pre-Cutover, kWh)'}
                {isPhysical && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Input
                id="power_old_reading"
                type="number"
                step="any"
                value={oldReading}
                onChange={(e) => setOldReading(e.target.value)}
                placeholder="e.g. 15420.5"
                className="text-xs h-8 font-mono"
                required={isPhysical}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="power_new_reading" className="text-xs font-medium">
                {isPhysical ? 'New Meter Initial Reading (kWh)' : 'New Starting Raw Reading (kWh)'}{' '}
                {isPhysical && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id="power_new_reading"
                type="number"
                step="any"
                value={newReading}
                onChange={(e) => setNewReading(e.target.value)}
                placeholder={isPhysical ? 'e.g. 0 or dial value' : 'Leave blank to skip reset boundary'}
                className="text-xs h-8 font-mono"
                required={isPhysical}
              />
              {!isPhysical && newReading === '' && (
                <p className="text-3xs text-amber-500/90 leading-tight mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>Leaving this blank skips the reset boundary for this cutover — the next reading continues from current meter register.</span>
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="power_new_multiplier" className="text-xs font-medium">
                Multiplier Factor (e.g. 120) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="power_new_multiplier"
                type="number"
                step="any"
                min="0.001"
                value={newMultiplier}
                onChange={(e) => setNewMultiplier(e.target.value)}
                placeholder="e.g. 120 or 1"
                className="text-xs h-8 font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="power_old_serial" className="text-xs font-medium">
                Meter Serial / CT Tag <span className="text-muted-foreground text-3xs font-normal">(optional)</span>
              </Label>
              <Input
                id="power_old_serial"
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="e.g. CT-400-A"
                className="text-xs h-8 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="power-enable-multiplier-switch" className="text-xs font-medium cursor-pointer">
                Enable Multiplier Calculation
              </Label>
              <p className="text-2xs text-muted-foreground">
                When enabled, future kWh deltas are automatically multiplied by ×{newMultiplier || '1'} to compute actual consumption.
              </p>
            </div>
            <Switch
              id="power-enable-multiplier-switch"
              checked={newMultiplierEnabled}
              onCheckedChange={setNewMultiplierEnabled}
              className="data-[state=checked]:bg-primary"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="power_notes" className="text-xs font-medium">
              Audit Notes &amp; Remarks
            </Label>
            <Textarea
              id="power_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide context or reason for this CT multiplier change..."
              className="text-xs min-h-[55px]"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting} className="bg-primary text-primary-foreground">
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {isPhysical ? 'Confirm Replacement' : 'Apply Multiplier Configuration'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
