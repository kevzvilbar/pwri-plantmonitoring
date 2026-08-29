import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import { parseCsv, downloadTemplate, CsvPreviewTable, logStatusChange } from '../shared';

export function ReasonField({
  value, onChange, testId,
}: { value: string; onChange: (v: string) => void; testId: string }) {
  const tooShort = value.length > 0 && value.trim().length < 5;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="locatordialogs-reason-min-5-chars-required-for-audit-log" className="text-xs text-muted-foreground">
        Reason <span className="text-danger">*</span>
        <span className="ml-1 text-2xs">(min 5 chars — required for audit log)</span>
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Decommissioned after Q1 2026 inspection"
        maxLength={500}
        rows={2}
        data-testid={testId}
        aria-invalid={tooShort}
        className={tooShort ? 'border-danger' : ''}
      id="locatordialogs-reason-min-5-chars-required-for-audit-log"/>
      {tooShort && (
        <p className="text-2xs text-danger">
          Reason must be at least 5 characters ({value.trim().length}/5).
        </p>
      )}
    </div>
  );
}

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


export function ReplaceMeterDialog({
  kind, assetId, plantId, oldSerial, readingId, onSuccess, onClose,
}: {
  kind: 'locator' | 'well' | 'product';
  assetId: string;
  plantId: string;
  oldSerial: string | null;
  /** When passed, this specific reading is flagged is_meter_replacement = true
   *  once the replacement record + asset update succeed — lets the row that
   *  triggered "Replace meter" be marked without a separate manual toggle. */
  readingId?: string;
  /** Called after a successful save. Receives the entered new-meter initial
   *  reading (so a live entry form can prefill its input) and the id of the
   *  replacement record just inserted (so the entry form can link it back to
   *  the actual reading once that reading is saved). Callers that don't need
   *  either value can keep using a plain `() => {...}` — TS allows passing a
   *  handler with fewer params than the declared callback type. */
  onSuccess?: (info?: { newInitialReading: number | null; replacementId: string | null }) => void;
  onClose: () => void;
}) {
  const { user, activeOperator } = useAuth();
  const [form, setForm] = useState({
    replacement_date: format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: '', new_brand: '', new_size: '', new_serial: '', new_initial_reading: '', new_installed_date: format(new Date(), 'yyyy-MM-dd'), remarks: '',
  });
  const submit = async () => {
    // Required: new serial (who's now installed), the old meter's last reading,
    // the new meter's starting reading, and the date it happened — without
    // these the replacement record can't actually zero the delta correctly or
    // tell anyone later what the swap was.
    if (!form.new_serial) { toast.error('New serial required'); return; }
    if (!form.old_final_reading) { toast.error("Old meter's final reading is required"); return; }
    if (!form.new_initial_reading) { toast.error("New meter's initial reading is required"); return; }
    if (!form.replacement_date) { toast.error('Date changed is required'); return; }
    const payload: any = {
      plant_id: plantId, replacement_date: form.replacement_date,
      reading_id: readingId ?? null,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    let replacementTable: 'locator_meter_replacements' | 'well_meter_replacements' | 'product_meter_replacements';
    let assetTable: 'locators' | 'wells' | 'product_meters';
    if (kind === 'locator' || kind === 'product') {
      Object.assign(payload, {
        [kind === 'locator' ? 'locator_id' : 'meter_id']: assetId,
        old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
        new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_meter_installed_date: form.new_installed_date,
      });
      replacementTable = kind === 'locator' ? 'locator_meter_replacements' : 'product_meter_replacements';
      assetTable = kind === 'locator' ? 'locators' : 'product_meters';
    } else {
      Object.assign(payload, {
        well_id: assetId, old_serial: oldSerial, old_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_brand: form.new_brand, new_size: form.new_size, new_serial: form.new_serial,
        new_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_installed_date: form.new_installed_date,
      });
      replacementTable = 'well_meter_replacements';
      assetTable = 'wells';
    }
    const { data: inserted, error } = await supabase.from(replacementTable as any).insert(payload).select('id').single();
    if (error) { toast.error(friendlyError(error)); return; }
    await supabase.from(assetTable as any).update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);

    if (readingId) {
      const readingTable = kind === 'locator' ? 'locator_readings' : kind === 'well' ? 'well_readings' : 'product_meter_readings';
      const { error: flagError } = await (supabase.from(readingTable as any) as any)
        .update({ is_meter_replacement: true })
        .eq('id', readingId);
      // Non-fatal: the replacement record + asset update already succeeded —
      // surface a toast but don't block onSuccess/onClose over a flag write.
      if (flagError) toast.error(`Meter replaced, but couldn't flag the reading: ${friendlyError(flagError)}`);
    }

    toast.success('Meter replaced');
    onSuccess?.({
      newInitialReading: form.new_initial_reading ? +form.new_initial_reading : null,
      replacementId: (inserted as any)?.id ?? null,
    });
    onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace meter</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-date-changed">Date changed *</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} id="locatordialogs-date-changed"/></div>
            <div><Label htmlFor="locatordialogs-old-meter-s-final-reading">Old meter's final reading *</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} id="locatordialogs-old-meter-s-final-reading"/></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="locatordialogs-new-brand">New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} id="locatordialogs-new-brand"/></div>
            <div><Label htmlFor="locatordialogs-new-size">New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} id="locatordialogs-new-size"/></div>
            <div><Label htmlFor="locatordialogs-new-serial">New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} id="locatordialogs-new-serial"/></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="locatordialogs-new-meter-s-initial-reading">New meter's initial reading *</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} id="locatordialogs-new-meter-s-initial-reading"/></div>
            <div><Label htmlFor="locatordialogs-installed-date">Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} id="locatordialogs-installed-date"/></div>
          </div>
          <div><Label htmlFor="locatordialogs-remarks">Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} id="locatordialogs-remarks"/></div>
        </div>
        <DialogFooter><Button onClick={submit}>Save replacement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export const LOCATOR_CSV_HEADERS = [
  'name', 'address',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'gps_lat', 'gps_lng',
];

export function LocatorCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCsv(ev.target?.result as string);
      setRows(parsed);
      setErrors([]);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const errs: string[] = [];
    rows.forEach((r, i) => { if (!r.name?.trim()) errs.push(`Row ${i + 1}: name is required`); });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const payload = rows.map(r => ({
      plant_id: plantId,
      name: r.name.trim(),
      address: r.address || null,
      location_desc: r.address || null,
      meter_brand: r.meter_brand || null,
      meter_size: r.meter_size ? r.meter_size : null,
      meter_serial: r.meter_serial || null,
      meter_installed_date: r.meter_installed_date || null,
      gps_lat: r.gps_lat ? +r.gps_lat : null,
      gps_lng: r.gps_lng ? +r.gps_lng : null,
    }));
    const { error } = await supabase.from('locators').insert(payload);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} locator(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Locators from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate('locators_template.csv', LOCATOR_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{LOCATOR_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>name</strong> is required. All others optional.</p>
          </div>
          <div>
            <p className="text-xs font-medium">Select CSV file</p>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary group-hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <Upload className="h-3.5 w-3.5" />
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-primary font-medium">{rows.length} row(s) ready</span>
                  : <span className="text-xs text-muted-foreground">No file chosen</span>}
              </label>
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{rows.length} row(s) parsed</p>
              <CsvPreviewTable rows={rows} headers={LOCATOR_CSV_HEADERS} />
            </>
          )}
          {errors.length > 0 && (
            <div className="rounded bg-destructive/10 border border-destructive/30 p-2 space-y-0.5">
              {errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || !rows.length}>
            {busy ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importing…</> : `Import ${rows.length || ''} Rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Well CSV Import ──────────────────────────────────────────────────────────

