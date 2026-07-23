/**
 * ro-trains/EditPretreatReadingDialog.tsx
 *
 * Dialog for editing an existing Pre-Treatment reading.
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
import { canEditEntry, diffFields, logReadingEdit } from './helpers';

interface Props {
  row: any;
  trainId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditPretreatReadingDialog({ row, trainId, onClose, onSaved }: Props) {
  const { isManager, activeOperator, user } = useAuth();
  const [saving, setSaving]         = useState(false);
  const [dt, setDt]                 = useState(row.reading_datetime
    ? format(new Date(row.reading_datetime), "yyyy-MM-dd'T'HH:mm") : '');
  const [hpp, setHpp]               = useState(row.hpp_target_pressure_psi != null ? String(row.hpp_target_pressure_psi) : '');
  const [bagFilters, setBagFilters] = useState(row.bag_filters_changed != null ? String(row.bag_filters_changed) : '');
  const [remarks, setRemarks]       = useState(row.remarks ?? '');

  const canSave = canEditEntry(row, isManager, activeOperator?.id);

  const handleSave = async () => {
    if (!canSave) { toast.error('You no longer have permission to edit this entry.'); return; }
    setSaving(true);
    const payload = {
      reading_datetime:        new Date(dt).toISOString(),
      hpp_target_pressure_psi: hpp !== '' ? +hpp : null,
      bag_filters_changed:     bagFilters !== '' ? +bagFilters : null,
      remarks:                 remarks || null,
    };
    const { error } = await (supabase.from('ro_pretreatment_readings' as any) as any)
      .update(payload).eq('id', row.id);
    if (error) { setSaving(false); toast.error(friendlyError(error)); return; }

    const actorLabel = `${activeOperator?.first_name ?? ''} ${activeOperator?.last_name ?? ''}`.trim()
      || activeOperator?.username || null;
    await logReadingEdit({
      table_name:    'ro_pretreatment_readings',
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Pre-Treatment Reading</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Date / Time</Label>
            <Input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">HPP Target Pressure (psi)</Label>
              <Input type="number" step="any" value={hpp} onChange={(e) => setHpp(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Bag Filters Changed</Label>
              <Input type="number" step="1" value={bagFilters} onChange={(e) => setBagFilters(e.target.value)} className="h-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Remarks</Label>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="min-h-[60px]" />
          </div>
          <p className="text-[11px] text-muted-foreground">
            AFM/MMF units, booster pumps, and filter housing readings aren't editable here — submit a new entry to correct those.
          </p>
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
