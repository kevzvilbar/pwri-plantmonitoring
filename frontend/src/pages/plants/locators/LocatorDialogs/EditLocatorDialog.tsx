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

export function EditLocatorDialog({ locator, onClose }: { locator: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: locator.name ?? '', address: locator.address ?? locator.location_desc ?? '',
    meter_brand: locator.meter_brand ?? '', meter_size: locator.meter_size ?? '', meter_serial: locator.meter_serial ?? '',
    meter_installed_date: locator.meter_installed_date ?? '', gps_lat: locator.gps_lat?.toString() ?? '', gps_lng: locator.gps_lng?.toString() ?? '',
    product_meter_id: locator.product_meter_id ?? '',
    default_input_mode: (locator.default_input_mode === 'direct' ? 'direct' : 'raw') as 'raw' | 'direct',
    // Hamas-style derived locator — see supabase/migrations/20260722_mother_meter_derived.sql
    // and 20260727_hamas_phase2_sweep_function.sql. is_derived + derived_from_meter_id were
    // previously only settable by hand-editing the row in Supabase; this exposes them here.
    is_derived: !!locator.is_derived,
    derived_from_meter_id: locator.derived_from_meter_id ?? '',
  });
  const [locating, setLocating] = useState(false);

  // Product meters for "Supplied by" select
  // BUGFIX (2026-07-24): was ['product-meters', locator.plant_id] — collided
  // with other components using that key with a different select() shape.
  const { data: productMeters } = useQuery({
    queryKey: ['locator-dialog-product-meters', locator.plant_id],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name').eq('plant_id', locator.plant_id).order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  // Mother-meter candidates for "Derived from" — deliberately NOT scoped to
  // locator.plant_id. The whole point of the Hamas/Mambaling case is that the
  // mother meter can live on a different plant than the derived locator, so
  // this needs every product meter across every plant, labeled with its
  // plant name so two same-named meters on different plants aren't ambiguous.
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
    enabled: true,
  });

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 })
      );
      setForm(f => ({ ...f, gps_lat: pos.coords.latitude.toFixed(6), gps_lng: pos.coords.longitude.toFixed(6) }));
      toast.success('Location captured');
    } catch {
      toast.error('Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const { user, activeOperator } = useAuth();

  const submit = async () => {
    if (!form.name) { toast.error('Name Required'); return; }
    // A derived locator has no physical meter to read — it MUST know which
    // mother meter to subtract siblings from, or fn_sweep_derived_meters()
    // silently skips it (is_derived=true AND derived_from_meter_id IS NOT NULL
    // is the exact WHERE clause the sweep function filters on).
    if (form.is_derived && !form.derived_from_meter_id) {
      toast.error('Pick the mother meter this locator is derived from');
      return;
    }
    const payload: any = {
      name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
      default_input_mode: form.default_input_mode,
    };
    // Mirror the Add form pattern: only include product_meter_id when setting a value,
    // or when the original row had one (so the user can intentionally clear it to null).
    // Omitting the key entirely avoids a schema-cache crash if the column doesn't exist yet.
    if (form.product_meter_id || locator.product_meter_id != null) {
      payload.product_meter_id = form.product_meter_id || null;
    }
    // Same defensive pattern for the derive fields — these are the newest
    // columns on this table, most likely to hit a stale PostgREST schema
    // cache if the migration was just applied.
    if (form.is_derived !== !!locator.is_derived) {
      payload.is_derived = form.is_derived;
    }
    if (form.derived_from_meter_id !== (locator.derived_from_meter_id ?? '')) {
      payload.derived_from_meter_id = form.derived_from_meter_id || null;
    }
    // Turning is_derived off should also clear the now-meaningless mother-meter
    // link rather than leaving a dangling reference an admin has to notice later.
    if (form.is_derived === false && locator.derived_from_meter_id != null) {
      payload.derived_from_meter_id = null;
    }
    const { error } = await supabase.from('locators').update(payload).eq('id', locator.id);
    if (error) { toast.error(friendlyError(error)); return; }
    // EditLocatorDialog doesn't change status — status changes via the toggle in
    // LocatorsList, which logs its own audit entry there. Nothing to log here.
    toast.success('Locator updated'); onClose();
  };

  const hasCoords = form.gps_lat && form.gps_lng;
  const mapsUrl = hasCoords ? `https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}` : null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Locator</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label htmlFor="locatordialogs-name">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} id="locatordialogs-name"/></div>
          <div><Label htmlFor="locatordialogs-address">Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} id="locatordialogs-address"/></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="locatordialogs-brand">Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} id="locatordialogs-brand"/></div>
            <div>
              <Label htmlFor="locatordialogs-size">Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" id="locatordialogs-size"/>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label htmlFor="locatordialogs-serial">Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} id="locatordialogs-serial"/></div>
          </div>

          {/* Supplied by product meter */}
          {(productMeters?.length ?? 0) > 0 && (
            <div>
              <Label htmlFor="locatordialogs-supplied-by-product-meter">Supplied by (Product Meter)</Label>
              <Select value={form.product_meter_id || '__none__'} onValueChange={v => setForm({ ...form, product_meter_id: v === '__none__' ? '' : v })}>
                <SelectTrigger className="h-9 text-sm" id="locatordialogs-supplied-by-product-meter">
                  <SelectValue placeholder="None" />
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

          {/* Reading entry mode — moved here from Operations (2026-07-27).
              Operators used to see a clickable Raw/Direct toggle per entry
              with no server-side persistence (Locator tab) or a
              localStorage-per-device one (Blending tab), so the same meter
              could look like it was in a different mode depending on who was
              entering data and on which device. This is now a deliberate,
              plant-config-owned choice a Manager/Admin makes once.

              BUGFIX (2026-07-30): this used to be hidden entirely whenever
              is_derived was checked, which meant the underlying value never
              got updated and could silently stay 'raw' (see the checkbox's
              onCheckedChange above, and 20260730_hamas_phase6_default_input_mode_guard.sql).
              Kept visible but disabled/locked here instead, so an admin can
              actually see the mode is Direct rather than wondering where the
              control went. */}
          <div>
            <Label htmlFor="locatordialogs-reading-entry-mode">Reading entry mode</Label>
            <Select
              value={form.is_derived ? 'direct' : form.default_input_mode}
              disabled={form.is_derived}
              onValueChange={(v: 'raw' | 'direct') => setForm({ ...form, default_input_mode: v })}
            >
              <SelectTrigger className="h-9 text-sm" id="locatordialogs-reading-entry-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw meter — operator enters the cumulative reading</SelectItem>
                <SelectItem value="direct">Direct m³ — operator enters the day's volume</SelectItem>
              </SelectContent>
            </Select>
            {form.is_derived && (
              <p className="text-2xs text-muted-foreground mt-1">
                Locked to Direct — this locator has no physical meter, so there's no
                cumulative reading to enter or diff against.
              </p>
            )}
          </div>

          {/* Derived (Hamas-style) wiring — the toggle + mother-meter picker
              this dialog was missing. Previously the only way to stand up a
              new "no physical meter, computed as a residual" locator was to
              hand-edit is_derived / derived_from_meter_id directly in
              Supabase. See supabase/migrations/20260727_hamas_phase2_sweep_function.sql
              for exactly how these two columns get consumed by the sweep,
              and .../phase3_review_flags_and_notify.sql for how edits to the
              mother meter or a sibling locator flag this locator for review. */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="locator-is-derived"
                checked={form.is_derived}
                onCheckedChange={(c) => setForm(f => ({
                  ...f,
                  is_derived: c === true,
                  // BUGFIX (2026-07-30): a derived locator has no meter to enter a
                  // cumulative reading against, so its entry mode must be 'direct'.
                  // This used to only hide the <Select> below without ever touching
                  // its value, so a locator could become derived while quietly
                  // staying on 'raw' underneath — exactly the state Hamas (SRP) was
                  // found in (see 20260730_hamas_phase6_default_input_mode_guard.sql).
                  // The DB now also enforces this via trg_force_direct_mode; this
                  // just keeps the form's own state (and the disabled <Select> below)
                  // honest without waiting on a refetch.
                  default_input_mode: c === true ? 'direct' : f.default_input_mode,
                }))}
              />
              <Label htmlFor="locator-is-derived" className="cursor-pointer">
                This locator has no physical meter (derived / Hamas-style)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Its daily volume is computed automatically as{' '}
              <span className="font-medium text-foreground/80">mother meter − sibling locators</span>,
              on a schedule and on demand via "Recalculate now" in Operations → Locator.
              Manual entry is disabled — use the Override button there instead if the
              computed value ever needs correcting by hand.
            </p>
            {form.is_derived && (
              <div>
                <Label htmlFor="locatordialogs-derived-from-mother-meter">Derived from (mother meter) *</Label>
                <Select
                  value={form.derived_from_meter_id || '__none__'}
                  onValueChange={(v) => setForm({ ...form, derived_from_meter_id: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger className="h-9 text-sm" id="locatordialogs-derived-from-mother-meter">
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
                  Can be a meter on a different plant — this is exactly how Hamas (SRP)
                  derives from the Mambaling product meter today. Sibling locators are
                  everything else whose "Supplied by" above points at the same mother meter.
                </p>
              </div>
            )}
          </div>

          {/* GPS row — editable inputs + clickable map link + use-my-location */}
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
                <Label htmlFor="locatordialogs-latitude" className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} id="locatordialogs-latitude"/>
              </div>
              <div>
                <Label htmlFor="locatordialogs-longitude" className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} id="locatordialogs-longitude"/>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
