import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Gauge, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { computeDrawdown } from '@/features/wells/lib/hydraulics';

export function EditHydraulicDialog({
  well,
  latest,
  record,
  onClose,
}: {
  well: any;
  latest?: any;
  record?: any;
  onClose: () => void;
}) {
  const { user, activeOperator } = useAuth();
  const isEdit = !!record;
  const initialSource = record ?? latest;

  const [form, setForm] = useState({
    date_gathered: record?.date_gathered ?? format(new Date(), 'yyyy-MM-dd'),
    drilling_depth_m: record?.drilling_depth_m?.toString() ?? (latest as any)?.drilling_depth_m?.toString() ?? well.drilling_depth_m?.toString() ?? '',
    static_water_level_m: initialSource?.static_water_level_m?.toString() ?? '',
    pumping_water_level_m: initialSource?.pumping_water_level_m?.toString() ?? '',
    pump_setting: initialSource?.pump_setting ?? '',
    motor_hp: initialSource?.motor_hp?.toString() ?? '',
    tds_ppm: initialSource?.tds_ppm?.toString() ?? '',
    turbidity_ntu: initialSource?.turbidity_ntu?.toString() ?? '',
    remarks: record?.remarks ?? '',
  });

  const liveDrawdown = computeDrawdown(form.pumping_water_level_m, form.static_water_level_m);

  const submit = async () => {
    if (!form.date_gathered) {
      toast.error('Date gathered is required');
      return;
    }

    const num = (v: any) => v === '' || v == null ? null : +v;

    const numSwl = num(form.static_water_level_m);
    const numPwl = num(form.pumping_water_level_m);
    const numDepth = num(form.drilling_depth_m);
    const numHp = num(form.motor_hp);
    const numTds = num(form.tds_ppm);
    const numTurb = num(form.turbidity_ntu);

    // Negative measurement validation
    if (
      (numSwl != null && numSwl < 0) ||
      (numPwl != null && numPwl < 0) ||
      (numDepth != null && numDepth < 0) ||
      (numHp != null && numHp < 0) ||
      (numTds != null && numTds < 0) ||
      (numTurb != null && numTurb < 0)
    ) {
      toast.error('Measurements cannot be negative');
      return;
    }

    if (numSwl != null && numPwl != null && numSwl > numPwl) {
      toast.warning('Static level (SWL) is deeper than Pumping level (PWL). Please verify measurement accuracy.');
    }

    const payload: any = {
      well_id: well.id,
      plant_id: well.plant_id,
      record_type: record?.record_type ?? 'PMS',
      date_gathered: form.date_gathered,
      static_water_level_m: numSwl,
      pumping_water_level_m: numPwl,
      pump_setting: form.pump_setting || null,
      motor_hp: numHp,
      tds_ppm: numTds,
      turbidity_ntu: numTurb,
      remarks: form.remarks || null,
    };

    if (isEdit) {
      const { error } = await supabase
        .from('well_pms_records')
        .update(payload)
        .eq('id', record.id);
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success('Hydraulic survey record updated');
    } else {
      payload.recorded_by = activeOperator?.id ?? user?.id;
      const { error } = await supabase
        .from('well_pms_records')
        .insert(payload);
      if (error) { toast.error(friendlyError(error)); return; }
      toast.success('Hydraulic data logged');
    }

    // Keep wells.drilling_depth_m in sync
    if (form.drilling_depth_m !== '') {
      await supabase.from('wells').update({ drilling_depth_m: numDepth }).eq('id', well.id);
    }

    onClose();
  };

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit Hydraulic Record — ${record.date_gathered}` : `Log Hydraulic Data — ${well.name}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div>
            <Label htmlFor="welldialogs-date-gathered">Date gathered *</Label>
            <Input type="date" value={form.date_gathered} onChange={e => set('date_gathered', e.target.value)} id="welldialogs-date-gathered"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="welldialogs-drilling-depth-m">Drilling depth (m)</Label>
              <Input type="number" step="any" min="0" value={form.drilling_depth_m} onChange={e => set('drilling_depth_m', e.target.value)} id="welldialogs-drilling-depth-m"/>
            </div>
            <div>
              <Label htmlFor="welldialogs-pump-setting">Pump setting</Label>
              <Input value={form.pump_setting} onChange={e => set('pump_setting', e.target.value)} id="welldialogs-pump-setting"/>
            </div>
            <div>
              <Label htmlFor="welldialogs-swl-m">SWL (m)</Label>
              <Input type="number" step="any" min="0" value={form.static_water_level_m} onChange={e => set('static_water_level_m', e.target.value)} id="welldialogs-swl-m"/>
            </div>
            <div>
              <Label htmlFor="welldialogs-pwl-m">PWL (m)</Label>
              <Input type="number" step="any" min="0" value={form.pumping_water_level_m} onChange={e => set('pumping_water_level_m', e.target.value)} id="welldialogs-pwl-m"/>
            </div>
            {liveDrawdown != null && (
              <div className="col-span-2 p-2 rounded bg-info/10 border border-info/20 text-xs flex items-center justify-between">
                <span className="text-info font-medium">Calculated Drawdown (PWL − SWL):</span>
                <span className="font-mono-num font-bold text-info">{liveDrawdown} m</span>
              </div>
            )}
            <div>
              <Label htmlFor="welldialogs-motor-hp">Motor HP</Label>
              <Input type="number" step="any" min="0" value={form.motor_hp} onChange={e => set('motor_hp', e.target.value)} id="welldialogs-motor-hp"/>
            </div>
            <div>
              <Label htmlFor="welldialogs-tds-ppm">TDS (ppm)</Label>
              <Input type="number" step="any" min="0" value={form.tds_ppm} onChange={e => set('tds_ppm', e.target.value)} id="welldialogs-tds-ppm"/>
            </div>
            <div className="col-span-2">
              <Label htmlFor="welldialogs-turbidity-ntu">Turbidity (NTU)</Label>
              <Input type="number" step="any" min="0" value={form.turbidity_ntu} onChange={e => set('turbidity_ntu', e.target.value)} id="welldialogs-turbidity-ntu"/>
            </div>
            <div className="col-span-2">
              <Label htmlFor="welldialogs-remarks">Remarks</Label>
              <Input value={form.remarks} onChange={e => set('remarks', e.target.value)} id="welldialogs-remarks"/>
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">
            {isEdit
              ? 'Saving updates this historical survey entry in-place.'
              : 'Each save creates a new history entry so you can track changes over time.'}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={submit}>{isEdit ? 'Save Changes' : 'Save Entry'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HydraulicHistoryDialog({
  well,
  records,
  canEdit,
  onEdit,
  onDelete,
  onClose,
}: {
  well: any;
  records: any[];
  canEdit: boolean;
  onEdit: (record: any) => void;
  onDelete: (record: any) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-info" />
            Hydraulic Survey History — {well.name}
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({records.length} record{records.length === 1 ? '' : 's'})
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">
          {records.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hydraulic survey records logged yet.
            </div>
          ) : (
            <div className="space-y-2">
              {records.map((p: any) => {
                const drawdown = p.pumping_water_level_m != null && p.static_water_level_m != null
                  ? +(p.pumping_water_level_m - p.static_water_level_m).toFixed(2)
                  : null;
                return (
                  <div key={p.id} className="rounded-lg border border-border/70 bg-card p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">{p.date_gathered}</span>
                        <span className="text-2xs uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                          {p.record_type ?? 'PMS'}
                        </span>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => onEdit(p)}
                            title="Edit this survey entry"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => onDelete(p)}
                            title="Delete this survey entry"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-2xs">
                      <div>
                        <span className="text-muted-foreground block">Drilling Depth</span>
                        <span className="font-mono-num font-medium text-xs">{p.drilling_depth_m != null ? `${p.drilling_depth_m} m` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Static Level (SWL)</span>
                        <span className="font-mono-num font-medium text-xs">{p.static_water_level_m != null ? `${p.static_water_level_m} m` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Pumping Level (PWL)</span>
                        <span className="font-mono-num font-medium text-xs">{p.pumping_water_level_m != null ? `${p.pumping_water_level_m} m` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Drawdown (PWL − SWL)</span>
                        <span className="font-mono-num font-medium text-xs text-info">{drawdown != null ? `${drawdown} m` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Pump Setting</span>
                        <span className="font-mono-num font-medium text-xs">{p.pump_setting ?? '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Motor Rating</span>
                        <span className="font-mono-num font-medium text-xs">{p.motor_hp != null ? `${p.motor_hp} HP` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">TDS (Survey)</span>
                        <span className="font-mono-num font-medium text-xs">{p.tds_ppm != null ? `${p.tds_ppm} ppm` : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Turbidity</span>
                        <span className="font-mono-num font-medium text-xs">{p.turbidity_ntu != null ? `${p.turbidity_ntu} NTU` : '—'}</span>
                      </div>
                    </div>
                    {p.remarks && (
                      <div className="text-2xs text-muted-foreground pt-1 border-t">
                        <span className="font-medium text-foreground">Remarks:</span> {p.remarks}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
