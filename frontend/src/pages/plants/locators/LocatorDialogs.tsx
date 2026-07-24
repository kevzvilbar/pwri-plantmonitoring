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
      <Label className="text-xs text-muted-foreground">
        Reason <span className="text-danger">*</span>
        <span className="ml-1 text-[10px]">(min 5 chars — required for audit log)</span>
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
      />
      {tooShort && (
        <p className="text-[10px] text-danger">
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
  });
  const [locating, setLocating] = useState(false);

  // Product meters for "Supplied by" select
  const { data: productMeters } = useQuery({
    queryKey: ['product-meters', locator.plant_id],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name').eq('plant_id', locator.plant_id).order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
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
    const payload: any = {
      name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    };
    // Mirror the Add form pattern: only include product_meter_id when setting a value,
    // or when the original row had one (so the user can intentionally clear it to null).
    // Omitting the key entirely avoids a schema-cache crash if the column doesn't exist yet.
    if (form.product_meter_id || locator.product_meter_id != null) {
      payload.product_meter_id = form.product_meter_id || null;
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
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div>
              <Label>Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label>Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>

          {/* Supplied by product meter */}
          {(productMeters?.length ?? 0) > 0 && (
            <div>
              <Label>Supplied by (Product Meter)</Label>
              <Select value={form.product_meter_id || '__none__'} onValueChange={v => setForm({ ...form, product_meter_id: v === '__none__' ? '' : v })}>
                <SelectTrigger className="h-9 text-sm">
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

          {/* GPS row — editable inputs + clickable map link + use-my-location */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>GPS Coordinates</Label>
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
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} />
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
  const [form, setForm] = useState({ name: '', address: '', meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '', gps_lat: '', gps_lng: '', product_meter_id: '' });
  const [locating, setLocating] = useState(false);

  // Product meters for "Supplied by" select
  const { data: productMeters } = useQuery({
    queryKey: ['product-meters', plantId],
    queryFn: async () => {
      const { data } = await (supabase.from('product_meters' as any) as any)
        .select('id, name').eq('plant_id', plantId).order('sort_order', { ascending: true });
      return (data ?? []) as any[];
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
    const payload: any = {
      plant_id: plantId, name: form.name, address: form.address || null, location_desc: form.address || null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      meter_installed_date: form.meter_installed_date || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    };
    if (form.product_meter_id) payload.product_meter_id = form.product_meter_id;
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
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div>
              <Label>Size</Label>
              <div className="relative">
                <Input type="number" min="0" step="0.5" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} className="pr-10" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">in</span>
              </div>
            </div>
            <div><Label>Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>

          {/* Supplied by product meter */}
          {(productMeters?.length ?? 0) > 0 && (
            <div>
              <Label>Supplied by (Product Meter)</Label>
              <Select value={form.product_meter_id || '__none__'} onValueChange={v => setForm({ ...form, product_meter_id: v === '__none__' ? '' : v })}>
                <SelectTrigger className="h-9 text-sm">
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

          {/* GPS row */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>GPS Coordinates</Label>
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
                <Label className="text-xs text-muted-foreground">Latitude</Label>
                <Input placeholder="e.g. 10.3157" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Longitude</Label>
                <Input placeholder="e.g. 123.8854" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export function ReplaceMeterDialog({ kind, assetId, plantId, oldSerial, onClose }: { kind: 'locator' | 'well'; assetId: string; plantId: string; oldSerial: string | null; onClose: () => void }) {
  const { user, activeOperator } = useAuth();
  const [form, setForm] = useState({
    replacement_date: format(new Date(), 'yyyy-MM-dd'),
    old_final_reading: '', new_brand: '', new_size: '', new_serial: '', new_initial_reading: '', new_installed_date: format(new Date(), 'yyyy-MM-dd'), remarks: '',
  });
  const submit = async () => {
    if (!form.new_serial) { toast.error('New serial required'); return; }
    const payload: any = {
      plant_id: plantId, replacement_date: form.replacement_date,
      replaced_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    };
    if (kind === 'locator') {
      Object.assign(payload, {
        locator_id: assetId, old_meter_serial: oldSerial, old_meter_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_meter_brand: form.new_brand, new_meter_size: form.new_size, new_meter_serial: form.new_serial,
        new_meter_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_meter_installed_date: form.new_installed_date,
      });
      const { error } = await supabase.from('locator_meter_replacements').insert(payload);
      if (error) { toast.error(friendlyError(error)); return; }
      await supabase.from('locators').update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);
    } else {
      Object.assign(payload, {
        well_id: assetId, old_serial: oldSerial, old_final_reading: form.old_final_reading ? +form.old_final_reading : null,
        new_brand: form.new_brand, new_size: form.new_size, new_serial: form.new_serial,
        new_initial_reading: form.new_initial_reading ? +form.new_initial_reading : null,
        new_installed_date: form.new_installed_date,
      });
      const { error } = await supabase.from('well_meter_replacements').insert(payload);
      if (error) { toast.error(friendlyError(error)); return; }
      await supabase.from('wells').update({ meter_brand: form.new_brand, meter_size: form.new_size, meter_serial: form.new_serial, meter_installed_date: form.new_installed_date }).eq('id', assetId);
    }
    toast.success('Meter replaced');
    onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replace meter</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Replacement date</Label><Input type="date" value={form.replacement_date} onChange={e => setForm({ ...form, replacement_date: e.target.value })} /></div>
            <div><Label>Old final reading</Label><Input type="number" value={form.old_final_reading} onChange={e => setForm({ ...form, old_final_reading: e.target.value })} /></div>
          </div>
          <div className="text-xs text-muted-foreground">Old serial: <span className="font-mono-num">{oldSerial ?? '—'}</span></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>New brand</Label><Input value={form.new_brand} onChange={e => setForm({ ...form, new_brand: e.target.value })} /></div>
            <div><Label>New size</Label><Input value={form.new_size} onChange={e => setForm({ ...form, new_size: e.target.value })} /></div>
            <div><Label>New serial *</Label><Input value={form.new_serial} onChange={e => setForm({ ...form, new_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Initial reading</Label><Input type="number" value={form.new_initial_reading} onChange={e => setForm({ ...form, new_initial_reading: e.target.value })} /></div>
            <div><Label>Installed date</Label><Input type="date" value={form.new_installed_date} onChange={e => setForm({ ...form, new_installed_date: e.target.value })} /></div>
          </div>
          <div><Label>Remarks</Label><Input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} /></div>
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
            <Label className="text-xs font-medium">Select CSV file</Label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-700 group-hover:bg-teal-600 text-white text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-teal-700 font-medium">{rows.length} row(s) ready</span>
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

