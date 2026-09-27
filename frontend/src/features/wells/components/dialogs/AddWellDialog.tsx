import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { MapPin, Gauge, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { useDraft } from '@/hooks/useDraft';

export function AddWellDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const initialAddForm = {
    name: '', diameter: '', drilling_depth_m: '', has_power_meter: false,
    meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '',
    electric_meter_brand: '', electric_meter_size: '', electric_meter_serial: '', electric_meter_installed_date: '',
    gps_lat: '', gps_lng: '',
  };
  const { draft, setDraft, clearDraft } = useDraft(`add-well-form-${plantId}`, initialAddForm);
  const [form, setFormState] = useState(() => ({ ...initialAddForm, ...draft }));
  const [locating, setLocating] = useState(false);

  const setForm = (updater: typeof initialAddForm | ((prev: typeof initialAddForm) => typeof initialAddForm)) => {
    setFormState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setDraft(next);
      return next;
    });
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
      );
      setForm((f) => ({
        ...f,
        gps_lat: pos.coords.latitude.toFixed(6),
        gps_lng: pos.coords.longitude.toFixed(6),
      }));
      toast.success('Location Captured');
    } catch (e: any) {
      toast.error(`Location Failed: ${e?.message || 'Permission Denied'}`);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    const payload: Database['public']['Tables']['wells']['Insert'] & {
      gps_lat?: number | null; gps_lng?: number | null;
      electric_meter_brand?: string | null;
      electric_meter_size?: string | null;
      electric_meter_serial?: string | null;
      electric_meter_installed_date?: string | null;
    } = {
      plant_id: plantId,
      name: form.name.trim(),
      diameter: form.diameter || null,
      drilling_depth_m: form.drilling_depth_m ? +form.drilling_depth_m : null,
      has_power_meter: form.has_power_meter,
      meter_brand: form.meter_brand || null,
      meter_size: form.meter_size || null,
      meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null,
      gps_lng: form.gps_lng ? +form.gps_lng : null,
      status: 'Active',
    };
    if (form.has_power_meter) {
      payload.electric_meter_brand = form.electric_meter_brand || null;
      payload.electric_meter_size = form.electric_meter_size || null;
      payload.electric_meter_serial = form.electric_meter_serial || null;
      payload.electric_meter_installed_date = form.electric_meter_installed_date || null;
    }
    let { error } = await supabase.from('wells').insert(payload as never);
    // Graceful fallback: if optional columns (gps_lat, gps_lng, electric_meter_*) are missing
    // from the schema cache, retry without them rather than failing the entire insert.
    if (error && (error.message.includes('gps_lat') || error.message.includes('gps_lng') || error.message.includes('column') || error.message.includes('schema cache'))) {
      const { gps_lat: _lat, gps_lng: _lng, electric_meter_brand: _emb, electric_meter_size: _ems, electric_meter_serial: _emse, electric_meter_installed_date: _emid, ...fallbackPayload } = payload as any;
      const { error: e2 } = await supabase.from('wells').insert(fallbackPayload as never);
      error = e2 ?? null;
    }
    if (error) { toast.error(friendlyError(error)); return; }
    clearDraft();
    toast.success(`${form.name.trim()} added`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Well</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="welldialogs-name-2">Name *</Label>
            <Input data-testid="add-well-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Well #1" id="welldialogs-name-2"/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="welldialogs-diameter-2">Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} placeholder="8 inch" id="welldialogs-diameter-2"/></div>
            <div><Label htmlFor="welldialogs-depth-m-2">Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} id="welldialogs-depth-m-2"/></div>
          </div>

          {/* Water meter */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="text-xs font-semibold inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Water Meter
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="welldialogs-brand" className="text-xs">Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} id="welldialogs-brand"/></div>
              <div><Label htmlFor="welldialogs-size" className="text-xs">Size</Label><Input type="number" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} id="welldialogs-size"/></div>
              <div><Label htmlFor="welldialogs-serial" className="text-xs">Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} id="welldialogs-serial"/></div>
            </div>
          </div>

          {/* Electric meter (optional) */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Checkbox (Radix) renders button[role=checkbox], not a native input; same false positive as ThemeSelector's Switch. */}
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <Checkbox
                checked={form.has_power_meter}
                onCheckedChange={(v) => setForm({ ...form, has_power_meter: !!v })}
                className="shrink-0 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                data-testid="add-well-has-power-meter"
              />
              <Zap className="h-3 w-3 text-warn" />
              Has Dedicated Electric Meter
            </label>
            {form.has_power_meter && (
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="welldialogs-brand-2" className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} data-testid="add-well-em-brand" id="welldialogs-brand-2"/></div>
                <div><Label htmlFor="welldialogs-size-2" className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} placeholder="kWh" id="welldialogs-size-2"/></div>
                <div><Label htmlFor="welldialogs-serial-2" className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} data-testid="add-well-em-serial" id="welldialogs-serial-2"/></div>
                <div className="col-span-3">
                  <Label htmlFor="welldialogs-installed" className="text-xs">Installed</Label>
                  <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} id="welldialogs-installed"/>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="welldialogs-gps-lat-2">GPS Lat</Label>
              <Input data-testid="add-well-lat" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} placeholder="10.295" id="welldialogs-gps-lat-2"/>
            </div>
            <div><Label htmlFor="welldialogs-gps-lng-2">GPS Lng</Label>
              <Input data-testid="add-well-lng" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} placeholder="123.877" id="welldialogs-gps-lng-2"/>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={useMyLocation} disabled={locating} data-testid="use-my-location-btn">
            <MapPin className="h-3 w-3 mr-1" />
            {locating ? 'Capturing…' : 'Use My Location'}
          </Button>
        </div>
        <DialogFooter>
          <Button data-testid="add-well-save" onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
