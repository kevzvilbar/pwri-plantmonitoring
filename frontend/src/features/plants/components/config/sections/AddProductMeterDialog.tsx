import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gauge, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { Loader2 } from 'lucide-react';

export function AddProductMeterDialog({
  plantId, meterCount, userId, onClose, onCreated,
}: {
  plantId: string;
  meterCount: number;
  userId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '',
    gps_lat: '', gps_lng: '',
  });
  const [busy, setBusy]         = useState(false);
  const [locating, setLocating] = useState(false);

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

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
    } catch (e) {
      toast.error(`Location Failed: ${e.message || 'Permission Denied'}`);
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    setBusy(true);

    const fullPayload: any = {
      plant_id: plantId,
      name: form.name.trim(),
      status: 'Active',
      sort_order: meterCount,
      meter_brand:          form.meter_brand          || null,
      meter_size:           form.meter_size           || null,
      meter_serial:         form.meter_serial         || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat:  form.gps_lat  ? +form.gps_lat  : null,
      gps_lng:  form.gps_lng  ? +form.gps_lng  : null,
    };

    let { data, error } = await supabase
      .from('product_meters' as any)
      .insert(fullPayload)
      .select('id')
      .single();

    if (error && (error.message.includes('column') || error.message.includes('status') || error.message.includes('sort_order'))) {
      ({ data, error } = await supabase
        .from('product_meters' as any)
        .insert({ plant_id: plantId, name: form.name.trim() } as any)
        .select('id')
        .single());
    }

    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }

    await logProductMeterAudit({
      plant_id: plantId, meter_id: (data as any)?.id ?? '',
      meter_name: form.name.trim(), old_value: null, new_value: form.name.trim(),
      user_id: userId, timestamp: new Date().toISOString(),
    });

    toast.success(`"${form.name.trim()}" added`);
    onCreated();
  };

  const hasCoords = form.gps_lat && form.gps_lng;
  const mapsUrl   = hasCoords ? `https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}` : null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Product Meter</DialogTitle></DialogHeader>
        <div className="space-y-3">

          <div>
            <Label htmlFor="productmeters-name">Name *</Label>
            <Input
              value={form.name}
              onChange={field('name')}
              placeholder="e.g. Main Line, Secondary Line…"
              autoFocus
              data-testid="product-meter-name-input"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            id="productmeters-name"/>
          </div>

          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="text-xs font-semibold inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Meter Details
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="productmeters-brand" className="text-xs">Brand</Label>
                <Input value={form.meter_brand} onChange={field('meter_brand')} id="productmeters-brand"/>
              </div>
              <div>
                <Label htmlFor="productmeters-size" className="text-xs">Size</Label>
                <div className="relative">
                  <Input
                    type="number" min="0" step="0.5"
                    value={form.meter_size} onChange={field('meter_size')}
                    className="pr-8"
                  id="productmeters-size"/>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
                </div>
              </div>
              <div>
                <Label htmlFor="productmeters-serial" className="text-xs">Serial</Label>
                <Input value={form.meter_serial} onChange={field('meter_serial')} id="productmeters-serial"/>
              </div>
            </div>
            <div>
              <Label htmlFor="productmeters-installed-date" className="text-xs">Installed Date</Label>
              <Input type="date" value={form.meter_installed_date} onChange={field('meter_installed_date')} id="productmeters-installed-date"/>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium leading-none">GPS Coordinates</p>
              <div className="flex items-center gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <MapPin className="h-3 w-3" /> View on map
                  </a>
                )}
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                  onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                  {locating ? 'Locating…' : 'Use My Location'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="productmeters-latitude" className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.295" value={form.gps_lat} onChange={field('gps_lat')} id="productmeters-latitude"/>
              </div>
              <div>
                <Label htmlFor="productmeters-longitude" className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.877" value={form.gps_lng} onChange={field('gps_lng')} id="productmeters-longitude"/>
              </div>
            </div>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name.trim()} data-testid="save-product-meter-btn">
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function logProductMeterAudit(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore */ }
}
