import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, ArrowRight, AlertTriangle, ShieldCheck, Gauge, RotateCw } from 'lucide-react';
import { submitMeterMultiplierWorkflow } from '@/data/mutations/meterMultiplier';

export interface MeterWorkflowTarget {
  id: string;
  name: string;
  type: 'locator' | 'well' | 'product';
  meter_serial?: string | null;
  meter_multiplier?: number;
  multiplier_enabled?: boolean;
  last_reading?: number | null;
}

interface MeterMultiplierWorkflowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plantId: string;
  target: MeterWorkflowTarget | null;
  eventType: 'physical_replacement' | 'multiplier_cutover';
  onSuccess?: () => void;
}

export function MeterMultiplierWorkflowModal({
  open,
  onOpenChange,
  plantId,
  target,
  eventType,
  onSuccess,
}: MeterMultiplierWorkflowModalProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const isPhysical = eventType === 'physical_replacement';

  const [effectiveAt, setEffectiveAt] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [oldReading, setOldReading] = useState<string>('');
  const [oldConvention, setOldConvention] = useState<'pre_multiplied' | 'raw'>('pre_multiplied');
  const [oldSerial, setOldSerial] = useState<string>('');
  const [newSerial, setNewSerial] = useState<string>('');
  const [newReading, setNewReading] = useState<string>('');
  const [newMultiplier, setNewMultiplier] = useState<string>('10');
  const [newMultiplierEnabled, setNewMultiplierEnabled] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (target && open) {
      setEffectiveAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
      setOldSerial(target.meter_serial || '');
      setNewSerial(target.meter_serial || '');
      setOldReading(target.last_reading != null ? String(target.last_reading) : '');
      setNewReading(isPhysical ? '0' : (target.last_reading != null ? String(target.last_reading) : ''));
      setNewMultiplier(String(target.meter_multiplier ?? 10));
      setNewMultiplierEnabled(target.multiplier_enabled ?? true);
      setOldConvention(target.multiplier_enabled ? 'raw' : 'pre_multiplied');
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
    if (newReading === '' || isNaN(Number(newReading))) {
      toast.error('Valid new starting reading is required');
      return;
    }
    if (newMultiplier === '' || isNaN(Number(newMultiplier)) || Number(newMultiplier) <= 0) {
      toast.error('Multiplier must be a positive number');
      return;
    }
    if (isPhysical && !newSerial.trim()) {
      toast.error('New meter serial number is required for physical replacement');
      return;
    }

    setSubmitting(true);
    try {
      const isoDatetime = new Date(effectiveAt).toISOString();
      const { error } = await submitMeterMultiplierWorkflow({
        plantId,
        entityType: target.type,
        entityId: target.id,
        eventType,
        effectiveAt: isoDatetime,
        oldReadingValue: oldReading !== '' ? Number(oldReading) : null,
        oldReadingConvention: isPhysical ? 'raw' : oldConvention,
        oldMeterSerial: oldSerial || null,
        newReadingValue: Number(newReading),
        newMultiplier: Number(newMultiplier),
        newMultiplierEnabled: newMultiplierEnabled,
        newMeterSerial: isPhysical ? newSerial.trim() : target.meter_serial,
        performedBy: user?.id || null,
        notes: notes.trim() || null,
      });

      if (error) {
        toast.error(`Workflow failed: ${error.message}`);
        return;
      }

      toast.success(
        isPhysical
          ? `Meter replacement logged for ${target.name}`
          : `Multiplier configuration updated for ${target.name}`
      );

      // Invalidate relevant queries
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['meter-events'] }),
        qc.invalidateQueries({ queryKey: ['locators'] }),
        qc.invalidateQueries({ queryKey: ['wells'] }),
        qc.invalidateQueries({ queryKey: ['op-product-meters'] }),
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
              {isPhysical ? <RotateCw className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
            </div>
            <div>
              <DialogTitle className="text-base">
                {isPhysical ? `Replace Meter — ${target.name}` : `Multiplier Cutover — ${target.name}`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isPhysical
                  ? 'Record physical meter swap, update serial/multiplier, and establish a baseline reset boundary.'
                  : 'Configure dial multiplier and establish a reset boundary so historical readings remain valid.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Current status pill */}
        <div className="rounded-lg bg-muted/40 p-2.5 border border-border text-xs flex items-center justify-between">
          <div>
            <span className="text-muted-foreground">Current Multiplier: </span>
            <span className="font-semibold text-foreground">
              {target.multiplier_enabled ? `×${target.meter_multiplier} (Active)` : `×${target.meter_multiplier ?? 1} (Off)`}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Serial: </span>
            <span className="font-mono font-medium text-foreground">{target.meter_serial || 'None'}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="effective_at" className="text-xs font-medium">
              Effective Date & Time
            </Label>
            <Input
              id="effective_at"
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              className="text-xs h-8"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="old_reading" className="text-xs font-medium">
                {isPhysical ? 'Old Meter Final Reading' : 'Last Reading (Pre-Cutover)'}
              </Label>
              <Input
                id="old_reading"
                type="number"
                step="any"
                value={oldReading}
                onChange={(e) => setOldReading(e.target.value)}
                placeholder="e.g. 15420.5"
                className="text-xs h-8 font-mono"
              />
            </div>

            {!isPhysical && (
              <div className="space-y-1.5">
                <Label htmlFor="old_convention" className="text-xs font-medium">
                  Past Readings Convention
                </Label>
                <Select value={oldConvention} onValueChange={(v: any) => setOldConvention(v)}>
                  <SelectTrigger id="old_convention" className="text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pre_multiplied" className="text-xs">Pre-multiplied (Hand-calculated)</SelectItem>
                    <SelectItem value="raw" className="text-xs">Raw dial register value</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {isPhysical && (
              <div className="space-y-1.5">
                <Label htmlFor="old_serial" className="text-xs font-medium">
                  Old Meter Serial
                </Label>
                <Input
                  id="old_serial"
                  value={oldSerial}
                  onChange={(e) => setOldSerial(e.target.value)}
                  placeholder="Old serial number"
                  className="text-xs h-8 font-mono"
                />
              </div>
            )}
          </div>

          {isPhysical && (
            <div className="space-y-1.5">
              <Label htmlFor="new_serial" className="text-xs font-medium">
                New Meter Serial Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new_serial"
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="e.g. SN-89240-M"
                className="text-xs h-8 font-mono"
                required
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new_reading" className="text-xs font-medium">
                {isPhysical ? 'New Meter Initial Dial Reading' : 'New Starting Raw Reading'} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new_reading"
                type="number"
                step="any"
                value={newReading}
                onChange={(e) => setNewReading(e.target.value)}
                placeholder="e.g. 0 or dial value"
                className="text-xs h-8 font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new_multiplier" className="text-xs font-medium">
                Multiplier Factor (e.g. 10) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new_multiplier"
                type="number"
                step="any"
                value={newMultiplier}
                onChange={(e) => setNewMultiplier(e.target.value)}
                placeholder="10"
                className="text-xs h-8 font-mono"
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-2.5">
            <div className="space-y-0.5">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Switch (Radix) renders button[role=switch], not a native input; same false positive as ThemeSelector's Switch. */}
              <Label className="text-xs font-medium cursor-pointer">Enable Multiplier Calculation</Label>
              <p className="text-2xs text-muted-foreground">
                When enabled, future readings are automatically multiplied by ×{newMultiplier || '10'} to compute daily volume.
              </p>
            </div>
            <Switch
              checked={newMultiplierEnabled}
              onCheckedChange={setNewMultiplierEnabled}
              className="data-[state=checked]:bg-primary"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-medium">
              Audit Notes & Remarks
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide context or reason for this change..."
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
