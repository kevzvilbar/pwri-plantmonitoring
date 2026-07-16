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
import { format } from 'date-fns';


import { EntityHistoryChart } from '../charts/EntityHistoryChart';
import { usePlantMeterConfig } from '../shared';

// ─── ProductMetersStat — compact active/total shown in hero stats ────────────
export function ProductMetersStat({ plantId }: { plantId: string }) {
  const { data: meters } = useQuery({
    queryKey: ['product-meters', plantId],
    queryFn: async () => {
      // Fetch status so we can count Active vs total correctly
      let { data, error } = await supabase
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
        <span className={active === total && total > 0 ? 'text-emerald-300' : active > 0 ? 'text-emerald-300' : 'opacity-70'}>{active}</span>
        <span className="opacity-40 font-normal text-base">/{total}</span>
      </div>
      <div className="opacity-40 text-[10px] mt-0.5">active / total</div>
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
  const { data: locators, isLoading } = useQuery({
    queryKey: ['locators', plantId],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name, status, product_meter_id').eq('plant_id', plantId).order('name');
      return (data ?? []) as any[];
    },
  });

  // Pre-select locators currently assigned to this meter
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!locators) return;
    setSelected(new Set(locators.filter((l: any) => l.product_meter_id === meter.id).map((l: any) => l.id)));
  }, [locators, meter.id]);

  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    if (!locators) return;
    setBusy(true);
    const toAssign   = locators.filter((l: any) => selected.has(l.id) && l.product_meter_id !== meter.id);
    const toUnassign = locators.filter((l: any) => !selected.has(l.id) && l.product_meter_id === meter.id);

    try {
      // Assign selected locators to this meter
      if (toAssign.length) {
        const { error } = await supabase
          .from('locators')
          .update({ product_meter_id: meter.id } as any)
          .in('id', toAssign.map((l: any) => l.id));
        if (error && !error.message.includes('column')) throw error;
      }
      // Clear product_meter_id from deselected locators previously linked here
      if (toUnassign.length) {
        const { error } = await supabase
          .from('locators')
          .update({ product_meter_id: null } as any)
          .in('id', toUnassign.map((l: any) => l.id));
        if (error && !error.message.includes('column')) throw error;
      }
      toast.success('Locator assignments saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplet className="h-4 w-4 text-teal-600" />
            Assign Locators
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Select which locators are supplied by <span className="font-medium text-foreground">{meter.name ?? 'this meter'}</span>.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading locators…
          </div>
        ) : !locators?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No locators in this plant yet.</p>
        ) : (
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {locators.map((l: any) => {
              const checked = selected.has(l.id);
              const takenByOther = l.product_meter_id && l.product_meter_id !== meter.id;
              return (
                <label
                  key={l.id}
                  className={`flex items-center gap-2.5 p-2 rounded-md border cursor-pointer transition-colors ${
                    checked
                      ? 'border-teal-300 bg-teal-50/60 dark:border-teal-700 dark:bg-teal-950/20'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(l.id)}
                    className="shrink-0 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{l.name}</div>
                    {takenByOther && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400">
                        Currently assigned to another meter
                      </div>
                    )}
                  </div>
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${l.status === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                </label>
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
    } catch (e: any) {
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
    if (error) { toast.error(error.message); return; }

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

export function ProductMetersCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager, isAdmin, user } = useAuth();
  const canEdit = isManager || isAdmin;

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: meters, isLoading, isFetching } = useQuery({
    queryKey: ['product-meters', plant.id],
    // staleTime/gcTime: 0 — always fetch fresh from DB on mount; prevents
    // stale null-name rows being served from the in-memory React Query cache
    // after a DB fix. placeholderData removed for the same reason.
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      // Try full schema first (status + sort_order both present)
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, status, sort_order, created_at')
        .eq('plant_id', plant.id)
        .order('sort_order', { ascending: true });

      // sort_order column missing → retry without it
      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, created_at')
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true }));
      }

      // status column missing (not yet migrated) → fetch without it, default to 'Active'
      if (error?.message?.includes('status')) {
        let fallback;
        ({ data: fallback } = await supabase
          .from('product_meters' as any)
          .select('id, name, created_at')
          .eq('plant_id', plant.id)
          .order('created_at', { ascending: true }));
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }

      return (data ?? []) as any[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['product-meters', plant.id] });

  // Locators for this plant — used to show which locators each meter supplies
  const { data: plantLocators } = useQuery({
    queryKey: ['locators', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, name, status, product_meter_id').eq('plant_id', plant.id).order('name');
      return (data ?? []) as any[];
    },
  });

  // ── Add meter ─────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]           = useState(false);
  const [assignTarget, setAssignTarget] = useState<any>(null);
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
    if (error) { toast.error(error.message); return; }
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
    if (error) { toast.error(error.message); return; }
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
        <span className="absolute top-0 right-0 h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" aria-hidden />
      )}

      {/* ── Meter cards — clickable to view history ── */}
      {meters?.map((m: any, idx: number) => (
        <Card
          key={m.id}
          className={`p-3 hover:shadow-elev transition-shadow border-l-2 ${
            (m.status ?? 'Active') === 'Active'
              ? 'border-l-emerald-400 dark:border-l-emerald-600'
              : 'border-l-muted-foreground/30'
          }`}
          data-testid={`product-meter-card-${m.id}`}
        >
          <div className="flex items-start gap-2">
            <div
              className="flex-1 min-w-0 cursor-pointer"
              onClick={() => setSelectedMeter(selectedMeter === m.id ? null : m.id)}
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
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); canEdit && toggleStatus(m); }}
                    title={canEdit ? `Click to toggle (currently ${m.status ?? 'Active'})` : (m.status ?? 'Active')}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                      (m.status ?? 'Active') === 'Active'
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100'
                        : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                    } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${(m.status ?? 'Active') === 'Active' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                    {m.status ?? 'Active'}
                  </button>
                  <TrendingUp className={`h-3.5 w-3.5 transition-colors ${selectedMeter === m.id ? 'text-teal-600' : 'text-muted-foreground/40'}`} />
                </div>
              </div>

              {/* ── Supplied locators chips ── */}
              {(() => {
                const supplied = (plantLocators ?? []).filter((l: any) => l.product_meter_id === m.id);
                if (!supplied.length) return (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Droplet className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-[11px] text-muted-foreground/60 italic">No locators assigned</span>
                  </div>
                );
                const visible  = supplied.slice(0, 3);
                const overflow = supplied.length - 3;
                return (
                  <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                    <Droplet className="h-3 w-3 text-teal-500 shrink-0" />
                    {visible.map((l: any) => (
                      <span key={l.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                        {l.name}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-muted-foreground">+{overflow} more</span>
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
                  className="h-7 w-7 p-0 rounded-full text-teal-600 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
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
          {/* Expandable history chart */}
          {selectedMeter === m.id && (
            <div className="mt-3 pt-3 border-t">
              <EntityHistoryChart entityId={m.id} entityType="product_meter" entityName={m.name ?? 'Meter'} />
            </div>
          )}
        </Card>
      ))}

      {meters && meters.length === 0 && !isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          No product meters yet.{canEdit ? ' Click Add to create one.' : ''}
        </Card>
      )}

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

      {/* ── Assign locators dialog ── */}
      {assignTarget && (
        <AssignLocatorsDialog
          meter={assignTarget}
          plantId={plant.id}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null);
            qc.invalidateQueries({ queryKey: ['locators', plant.id] });
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

function _ProductMeterNameInline({
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
    if (error) { toast.error(error.message); return; }
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
        <Button size="sm" className="h-7 px-2 text-xs bg-teal-600 hover:bg-teal-700 text-white" onClick={saveName} disabled={busy}>
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
              className="italic text-amber-600 dark:text-amber-400 hover:underline focus:outline-none"
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
function _PMEditTrigger({
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
    if (error) { toast.error(error.message); return; }
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
export const ProductMeterNameInline = Object.assign(_ProductMeterNameInline, {
  EditTrigger: _PMEditTrigger,
});

// ─── Plant Meter Config — shared type & hook ─────────────────────────────────
// Stored in `plant_meter_config` table (plant_id PK, config jsonb, updated_at).
// Falls back to sensible defaults so existing data keeps working unchanged.

