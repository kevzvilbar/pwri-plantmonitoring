/**
 * ro-trains/EditRoReadingDialog.tsx
 *
 * Dialog for editing an existing RO Train reading.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canEditEntry, diffFields, logReadingEdit, recalculateTrainDeltas } from './helpers';

const RO_EDIT_NUMERIC_FIELDS: { key: string; label: string; unit?: string; step?: string }[] = [
  { key: 'feed_pressure_psi',    label: 'Feed Pressure',      unit: 'psi' },
  { key: 'reject_pressure_psi',  label: 'Reject Pressure',    unit: 'psi' },
  { key: 'suction_pressure_psi', label: 'Suction Pressure',   unit: 'psi' },
  { key: 'feed_flow',            label: 'Feed Flow',          unit: 'm³/hr' },
  { key: 'permeate_flow',        label: 'Permeate Flow',      unit: 'm³/hr' },
  { key: 'reject_flow',          label: 'Reject Flow',        unit: 'm³/hr' },
  { key: 'feed_tds',             label: 'Feed TDS',           unit: 'ppm' },
  { key: 'permeate_tds',         label: 'Permeate TDS',       unit: 'ppm' },
  { key: 'reject_tds',           label: 'Reject TDS',         unit: 'ppm' },
  { key: 'feed_ph',              label: 'Feed pH' },
  { key: 'permeate_ph',          label: 'Permeate pH' },
  { key: 'reject_ph',            label: 'Reject pH' },
  { key: 'turbidity_ntu',        label: 'Turbidity',          unit: 'NTU' },
  { key: 'temperature_c',        label: 'Temperature',        unit: '°C'  },
  { key: 'chlorine_residual_mg_l', label: 'Chlorine Residual', unit: 'mg/L' },
  { key: 'permeate_meter',       label: 'Permeate Meter',     unit: 'm³' },
];

interface Props {
  row: any;
  trainId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditRoReadingDialog({ row, trainId, onClose, onSaved }: Props) {
  const { isManager, isDataAnalyst, activeOperator, user } = useAuth();
  const hasFullAccess = isManager || isDataAnalyst;
  const [saving, setSaving] = useState(false);
  const [dt, setDt]         = useState(row.reading_datetime
    ? format(new Date(row.reading_datetime), "yyyy-MM-dd'T'HH:mm") : '');
  const [remarks, setRemarks] = useState(row.remarks ?? '');
  const [vals, setVals]     = useState<Record<string, string>>(() =>
    Object.fromEntries(
      RO_EDIT_NUMERIC_FIELDS.map((f) => [f.key, row[f.key] != null ? String(row[f.key]) : '']),
    ),
  );

  const canSave = canEditEntry(row, hasFullAccess, activeOperator?.id);

  const handleSave = async () => {
    if (!canSave) { toast.error('You no longer have permission to edit this entry.'); return; }
    setSaving(true);
    const num = (k: string) => (vals[k] !== '' && vals[k] !== undefined ? +vals[k] : null);

    const payload: Record<string, any> = {
      reading_datetime: new Date(dt).toISOString(),
      remarks:          remarks || null,
    };
    for (const f of RO_EDIT_NUMERIC_FIELDS) {
      if (f.key in row) payload[f.key] = num(f.key);
    }

    // Recompute derived fields using the same formulas as the create form
    const feedP = num('feed_pressure_psi'), rejP = num('reject_pressure_psi');
    payload.dp_psi = feedP != null && rejP != null ? +(feedP - rejP).toFixed(1) : null;

    const effFeedFlow = num('feed_flow'), effPermFlow = num('permeate_flow');
    payload.recovery_pct = effPermFlow !== null && effFeedFlow !== null && effFeedFlow > 0
      ? +Math.min(100, Math.max(0, (effPermFlow / effFeedFlow) * 100)).toFixed(1) : null;

    const feedTds = num('feed_tds'), permTds = num('permeate_tds');
    payload.rejection_pct = feedTds != null && feedTds > 0 && permTds != null
      ? +(((feedTds - permTds) / feedTds) * 100).toFixed(2) : null;
    payload.salt_passage_pct = feedTds != null && feedTds > 0 && permTds != null
      ? +((permTds / feedTds) * 100).toFixed(2) : null;

    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update(payload).eq('id', row.id);
    if (error) { setSaving(false); toast.error(friendlyError(error)); return; }

    await recalculateTrainDeltas(trainId);

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name:    'ro_train_readings',
      record_id:     row.id,
      plant_id:      row.plant_id ?? null,
      train_id:      trainId,
      actor_user_id: user?.id ?? null,
      actor_label:   actorLabel,
      changes:       diffFields(row, payload),
    });

    setSaving(false);
    toast.success('Reading updated');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit RO Reading</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Date / Time</Label>
            <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {RO_EDIT_NUMERIC_FIELDS.filter((f) => f.key in row).map((f) => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
                <Input
                  type="number" step="any"
                  value={vals[f.key]}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-9"
                />
              </div>
            ))}
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[60px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
