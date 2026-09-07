import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

export function AddLocatorDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [form, setForm] = useState({
    name: '', address: '', meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '', gps_lat: '', gps_lng: '', product_meter_id: '',
    // See the matching block in EditLocatorDialog above for the full explanation.
    is_derived: false, derived_from_meter_id: '',
  });
  const [locating, setLocating] = useState(false);

  // Product meters for "Supplied by" select
  // BUGFIX (2026-07-24): was ['product-meters', plantId] — collided with other
  // components using that key with a different select() shape.
  const { data: productMeters } = useQuery({
    queryKey: ['locator-dialog-product-meters', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name').eq('plant_id', plantId).order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  // Deliberately NOT scoped to plantId — see the matching query in
  // EditLocatorDialog for why the mother meter can live on another plant.
  const { data: allMetersForDerive } = useQuery({
    queryKey: ['locator-dialog-all-product-meters-for-derive'],
    queryFn: async () => {
      const [{ data: meters }, { data: plants }] = await Promise.all([
        (supabase.from('product_meters' as any) as any).select('id, name, plant_id').order('name', { ascending: true }),
        (supabase.from('plants' as any) as any).select('id, name'),
      ]);
      const plantNameById: Record<string, string> = {};
      (plants ?? []).forEach((p: any) => { plantNameById[p.id] = p.name; });
      return (meters ?? []).map((m: any) => ({ ...m, plantName: plantNameById[m.plant_id] ?? 'Unknown plant' })) as any[];
    },
  });

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
    if (!form.name) { toast.error('Name Required'); return; }
    if (form.is_derived && !form.derived_from_meter_id) {
      toast.error('Pick the mother meter this locator is derived from');
      return;
    }
    const payload: any = {
      plant_id: plantId, name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    };
    if (form.product_meter_id) payload.product_meter_id = form.product_meter_id;
    if (form.is_derived) {
      payload.is_derived = true;
      payload.derived_from_meter_id = form.derived_from_meter_id;
      // BUGFIX (2026-07-30): default_input_mode is NOT NULL DEFAULT 'raw' on this
      // table, and this dialog never exposed a raw/direct picker at creation time,
      // so a brand-new derived locator used to insert straight into 'raw' mode with
      // no way to fix it here. trg_force_direct_mode (Phase 6) would catch this on
      // the DB side regardless, but setting it explicitly avoids relying on that
      // alone for a fresh row. See 20260730_hamas_phase6_default_input_mode_guard.sql.
      payload.default_input_mode = 'direct';
    }
    const { error } = await supabase.from('locators').insert(payload);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Locator Added'); onClose();
  };

  const hasCoords = form.gps_lat && form.gps_lng;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}` : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Locator</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label htmlFor="locatordialogs-name-2">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} id="locatordialogs-name-2"/></div>
          <div><Label htmlFor="locatordialogs-address-2">Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} id="locatordialogs-address-2"/></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="locatordialogs-brand-2">Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} id="locatordialogs-brand-2"/></div>
            <div>
              <Label htmlFor="locatordialogs-size-2">Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" id="locatordialogs-size-2"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label htmlFor="locatordialogs-serial-2">Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} id="locatordialogs-serial-2"/></div>
          </div>

          {/* Supplied by product meter */}
          {(productMeters?.length ?? 0) > 0 && (
            <div>
              <Label htmlFor="locatordialogs-supplied-by-product-meter-2">Supplied by (Product Meter)</Label>
              <Select value={form.product_meter_id || '__none__'} onValueChange={v => setForm({ ...form, product_meter_id: v === '__none__' ? '' : v })}>
                <SelectTrigger className="h-9 text-sm" id="locatordialogs-supplied-by-product-meter-2">
                  <SelectValue placeholder="None — select a product meter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {productMeters!.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Derived (Hamas-style) wiring — see the matching block + comment
              in EditLocatorDialog above for the full explanation. */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-locator-is-derived"
                checked={form.is_derived}
                onCheckedChange={(c) => setForm({ ...form, is_derived: c === true })}
              />
              <Label htmlFor="add-locator-is-derived" className="cursor-pointer">
                This locator has no physical meter (derived / Hamas-style)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Its daily volume will be computed automatically as{' '}
              <span className="font-medium text-foreground/80">mother meter − sibling locators</span>{' '}
              once readings exist for both sides. No manual entry needed after saving.
            </p>
            {form.is_derived && (
              <div>
                <Label htmlFor="locatordialogs-derived-from-mother-meter-2">Derived from (mother meter) *</Label>
                <Select
                  value={form.derived_from_meter_id || '__none__'}
                  onValueChange={(v) => setForm({ ...form, derived_from_meter_id: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger className="h-9 text-sm" id="locatordialogs-derived-from-mother-meter-2">
                    <SelectValue placeholder="Select the mother meter…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">Select…</span>
                    </SelectItem>
                    {(allMetersForDerive ?? []).map((m: any) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} <span className="text-muted-foreground">— {m.plantName}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground mt-1">
                  Can be a meter on a different plant. Sibling locators are everything
                  else whose own "Supplied by" above points at this same meter.
                </p>
              </div>
            )}
          </div>

          {/* GPS row */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium leading-none">GPS Coordinates</p>
              <div className="flex items-center gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <MapPin className="h-3 w-3" />View on map
                  </a>
                )}
                <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                  onClick={useMyLocation} disabled={locating}>
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                  {locating ? 'Locating…' : 'Use my location'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="locatordialogs-latitude-2" className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} id="locatordialogs-latitude-2"/>
              </div>
              <div>
                <Label htmlFor="locatordialogs-longitude-2" className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} id="locatordialogs-longitude-2"/>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
