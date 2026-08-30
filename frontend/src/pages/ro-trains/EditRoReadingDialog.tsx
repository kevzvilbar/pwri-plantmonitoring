/**
 * ro-trains/EditRoReadingDialog.tsx
 *
 * Dialog for editing an existing RO Train reading.
 * Extracted from ROTrains.tsx (§4 item 2 decomposition).
 *
 * Permission model (see helpers.ts canEditEntry): Managers, Admins, and
 * Data Analysts can edit any reading at any time. Operators can only edit
 * their own entries, and only while the reading isn't currently flagged
 * and awaiting review in Data Corrections — otherwise, use "Request
 * correction" instead. Unlike every other reading type in the app, there's
 * no time-window cutoff here: Kevz asked for it removed specifically for
 * RO Train / Pretreatment readings, offset by the existing audit trail
 * (logReadingEdit below, plus the required reason on every edit).
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
import { DateTimePicker } from '@/components/ui/date-picker';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { resolveReason, isReasonComplete } from '@/lib/correctionReasons';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { canEditEntry, diffFields, logReadingEdit, recalculateTrainDeltas } from './helpers';
import { getHourBucket } from '@/lib/hourlyReadingGuard';

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
  { key: 'feed_meter',           label: 'Feed Meter' },
  { key: 'permeate_meter',       label: 'Permeate Meter' },
  { key: 'reject_meter',         label: 'Reject Meter' },
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
  const [reason, setReason]   = useState('');
  const [customReason, setCustomReason] = useState('');
  const [vals, setVals]     = useState<Record<string, string>>(() =>
    Object.fromEntries(
      RO_EDIT_NUMERIC_FIELDS.map((f) => [f.key, row[f.key] != null ? String(row[f.key]) : '']),
    ),
  );

  const canSave = canEditEntry(row, hasFullAccess, activeOperator?.id, true);

  const handleSave = async () => {
    if (!canSave) { toast.error('You no longer have permission to edit this entry.'); return; }
    if (!reason) { toast.error('Select a reason for this edit'); return; }
    if (!isReasonComplete(reason, customReason)) { toast.error('Describe the reason for this edit'); return; }
    setSaving(true);

    // Hourly cadence guard — same one-reading-per-clock-hour rule the create
    // form enforces (PretreatmentAndROLog.tsx). Excludes this row's own id so
    // an edit that leaves the reading in the same hour (or only changes other
    // fields) never collides with itself.
    const hourBucket = getHourBucket(dt);
    const { data: existingHour, error: hourError } = await supabase
      .from('ro_train_readings')
      .select('id')
      .eq('train_id', trainId)
      .neq('id', row.id)
      .gte('reading_datetime', hourBucket.startISO)
      .lt('reading_datetime', hourBucket.endISO)
      .limit(1);
    if (hourError) { setSaving(false); toast.error(friendlyError(hourError)); return; }
    if (existingHour && existingHour.length > 0) {
      setSaving(false);
      toast.error(
        `This train already has another RO Train reading between ${hourBucket.label}. ` +
        `Only one reading is allowed per hour — pick a different time.`,
      );
      return;
    }

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
      reason:        resolveReason(reason, customReason),
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
            <Label htmlFor="editroreadingdialog-date-time" className="text-xs">Date / Time</Label>
            <DateTimePicker
              id="editroreadingdialog-date-time"
              value={dt}
              onChange={(d) => setDt(d)}
              className="h-9 w-full mt-1"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {RO_EDIT_NUMERIC_FIELDS.filter((f) => f.key in row).map((f) => (
              <div key={f.key}>
                <Label htmlFor="editroreadingdialog-field" className="text-xs">{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
                <Input
                  type="number" step="any"
                  value={vals[f.key]}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="h-9"
                id="editroreadingdialog-field"/>
              </div>
            ))}
          </div>
          <div>
            <Label htmlFor="editroreadingdialog-remarks" className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[60px]" id="editroreadingdialog-remarks"/>
          </div>
          <CorrectionReasonField
            reason={reason} onReasonChange={setReason}
            customReason={customReason} onCustomReasonChange={setCustomReason}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave || !isReasonComplete(reason, customReason)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
