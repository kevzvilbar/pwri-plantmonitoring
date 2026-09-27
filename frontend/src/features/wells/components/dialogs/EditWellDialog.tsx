import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { useDraft } from '@/hooks/useDraft';

export function EditWellDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const initialForm = {
    name: well.name ?? '', diameter: well.diameter ?? '', drilling_depth_m: well.drilling_depth_m?.toString() ?? '',
    meter_brand: well.meter_brand ?? '', meter_size: well.meter_size ?? '', meter_serial: well.meter_serial ?? '',
    meter_rollover_max: well.meter_rollover_max?.toString() ?? '',
    gps_lat: well.gps_lat?.toString() ?? '', gps_lng: well.gps_lng?.toString() ?? '',
  };
  const { draft, setDraft, clearDraft } = useDraft(`edit-well-form-${well.id}`, initialForm);
  const [form, setFormState] = useState(() => ({ ...initialForm, ...draft }));

  const setForm = (updater: typeof initialForm | ((prev: typeof initialForm) => typeof initialForm)) => {
    setFormState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setDraft(next);
      return next;
    });
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    const payload: Database['public']['Tables']['wells']['Update'] & {
      gps_lat?: number | null; gps_lng?: number | null; meter_rollover_max?: number | null;
    } = {
      name: form.name.trim(), diameter: form.diameter || null,
      drilling_depth_m: form.drilling_depth_m ? +form.drilling_depth_m : null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_rollover_max: form.meter_rollover_max ? +form.meter_rollover_max : null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    };
    let { error } = await supabase.from('wells').update(payload as never).eq('id', well.id);
    // Graceful fallback: if gps_lat/gps_lng/meter_rollover_max are missing from
    // the schema cache, retry without them rather than failing the entire
    // update — mirrors the same fallback AddWellDialog already uses.
    if (error && (error.message.includes('gps_lat') || error.message.includes('gps_lng') || error.message.includes('meter_rollover_max') || error.message.includes('column') || error.message.includes('schema cache'))) {
      const { gps_lat: _lat, gps_lng: _lng, meter_rollover_max: _mrm, ...fallbackPayload } = payload as any;
      const { error: e2 } = await supabase.from('wells').update(fallbackPayload as never).eq('id', well.id);
      error = e2 ?? null;
    }
    if (error) { toast.error(friendlyError(error)); return; }
    clearDraft();
    toast.success('Well updated'); onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Well</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label htmlFor="welldialogs-name">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} id="welldialogs-name"/></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="welldialogs-diameter">Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} id="welldialogs-diameter"/></div>
            <div><Label htmlFor="welldialogs-depth-m">Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} id="welldialogs-depth-m"/></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="welldialogs-meter-brand">Meter Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} id="welldialogs-meter-brand"/></div>
            <div><Label htmlFor="welldialogs-meter-size">Meter Size</Label><Input value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} id="welldialogs-meter-size"/></div>
            <div><Label htmlFor="welldialogs-meter-serial">Meter Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} id="welldialogs-meter-serial"/></div>
          </div>
          <div>
            <Label htmlFor="welldialogs-meter-rollover-wrap-point" className="flex items-center gap-1"><Gauge className="h-3 w-3" />Meter rollover wrap point</Label>
            <Input type="number" placeholder="e.g. 999999.99 for a 6-digit register" value={form.meter_rollover_max} onChange={e => setForm({ ...form, meter_rollover_max: e.target.value })} id="welldialogs-meter-rollover-wrap-point"/>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pre-fills the "meter rollover" wrap point at reading entry and defaults
              for this well's rows in Data Corrections. Leave blank if unknown — entry
              falls back to a generic guess.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="welldialogs-gps-lat">GPS Lat</Label><Input value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} id="welldialogs-gps-lat"/></div>
            <div><Label htmlFor="welldialogs-gps-lng">GPS Lng</Label><Input value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} id="welldialogs-gps-lng"/></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
