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
import { lastReadingFreshness } from '@/lib/format';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, CalendarClock, ArrowUpRight } from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import { EntityHistoryChart, MeterDetailButton } from '../charts/EntityHistoryChart';
import { usePlantMeterConfig } from '../shared';
import { ReasonField, ReplaceMeterDialog } from '../locators/LocatorDialogs';

// ─── ProductMetersStat — compact active/total shown in hero stats ────────────
// BUGFIX (2026-07-24): this used to share the ['product-meters', plantId] key
// with ProductMetersCard's full-row query below. TanStack Query treats same-key
// useQuery calls as ONE shared cache entry — whichever component's queryFn last
// resolves "wins" and overwrites the data for every consumer of that key. Because
// this component's select() omits `name`, whenever it re-fetched after
// ProductMetersCard (e.g. on tab switch / window focus), every product meter in
// the Product tab would render nameless and fall back to "Product Meter N (click
// to rename)" — even though the DB still had the real name. Giving this its own
// key stops it from ever clobbering the full-projection cache entry.
export function ProductMetersStat({ plantId }: { plantId: string }) {
  const { data: meters } = useQuery({
    queryKey: ['product-meters-stat', plantId],
    queryFn: async () => {
      // Fetch status so we can count Active vs total correctly
      const { data, error } = await supabase
        .from('product_meters' as any).select('id, status').eq('plant_id', plantId);
      // status column may not exist yet — fall back to id only
      if (error?.message?.includes('status')) {
        const { data: fallback } = await supabase
          .from('product_meters' as any).select('id').eq('plant_id', plantId);
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }
      return (data ?? []) as any[];
    },
  });
  const total = meters?.length ?? 0;
  const active = (meters ?? []).filter((m: any) => (m.status ?? 'Active') === 'Active').length;
  return (
    <div>
      <div className="font-mono-num text-lg font-bold">
        <span className={active === total && total > 0 ? 'text-accent' : active > 0 ? 'text-accent' : 'opacity-70'}>{active}</span>
        <span className="opacity-40 font-normal text-base">/{total}</span>
      </div>
      <div className="opacity-40 text-2xs mt-0.5">active / total</div>
    </div>
  );
}

// ─── Product Meters Card ─────────────────────────────────────────────────────
// Matches the Locator / Well list pattern exactly:
//   - One Card per meter row
//   - Active / Inactive status pill (clickable for Manager+)
//   - Always-visible pencil (edit name) + red trash (delete with reason dialog)
//   - Header: "Product Meters (N)" + Add button + Import CSV button (Admin only)
//   - Inline add-name form below header
//   - Single-delete AlertDialog with required reason field

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

// ── Assign Locators Dialog ────────────────────────────────────────────────────
// Lets managers pick which locators a product meter supplies.
// Stores the link as `product_meter_id` on the locators row (nullable FK).
// All DB writes are best-effort: silently falls back if the column doesn't exist yet.

export function AssignLocatorsDialog({
  meter, plantId, onClose, onSaved,
}: {
  meter: any;
  plantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // BUGFIX (2026-07-24): previously keyed ['locators', plantId] — identical to
  // LocatorsList's canonical `select('*')` query. TanStack Query shares ONE cache
  // entry per key, so if this narrower/riskier query (below) ever resolved after
  // LocatorsList's, or errored out, it would silently overwrite the real locator
  // list everywhere it's used (Locators tab, this dialog, etc.) with whatever it
  // fetched — including an empty array on error. Also added a fallback for
  // is_derived/derived_from_meter_id, which only exist after the
  // 20260722_mother_meter_derived.sql migration: on an environment where that
  // migration hasn't run yet, selecting those columns errors out and `data` comes
  // back null, so `(data ?? [])` silently resolved to an empty list — which is
  // exactly the "No locators in this plant yet." / empty Locators tab symptom.
  const { data: locators, isLoading } = useQuery({
    queryKey: ['locators-assign', plantId],
    queryFn: async () => {
      let data: any, error: any;
      ({ data, error } = await supabase
        .from('locators')
        .select('id, name, status, product_meter_id, is_derived, derived_from_meter_id')
        .eq('plant_id', plantId).order('name'));
      if (error && error.message?.includes('column')) {
        // Mother-meter migration not applied yet on this DB — retry without the new columns.
        ({ data, error } = await supabase
          .from('locators')
          .select('id, name, status, product_meter_id')
          .eq('plant_id', plantId).order('name'));
        if (!error && data) {
          data = (data as any[]).map((l) => ({ ...l, is_derived: false, derived_from_meter_id: null }));
        }
      }
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // All plants — for the mirror-target picker
  const { data: allPlants } = useQuery({
    queryKey: ['all-plants'],
    queryFn: async () => {
      const { data } = await supabase.from('plants').select('id, name').order('name');
      return (data ?? []) as any[];
    },
  });

  // BUGFIX (2026-07-25): mirrorMap previously had no way to load what was
  // already saved — it only ever started as {} and was populated by onChange
  // handlers while the dialog was open. Reopening the dialog (or even just
  // the initial mount right after a successful save) always rendered "Select
  // plant" / "Select meter" regardless of what was actually persisted on
  // product_meters.derived_from_locator_id, which looked exactly like the
  // mirror target silently failing to save. This reads back any product_meters
  // row that already points derived_from_locator_id at one of this meter's
  // locators, so the dialog reflects reality on open.
  const locatorIds = (locators ?? []).map((l) => l.id);
  const { data: existingMirrors } = useQuery({
    queryKey: ['mirror-targets-for-locators', locatorIds.join(',')],
    enabled: locatorIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, plant_id, derived_from_locator_id, is_derived')
        .in('derived_from_locator_id', locatorIds);
      return (data ?? []) as Array<{ id: string; plant_id: string; derived_from_locator_id: string; is_derived: boolean }>;
    },
  });

  // Pre-select locators currently assigned to this meter
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  // is_derived state per locator (true = no physical meter, computed residual)
  const [derivedMap, setDerivedMap] = useState<Record<string, boolean>>({});
  // Mirror target per locator: { plantId, meterId }
  const [mirrorMap,  setMirrorMap]  = useState<Record<string, { plantId: string; meterId: string }>>({});
  // Per-plant meter lists for the mirror picker
  const [mirrorMeters, setMirrorMeters] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!locators) return;
    setSelected(new Set(locators.filter((l: any) => l.product_meter_id === meter.id).map((l: any) => l.id)));
    const dm: Record<string, boolean> = {};
    locators.forEach((l: any) => {
      if (l.product_meter_id === meter.id) dm[l.id] = !!l.is_derived;
    });
    setDerivedMap(dm);
  }, [locators, meter.id]);

  // Hydrate mirrorMap from existingMirrors, and preload the target plant's
  // meter list so the "Target meter" <Select> has the saved value available
  // to render (it can only show a value that's present in its options list).
  useEffect(() => {
    if (!existingMirrors?.length) return;
    const mm: Record<string, { plantId: string; meterId: string }> = {};
    for (const row of existingMirrors) {
      mm[row.derived_from_locator_id] = { plantId: row.plant_id, meterId: row.id };
    }
    setMirrorMap(prev => ({ ...mm, ...prev })); // don't clobber an in-progress edit
    const plantIds = [...new Set(existingMirrors.map(r => r.plant_id))];
    plantIds.forEach(pid => { loadMirrorMeters(pid); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingMirrors]);

  const [busy, setBusy] = useState(false);

  // Locators whose mirror target row exists (derived_from_locator_id points
  // back here) but is_derived is false on that row — the exact broken state
  // the pre-fix silent-failure bug could leave behind (see fn_set_product_
  // meter_mirror migration note and the save() comment below). Looks
  // identical to a healthy mirror in this dialog otherwise, since the
  // "Target plant/meter" selects only reflect derived_from_locator_id.
  const mirrorNeedsRepair = useMemo(
    () => new Set((existingMirrors ?? []).filter(r => !r.is_derived).map(r => r.derived_from_locator_id)),
    [existingMirrors],
  );

  // How many locators in the current selection are marked as derived?
  // The DB (partial unique index) enforces max 1, but we also guard in the UI.
  const derivedCount = [...selected].filter(id => derivedMap[id]).length;

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleDerived = (id: string, val: boolean) => {
    if (val && derivedCount >= 1 && !derivedMap[id]) {
      toast.error('Only one derived (no-meter) locator is allowed per product meter.');
      return;
    }
    setDerivedMap(prev => ({ ...prev, [id]: val }));
  };

  // Fetch meters for a mirror-target plant on demand
  const loadMirrorMeters = async (pid: string) => {
    if (mirrorMeters[pid]) return;
    const { data } = await (supabase.from('product_meters' as any) as any)
      .select('id, name').eq('plant_id', pid).order('name');
    setMirrorMeters(prev => ({ ...prev, [pid]: data ?? [] }));
  };

  const save = async () => {
    if (!locators) return;
    setBusy(true);
    const toAssign   = locators.filter((l: any) =>  selected.has(l.id) && l.product_meter_id !== meter.id);
    const toUnassign = locators.filter((l: any) => !selected.has(l.id) && l.product_meter_id === meter.id);

    try {
      // Assign selected locators to this meter (+ is_derived flag)
      //
      // BUGFIX (2026-07-30): this used to set is_derived without ever touching
      // default_input_mode, which is NOT NULL DEFAULT 'raw' on this table — so a
      // locator assigned here as derived (no physical meter) could still be left
      // rendering as a raw cumulative meter everywhere else (ReadingHistoryDialog,
      // EntityHistoryChart). trg_force_direct_mode (Phase 6) now guards this at
      // the DB layer too, but we set it explicitly here as well so the change is
      // reflected without waiting on a refetch. See
      // 20260730_hamas_phase6_default_input_mode_guard.sql for the full context.
      for (const l of toAssign) {
        const isDer = !!derivedMap[l.id];
        const payload: any = { product_meter_id: meter.id, is_derived: isDer, derived_from_meter_id: isDer ? meter.id : null };
        if (isDer) payload.default_input_mode = 'direct';
        const { error } = await supabase
          .from('locators')
          .update(payload)
          .eq('id', l.id);
        if (error && !error.message.includes('column')) throw error;
      }

      // Update is_derived flag for already-assigned locators
      for (const l of locators.filter((l: any) => selected.has(l.id) && l.product_meter_id === meter.id)) {
        const isDer = !!derivedMap[l.id];
        const wasD  = !!l.is_derived;
        if (isDer !== wasD) {
          // Keep default_input_mode in lockstep with is_derived in both directions:
          // becoming derived forces 'direct' (also DB-enforced now, see above), and
          // *leaving* derived status resets it to 'raw' — the trigger deliberately
          // does NOT do this half, since a locator coming off derived status needs
          // an admin decision, not a silent guess, but leaving it on 'direct' with
          // a real physical meter attached would be just as wrong as the original bug.
          await supabase.from('locators')
            .update({ is_derived: isDer, derived_from_meter_id: isDer ? meter.id : null, default_input_mode: isDer ? 'direct' : 'raw' } as any)
            .eq('id', l.id);
        }
      }

      // Clear product_meter_id from deselected locators
      if (toUnassign.length) {
        const { error } = await supabase.from('locators')
          .update({ product_meter_id: null, is_derived: false, derived_from_meter_id: null } as any)
          .in('id', toUnassign.map((l: any) => l.id));
        if (error && !error.message.includes('column')) throw error;

        // Same reset as above, scoped to only the ones that were actually derived —
        // a plain (never-derived) locator being unassigned here shouldn't have its
        // input mode touched at all.
        const unassignWasDerivedIds = toUnassign.filter((l: any) => l.is_derived).map((l: any) => l.id);
        if (unassignWasDerivedIds.length) {
          await supabase.from('locators')
            .update({ default_input_mode: 'raw' } as any)
            .in('id', unassignWasDerivedIds);
        }
      }

      // Set up or clear mirror product_meter targets
      // FIX (2026-07-28): this used to be a plain
      // supabase.from('product_meters').update(...) call — product_meters'
      // RLS (user_has_plant_access(plant_id)) is scoped to the TARGET row's
      // plant, not the plant this dialog is open on, so it silently matched
      // zero rows whenever the current Manager didn't separately have access
      // to the target plant (e.g. configuring SRP's HAMAS to mirror into
      // Mambaling, without also being assigned to Mambaling). No error was
      // ever thrown — "Locator assignments saved" showed regardless. Routed
      // through fn_set_product_meter_mirror (SECURITY DEFINER) instead, and
      // its result is now actually checked.
      for (const [locId, mirror] of Object.entries(mirrorMap)) {
        if (!selected.has(locId) || !derivedMap[locId]) continue;
        if (!mirror.meterId) continue;
        const { error } = await supabase.rpc('fn_set_product_meter_mirror' as any, {
          p_meter_id: mirror.meterId,
          p_derived_from_locator_id: locId,
        } as any);
        if (error) {
          throw new Error(
            `Could not wire the mirror target for "${locators.find((l: any) => l.id === locId)?.name ?? locId}": ${error.message}`,
          );
        }
      }

      toast.success('Locator assignments saved');
      onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplet className="h-4 w-4 text-primary" />
            Assign Locators
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Select locators supplied by <span className="font-medium text-foreground">{meter.name ?? 'this meter'}</span>.
          Toggle <span className="font-medium">Has physical meter</span> off for derived (residual) locators.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading locators…
          </div>
        ) : !locators?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No locators in this plant yet.</p>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {locators.map((l: any) => {
              const checked      = selected.has(l.id);
              const takenByOther = l.product_meter_id && l.product_meter_id !== meter.id;
              const isDer        = !!derivedMap[l.id];
              const mirror       = mirrorMap[l.id];

              return (
                <div key={l.id} className={`rounded-md border transition-colors ${
                  checked ? 'border-primary bg-primary-soft/60' : 'border-border'
                }`}>
                  {/* Row header — checkbox + name + "Has meter" toggle */}
                  <label className="flex items-center gap-2.5 p-2.5 cursor-pointer">
                    <Checkbox
                      checked={checked}
                      disabled={!!takenByOther && !checked}
                      onCheckedChange={() => toggle(l.id)}
                      className="shrink-0 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      {takenByOther && (
                        <div className="text-2xs text-warn">
                          Assigned to another meter
                        </div>
                      )}
                    </div>
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${l.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground/40'}`} />
                  </label>

                  {/* "Has meter" toggle — only visible when this locator is selected */}
                  {checked && (
                    <div className="border-t border-border/60 px-3 pb-2.5 pt-2 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium">Has physical meter</p>
                          <p className="text-2xs text-muted-foreground">
                            Turn off for derived locators (residual = mother meter − siblings)
                          </p>
                        </div>
                        <Switch
                          checked={!isDer}
                          onCheckedChange={(v) => toggleDerived(l.id, !v)}
                          aria-label="Has physical meter"
                        />
                      </div>

                      {/* Mirror-to-production section — only when derived */}
                      {isDer && (
                        <div className="rounded-md bg-muted/40 border border-border/60 px-2.5 py-2 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Counts as production elsewhere?
                          </p>
                          <p className="text-2xs text-muted-foreground leading-relaxed">
                            Mirror this derived value into a product meter on another plant so both plants' NRW calculations remain consistent.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-2xs">Target plant</Label>
                              <Select
                                value={mirror?.plantId ?? ''}
                                onValueChange={async (pid) => {
                                  setMirrorMap(prev => ({ ...prev, [l.id]: { plantId: pid, meterId: '' } }));
                                  await loadMirrorMeters(pid);
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select plant" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(allPlants ?? [])
                                    .filter((p: any) => p.id !== plantId)
                                    .map((p: any) => (
                                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-2xs">Target meter</Label>
                              <Select
                                value={mirror?.meterId ?? ''}
                                disabled={!mirror?.plantId}
                                onValueChange={(mid) =>
                                  setMirrorMap(prev => ({ ...prev, [l.id]: { ...prev[l.id], meterId: mid } }))
                                }
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select meter" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(mirrorMeters[mirror?.plantId ?? ''] ?? []).map((m: any) => (
                                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {/* FIX (2026-07-25): derivedCount counts this very locator (it's
                              1 as soon as Hamas itself is marked derived), so the old
                              `derivedCount > 0` check fired on every correctly-configured
                              derived locator — reading as a blocking error when nothing was
                              wrong. Only warn on a genuine conflict (shouldn't be reachable
                              given the toggleDerived guard above, but kept as a defensive
                              display check); otherwise confirm the slot is filled as expected. */}
                          {derivedCount > 1 ? (
                            <p className="text-2xs text-danger">
                              ⚠ More than one locator here is marked derived — only one is allowed per product meter. Turn the others back on ("Has physical meter").
                            </p>
                          ) : mirrorNeedsRepair.has(l.id) ? (
                            <p className="text-2xs text-danger">
                              ⚠ This mirror link is broken — the target meter isn't marked derived, so it's still showing an editable input and won't receive HAMAS-style
                              mirrored values. Click Save below to repair it.
                            </p>
                          ) : (
                            <p className="text-2xs text-muted-foreground">
                              ✓ Using this product meter's one allowed derived-locator slot.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || isLoading}>
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Product Meter Dialog ──────────────────────────────────────────────────
// Mirrors the AddWellDialog / AddLocatorDialog pattern: name + meter specs +
// GPS coordinates with "Use My Location". Extra columns are inserted best-effort
// (graceful retry without them if the DB hasn't been migrated yet).

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

    // Build full payload with all optional columns
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

    // If extra columns don't exist yet, fall back to name-only insert
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

          {/* Name */}
          <div>
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={field('name')}
              placeholder="e.g. Main Line, Secondary Line…"
              autoFocus
              data-testid="product-meter-name-input"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>

          {/* Meter details */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="text-xs font-semibold inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Meter Details
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Brand</Label>
                <Input value={form.meter_brand} onChange={field('meter_brand')} />
              </div>
              <div>
                <Label className="text-xs">Size</Label>
                <div className="relative">
                  <Input
                    type="number" min="0" step="0.5"
                    value={form.meter_size} onChange={field('meter_size')}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
                </div>
              </div>
              <div>
                <Label className="text-xs">Serial</Label>
                <Input value={form.meter_serial} onChange={field('meter_serial')} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Installed Date</Label>
              <Input type="date" value={form.meter_installed_date} onChange={field('meter_installed_date')} />
            </div>
          </div>

          {/* GPS */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>GPS Coordinates</Label>
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
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.295" value={form.gps_lat} onChange={field('gps_lat')} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.877" value={form.gps_lng} onChange={field('gps_lng')} />
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

export function ProductMetersCard({ plant, highlightId }: { plant: any; highlightId?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isManager, isAdmin, user } = useAuth();
  const canEdit = isManager || isAdmin;

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: meters, isLoading, isFetching } = useQuery({
    queryKey: ['product-meters', plant.id],
    // staleTime/gcTime: 0 — always fetch fresh from DB on mount; prevents
    // stale null-name rows being served from the in-memory React Query cache
    // after a DB fix. placeholderData removed for the same reason.
    //
    // is_derived is selected in every branch below (added while chasing a
    // "HAMAS's own Historical Consumption chart doesn't match its History
    // dialog" bug): m.is_derived feeds defaultInputMode={m.is_derived ?
    // 'direct' : 'raw'} on this file's own <EntityHistoryChart> below, which
    // is what tells that chart to use HAMAS's current_reading as-is instead
    // of diffing it against the prior day. Without it here, m.is_derived was
    // always undefined regardless of the real DB value, so the chart's
    // "Mother Meter" bars silently fell back to raw delta mode — HAMAS
    // resets previous_reading to 0 every sweep run (see
    // fn_sweep_derived_meters_for_date), so that diff is close to
    // meaningless day to day, which is exactly the small/noisy bars that
    // didn't line up with the correct values already shown in the History
    // dialog (ProductSection.tsx, which reads is_derived from its own
    // separately-scoped query and has always gotten this right).
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const METER_COLS = 'meter_brand, meter_size, meter_serial, meter_installed_date';
      const missingMeterCols = (msg?: string | null) => !!msg && (
        msg.includes('meter_brand') || msg.includes('meter_size') ||
        msg.includes('meter_serial') || msg.includes('meter_installed_date')
      );

      // Try full schema first (status + sort_order + meter identity columns all present)
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select(`id, name, status, sort_order, is_derived, ${METER_COLS}, created_at`)
        .eq('plant_id', plant.id)
        .order('sort_order', { ascending: true });

      // Meter identity columns missing (pre-2026-07-27 migration DB) → retry without them
      if (missingMeterCols(error?.message)) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, sort_order, is_derived, created_at')
          .eq('plant_id', plant.id)
          .order('sort_order', { ascending: true }));
      }

      // sort_order column missing → retry without it
      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select(`id, name, status, is_derived, ${METER_COLS}, created_at`)
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true }));
        if (missingMeterCols(error?.message)) {
          ({ data, error } = await supabase
            .from('product_meters' as any)
            .select('id, name, status, is_derived, created_at')
            .eq('plant_id', plant.id)
            .order('created_at', { ascending: true }));
        }
      }

      // status column missing (not yet migrated) → fetch without it, default to 'Active'
      if (error?.message?.includes('status')) {
        const initialFallback = await supabase
          .from('product_meters' as any)
          .select(`id, name, is_derived, ${METER_COLS}, created_at`)
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true });
        let fallback = initialFallback.data;
        const fbError = initialFallback.error;
        if (missingMeterCols(fbError?.message)) {
          ({ data: fallback } = await supabase
            .from('product_meters' as any)
            .select('id, name, is_derived, created_at')
            .eq('plant_id', plant.id)
            .order('created_at', { ascending: true }));
        }
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }

      return (data ?? []) as any[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['product-meters', plant.id] });
    qc.invalidateQueries({ queryKey: ['product-meters-stat', plant.id] });
    qc.invalidateQueries({ queryKey: ['locators-fed-by-product-meters', plant.id] });
    qc.invalidateQueries({ queryKey: ['locator-dialog-product-meters', plant.id] });
  };

  // Locators for this plant — used to show which locators each meter supplies
  // BUGFIX (2026-07-24): renamed from the shared ['locators', plant.id] key — see
  // AssignLocatorsDialog above for why reusing that key was corrupting the
  // Locators tab. Also guards against is_derived not existing yet on this DB.
  const { data: plantLocators } = useQuery({
    queryKey: ['product-meters-plant-locators', plant.id],
    queryFn: async () => {
      let data: any, error: any;
      ({ data, error } = await supabase.from('locators').select('id, name, status, product_meter_id, is_derived, default_input_mode').eq('plant_id', plant.id).order('name'));
      if (error && error.message?.includes('column')) {
        ({ data, error } = await supabase.from('locators').select('id, name, status, product_meter_id').eq('plant_id', plant.id).order('name'));
        if (!error && data) data = (data as any[]).map((l) => ({ ...l, is_derived: false, default_input_mode: 'raw' }));
      }
      return (data ?? []) as any[];
    },
  });

  // Latest meter replacement per product meter — powers the "Last Replaced
  // By" / "Replacement Date" fields in each meter's MeterDetailButton popup.
  // Fetched once for the whole plant (not per-card) and indexed client-side,
  // matching the pattern above for plantLocators.
  const { data: meterReplacements } = useQuery({
    queryKey: ['product-meter-replacements', plant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_meter_replacements' as any)
        .select('*, replacer:user_profiles!product_meter_replacements_replaced_by_fkey(first_name,last_name)')
        .eq('plant_id', plant.id)
        .order('replacement_date', { ascending: false });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
  const latestReplacementByMeter = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of meterReplacements ?? []) {
      if (!map[r.meter_id]) map[r.meter_id] = r;
    }
    return map;
  }, [meterReplacements]);

  // "Last reading" per meter, for the freshness badge — same view + shared
  // lastReadingFreshness() thresholds as the Operations Product tab.
  const { data: latestMeterReadings } = useQuery({
    queryKey: ['product-meters-latest-readings', plant.id],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meter_readings_latest' as any) as any)
        .select('meter_id, reading_datetime')
        .eq('plant_id', plant.id);
      return (data ?? []) as { meter_id: string; reading_datetime: string }[];
    },
  });
  const latestDtByMeter = useMemo(() => {
    const map: Record<string, string> = {};
    latestMeterReadings?.forEach(r => { map[r.meter_id] = r.reading_datetime; });
    return map;
  }, [latestMeterReadings]);

  // Scroll to and briefly highlight the card linked to from Operations.
  const meterCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [meterPulseId, setMeterPulseId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightId) return;
    const el = meterCardRefs.current[highlightId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMeterPulseId(highlightId);
    const t = setTimeout(() => setMeterPulseId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightId, meters]);

  // ── Add meter ─────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]           = useState(false);
  const [assignTarget, setAssignTarget] = useState<any>(null);
  const [replaceMeterTarget, setReplaceMeterTarget] = useState<any | null>(null);
  const [selectedMeter, setSelectedMeter] = useState<string | null>(null);

  // ── Delete meter (with reason dialog, matching Locator pattern) ───────────
  const [deleteTarget, setDeleteTarget]   = useState<any | null>(null);
  const [deleteReason, setDeleteReason]   = useState('');
  const [deleteBusy, setDeleteBusy]       = useState(false);

  const doDelete = async () => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 5) { toast.error('Reason must be at least 5 characters.'); return; }
    setDeleteBusy(true);
    await supabase.from('product_meter_readings' as any).delete().eq('meter_id', deleteTarget.id);
    const { error } = await supabase.from('product_meters' as any).delete().eq('id', deleteTarget.id);
    setDeleteBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plant.id, meter_id: deleteTarget.id,
      meter_name: deleteTarget.name, old_value: deleteTarget.name, new_value: null,
      user_id: user?.id ?? null, timestamp: new Date().toISOString(),
    });
    toast.success(`"${deleteTarget.name}" deleted`);
    setDeleteTarget(null); setDeleteReason('');
    invalidate();
    // Deleting a meter must also clear it from the Dashboard stat cards,
    // TrendChart production series, and the DataSummaryModal Production tab.
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['dsm-prod-readings'] });
    qc.invalidateQueries({ queryKey: ['dsm-product-meters'] });
    qc.invalidateQueries();
  };

  // ── Toggle Active / Inactive ──────────────────────────────────────────────
  const toggleStatus = async (m: any) => {
    if (!canEdit) return;
    const next = (m.status ?? 'Active') === 'Active' ? 'Inactive' : 'Active';
    const { error } = await supabase
      .from('product_meters' as any).update({ status: next } as any).eq('id', m.id);
    if (error?.message?.includes('status')) {
      toast.error('Status column not yet available — run the migration SQL in Supabase first.');
      return;
    }
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plant.id, meter_id: m.id, meter_name: m.name,
      old_value: m.status, new_value: next,
      user_id: user?.id ?? null, timestamp: new Date().toISOString(),
    });
    toast.success(`Meter marked ${next}`);
    invalidate();
    qc.invalidateQueries({ queryKey: ['product-meters-active', plant.id] });
  };

  return (
    <div className="space-y-2">
      {/* ── Header row ── */}
      <div className="relative flex justify-between items-center gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Product Meters ({meters?.length ?? 0})
        </h3>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <Button
              size="sm"
              className="h-7 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
              onClick={() => setAddOpen(true)}
              data-testid="add-product-meter-btn"
            >
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          )}
        </div>
      </div>

      {/* ── First-load spinner ── */}
      {isLoading && !meters && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      )}

      {/* Subtle refetch dot — never displaces list items */}
      {isFetching && !!meters && (
        <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
      )}

      {/* ── Meter cards — clickable to view history ── */}
      <div className="stagger-grid space-y-2">
      {meters?.map((m: any, idx: number) => (
        <Card
          key={m.id}
          ref={(el) => { meterCardRefs.current[m.id] = el; }}
          className={`p-3 card-interactive border-l-2 ${
            (m.status ?? 'Active') === 'Active'
              ? 'border-l-accent'
              : 'border-l-muted-foreground/30'
          } ${meterPulseId === m.id ? 'ring-2 ring-accent shadow-elev' : ''}`}
          data-testid={`product-meter-card-${m.id}`}
        >
          {(() => {
          // Locators this meter supplies ("siblings" — AssignLocatorsDialog's
          // product_meter_id link). Computed once per card and reused by both
          // the chip badges below and the Historical Consumption chart's
          // sibling-total + NRW% overlay.
          const supplied = (plantLocators ?? []).filter((l: any) => l.product_meter_id === m.id);
          return (
          <>
          <div className="flex items-start gap-2">
            <div
              role="button"
              tabIndex={0}
              className="flex-1 min-w-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 rounded"
              onClick={() => setSelectedMeter(selectedMeter === m.id ? null : m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMeter(selectedMeter === m.id ? null : m.id); }
              }}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <ProductMeterNameInline
                    meter={m} plantId={plant.id} userId={user?.id ?? null}
                    canEdit={canEdit} onChanged={invalidate} fallbackIndex={idx + 1}
                  />
                  <div className="text-xs text-muted-foreground">
                    Product Meter · {(m.status ?? 'Active') === 'Active' ? 'Reading active' : 'Inactive'}
                  </div>
                  {/* "Last reading" freshness + cross-navigation to this
                      meter's row in Operations. stopPropagation so it
                      doesn't also toggle the card's own history view. */}
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const fresh = lastReadingFreshness(latestDtByMeter[m.id]);
                      return (
                        <StatusPill tone={fresh.tone}>
                          <CalendarClock className="h-2.5 w-2.5" />
                          {fresh.label}
                        </StatusPill>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => navigate(`/operations?tab=product&highlight=${m.id}`)}
                      title="Open this meter in Operations"
                      aria-label="Open this meter in Operations"
                      className="inline-flex items-center gap-0.5 text-2xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 px-1.5 py-0.5 rounded-full transition-colors"
                    >
                      <ArrowUpRight className="h-2.5 w-2.5" />
                      Operations
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (canEdit) toggleStatus(m); }}
                    title={canEdit ? `Click to toggle (currently ${m.status ?? 'Active'})` : (m.status ?? 'Active')}
                    className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                      (m.status ?? 'Active') === 'Active'
                        ? 'text-accent bg-accent-soft border-accent hover:bg-accent-soft'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                    } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${(m.status ?? 'Active') === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
                    {m.status ?? 'Active'}
                  </button>
                  <TrendingUp className={`h-3.5 w-3.5 transition-colors ${selectedMeter === m.id ? 'text-primary' : 'text-muted-foreground/40'}`} />
                </div>
              </div>

              {/* ── Supplied locators chips ── */}
              {(() => {
                if (!supplied.length) return (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Droplet className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground/60 italic">No locators assigned</span>
                  </div>
                );
                const visible  = supplied.slice(0, 3);
                const overflow = supplied.length - 3;
                return (
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <Droplet className="h-3 w-3 text-primary shrink-0" />
                    {visible.map((l: any) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/plants/${plant.id}?tab=locators&highlight=${l.id}`);
                        }}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs border transition-colors ${
                          l.is_derived
                            ? 'bg-warn-soft text-warn border-warn hover:bg-warn-soft/70'
                            : 'bg-primary-soft text-primary border-primary hover:bg-primary-soft/70'
                        }`} title={l.is_derived ? `${l.name} — derived (no physical meter; residual computed by cron sweep). Click to open in Locators.` : `${l.name} — click to open in Locators`}>
                        {l.is_derived && <span className="font-bold opacity-70">~</span>}
                        {l.name}
                      </button>
                    ))}
                    {overflow > 0 && (
                      <span className="text-2xs text-muted-foreground">+{overflow} more</span>
                    )}
                  </div>
                );
              })()}
            </div>
            {canEdit && (
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Assign locators */}
                <Button
                  size="sm" variant="ghost"
                  className="h-7 w-7 p-0 rounded-full text-primary hover:text-primary/90 hover:bg-primary-soft"
                  title="Assign locators"
                  onClick={() => setAssignTarget(m)}
                  data-testid={`assign-locators-${m.id}`}
                >
                  <Droplet className="h-3.5 w-3.5" />
                </Button>
                <ProductMeterNameInline.EditTrigger meter={m} plantId={plant.id} userId={user?.id ?? null} canEdit={canEdit} onChanged={invalidate} />
                <Button
                  size="sm" variant="ghost"
                  className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  title="Delete"
                  onClick={() => { setDeleteTarget(m); setDeleteReason(''); }}
                  data-testid={`delete-product-meter-${m.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          {/* Expandable: meter identity + history chart */}
          {selectedMeter === m.id && (
            <div className="mt-3 pt-3 border-t space-y-3" onClick={(e) => e.stopPropagation()}>
              <MeterDetailButton
                label="Product Meter"
                icon={<Gauge className="h-4 w-4 text-info" />}
                fields={[
                  { label: 'Brand', value: m.meter_brand },
                  { label: 'Size', value: m.meter_size ? `${m.meter_size} in` : null },
                  { label: 'Serial No.', value: m.meter_serial },
                  { label: 'Installed', value: m.meter_installed_date },
                  {
                    label: 'Last Replaced By',
                    value: latestReplacementByMeter[m.id]?.replacer
                      ? [latestReplacementByMeter[m.id].replacer.first_name, latestReplacementByMeter[m.id].replacer.last_name].filter(Boolean).join(' ')
                      : null,
                  },
                  { label: 'Replacement Date', value: latestReplacementByMeter[m.id]?.replacement_date },
                ]}
              >
                {canEdit && (
                  <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setReplaceMeterTarget(m)}>
                    <ChangeMeterIcon className="h-3.5 w-3.5" /> Replace Meter
                  </Button>
                )}
              </MeterDetailButton>
              <EntityHistoryChart
                entityId={m.id}
                entityType="product_meter"
                entityName={m.name ?? 'Meter'}
                defaultInputMode={m.is_derived ? 'direct' : 'raw'}
                siblingLocators={supplied.map((l: any) => ({
                  id: l.id,
                  name: l.name,
                  defaultInputMode: l.default_input_mode === 'direct' ? 'direct' : 'raw',
                }))}
              />
            </div>
          )}
          </>
          );
          })()}
        </Card>
      ))}

      {meters && meters.length === 0 && !isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No product meters yet.{canEdit ? ' Click Add to create one.' : ''}
        </Card>
      )}
      </div>

      {/* ── Add meter dialog ── */}
      {addOpen && (
        <AddProductMeterDialog
          plantId={plant.id}
          meterCount={meters?.length ?? 0}
          userId={user?.id ?? null}
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); invalidate(); }}
        />
      )}

      {/* ── Replace meter dialog ── */}
      {replaceMeterTarget && (
        <ReplaceMeterDialog
          kind="product"
          assetId={replaceMeterTarget.id}
          plantId={plant.id}
          oldSerial={replaceMeterTarget.meter_serial}
          onClose={() => {
            setReplaceMeterTarget(null);
            invalidate();
            qc.invalidateQueries({ queryKey: ['product-meter-replacements', plant.id] });
          }}
        />
      )}

      {/* ── Assign locators dialog ── */}
      {assignTarget && (
        <AssignLocatorsDialog
          meter={assignTarget}
          plantId={plant.id}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null);
            // Refresh the canonical Locators-tab list (LocatorsList.tsx) and this
            // card's own "supplied locators" chip data — both changed because
            // product_meter_id/is_derived were just written.
            qc.invalidateQueries({ queryKey: ['locators', plant.id] });
            qc.invalidateQueries({ queryKey: ['product-meters-plant-locators', plant.id] });
          }}
        />
      )}

      {/* ── Single delete confirm dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleteBusy && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete "{deleteTarget?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All readings for this product meter will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ReasonField value={deleteReason} onChange={setDeleteReason} testId="product-meter-delete-reason" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={deleteBusy || deleteReason.trim().length < 5}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── ProductMeterNameInline — inline rename field inside the card ──────────────
// Matches the pencil-edit pattern used in EditLocatorDialog / EditWellDialog.
// The edit pencil button is exposed as a static property so ProductMetersCard
// can place it in the same icon-button row as the delete button.

function ProductMeterNameInlineBase({
  meter, plantId, userId, canEdit, onChanged, fallbackIndex,
}: {
  meter: any; plantId: string; userId: string | null; canEdit: boolean; onChanged: () => void; fallbackIndex?: number;
}) {
  const [editing, setEditing]       = useState(false);
  const [nameInput, setNameInput]   = useState(meter.name ?? '');
  const [busy, setBusy]             = useState(false);

  useEffect(() => {
    if (!editing) setNameInput(meter.name ?? '');
  }, [meter.name, editing]);

  const saveName = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('product_meters' as any).update({ name: nameInput.trim() } as any).eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plantId, meter_id: meter.id, meter_name: nameInput.trim(),
      old_value: meter.name, new_value: nameInput.trim(),
      user_id: userId, timestamp: new Date().toISOString(),
    });
    toast.success('Meter renamed');
    setEditing(false); onChanged();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 flex-1">
        <Input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          className="h-7 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') { setEditing(false); setNameInput(meter.name ?? ''); }
          }}
          autoFocus
        />
        <Button size="sm" className="h-7 px-2 text-xs bg-primary hover:bg-primary/90 text-white" onClick={saveName} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={() => { setEditing(false); setNameInput(meter.name ?? ''); }}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="font-medium text-sm truncate">
      {meter.name?.trim()
        ? meter.name
        : canEdit
          ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="italic text-warn hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title="No name set — click to rename"
            >
              Product Meter {fallbackIndex ?? ''} (click to rename)
            </button>
          )
          : <span className="text-muted-foreground">Product Meter {fallbackIndex ?? ''}</span>
      }
    </div>
  );
}

// Attach the edit-trigger button as a static property so the card can
// render it in the action-button group without prop-drilling editing state.
// We use a separate tiny component for the trigger.
function PMEditTriggerBase({
  meter, plantId, userId, canEdit, onChanged,
}: {
  meter: any; plantId: string; userId: string | null; canEdit: boolean; onChanged: () => void;
}) {
  // The actual editing state lives in ProductMetersCard via ProductMeterNameInline;
  // here we just need a pencil button. Because inline editing is tricky to share
  // without lifting state, we keep it simple: clicking pencil opens an AlertDialog
  // rename prompt — consistent with how Edit works across the rest of the app.
  const [open, setOpen]           = useState(false);
  const [nameInput, setNameInput] = useState(meter.name ?? '');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    if (!open) setNameInput(meter.name ?? '');
  }, [meter.name, open]);

  const save = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    const { error } = await supabase
      .from('product_meters' as any).update({ name: nameInput.trim() } as any).eq('id', meter.id);
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    await logProductMeterAudit({
      plant_id: plantId, meter_id: meter.id, meter_name: nameInput.trim(),
      old_value: meter.name, new_value: nameInput.trim(),
      user_id: userId, timestamp: new Date().toISOString(),
    });
    toast.success('Meter renamed');
    // Call onChanged (invalidate) BEFORE closing the dialog.
    // Calling it after setOpen(false) can race with React's Dialog unmount
    // cleanup, causing the invalidation to be dropped mid-teardown.
    onChanged();
    setOpen(false);
  };

  return (
    <>
      <Button
        size="sm" variant="ghost"
        className="h-7 w-7 p-0 rounded-full"
        title="Rename"
        onClick={() => setOpen(true)}
        data-testid={`rename-product-meter-${meter.id}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Product Meter</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-xs">Meter Name</Label>
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Main Line, Secondary Line…"
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy || !nameInput.trim()}>
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Attach EditTrigger as static property on the display component
export const ProductMeterNameInline = Object.assign(ProductMeterNameInlineBase, {
  EditTrigger: PMEditTriggerBase,
});

// ─── Plant Meter Config — shared type & hook ─────────────────────────────────
// Stored in `plant_meter_config` table (plant_id PK, config jsonb, updated_at).
// Falls back to sensible defaults so existing data keeps working unchanged.

