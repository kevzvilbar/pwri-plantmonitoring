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


import { parseCsv, downloadTemplate, CsvPreviewTable } from '../shared';

export function EditWellDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const [form, setForm] = useState({
    name: well.name ?? '', diameter: well.diameter ?? '', drilling_depth_m: well.drilling_depth_m?.toString() ?? '',
    meter_brand: well.meter_brand ?? '', meter_size: well.meter_size ?? '', meter_serial: well.meter_serial ?? '',
    gps_lat: well.gps_lat?.toString() ?? '', gps_lng: well.gps_lng?.toString() ?? '',
  });
  const { user } = useAuth();

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name Required'); return; }
    const prevStatus = well.status;
    const nextStatus = well.status; // EditWellDialog doesn't change status — status changes via the toggle in the card
    const payload: Database['public']['Tables']['wells']['Update'] & {
      gps_lat?: number | null; gps_lng?: number | null;
    } = {
      name: form.name.trim(), diameter: form.diameter || null,
      drilling_depth_m: form.drilling_depth_m ? +form.drilling_depth_m : null,
      meter_brand: form.meter_brand || null, meter_size: form.meter_size || null, meter_serial: form.meter_serial || null,
      gps_lat: form.gps_lat ? +form.gps_lat : null, gps_lng: form.gps_lng ? +form.gps_lng : null,
    };
    let { error } = await supabase.from('wells').update(payload as never).eq('id', well.id);
    // Graceful fallback: if gps_lat/gps_lng are missing from the schema cache,
    // retry without them rather than failing the entire update — mirrors the
    // same fallback AddWellDialog already uses.
    if (error && (error.message.includes('gps_lat') || error.message.includes('gps_lng') || error.message.includes('column') || error.message.includes('schema cache'))) {
      const { gps_lat: _lat, gps_lng: _lng, ...fallbackPayload } = payload as any;
      const { error: e2 } = await supabase.from('wells').update(fallbackPayload as never).eq('id', well.id);
      error = e2 ?? null;
    }
    if (error) { toast.error(error.message); return; }
    toast.success('Well updated'); onClose();
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Well</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} /></div>
            <div><Label>Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Meter Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
            <div><Label>Meter Size</Label><Input value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} /></div>
            <div><Label>Meter Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>GPS Lat</Label><Input value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} /></div>
            <div><Label>GPS Lng</Label><Input value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddWellDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [form, setForm] = useState({
    name: '', diameter: '', drilling_depth_m: '', has_power_meter: false,
    meter_brand: '', meter_size: '', meter_serial: '', meter_installed_date: '',
    electric_meter_brand: '', electric_meter_size: '', electric_meter_serial: '', electric_meter_installed_date: '',
    gps_lat: '', gps_lng: '',
  });
  const [locating, setLocating] = useState(false);

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
    if (error) { toast.error(error.message); return; }
    toast.success(`${form.name.trim()} added`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Well</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name *</Label>
            <Input data-testid="add-well-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Well #1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Diameter</Label><Input value={form.diameter} onChange={e => setForm({ ...form, diameter: e.target.value })} placeholder="8 inch" /></div>
            <div><Label>Depth (m)</Label><Input type="number" value={form.drilling_depth_m} onChange={e => setForm({ ...form, drilling_depth_m: e.target.value })} /></div>
          </div>

          {/* Water meter */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="text-xs font-semibold inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" /> Water Meter
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Brand</Label><Input value={form.meter_brand} onChange={e => setForm({ ...form, meter_brand: e.target.value })} /></div>
              <div><Label className="text-xs">Size</Label><Input type="number" value={form.meter_size} onChange={e => setForm({ ...form, meter_size: e.target.value })} /></div>
              <div><Label className="text-xs">Serial</Label><Input value={form.meter_serial} onChange={e => setForm({ ...form, meter_serial: e.target.value })} /></div>
            </div>
          </div>

          {/* Electric meter (optional) */}
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <Checkbox
                checked={form.has_power_meter}
                onCheckedChange={(v) => setForm({ ...form, has_power_meter: !!v })}
                className="shrink-0 h-5 w-5 sm:h-4 sm:w-4 [&]:rounded-full sm:[&]:rounded-sm"
                data-testid="add-well-has-power-meter"
              />
              <Zap className="h-3 w-3 text-amber-500" />
              Has Dedicated Electric Meter
            </label>
            {form.has_power_meter && (
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} data-testid="add-well-em-brand" /></div>
                <div><Label className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} placeholder="kWh" /></div>
                <div><Label className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} data-testid="add-well-em-serial" /></div>
                <div className="col-span-3">
                  <Label className="text-xs">Installed</Label>
                  <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div><Label>GPS Lat</Label>
              <Input data-testid="add-well-lat" value={form.gps_lat} onChange={e => setForm({ ...form, gps_lat: e.target.value })} placeholder="10.295" />
            </div>
            <div><Label>GPS Lng</Label>
              <Input data-testid="add-well-lng" value={form.gps_lng} onChange={e => setForm({ ...form, gps_lng: e.target.value })} placeholder="123.877" />
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


export function EditElectricMeterDialog({ well, onClose }: { well: any; onClose: () => void }) {
  const [form, setForm] = useState({
    has_power_meter: !!well.has_power_meter,
    electric_meter_brand: well.electric_meter_brand ?? '',
    electric_meter_size: well.electric_meter_size ?? '',
    electric_meter_serial: well.electric_meter_serial ?? '',
    electric_meter_installed_date: well.electric_meter_installed_date ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const payload: any = {
      has_power_meter: form.has_power_meter,
      electric_meter_brand: form.electric_meter_brand || null,
      electric_meter_size: form.electric_meter_size || null,
      electric_meter_serial: form.electric_meter_serial || null,
      electric_meter_installed_date: form.electric_meter_installed_date || null,
    };
    const { error } = await supabase.from('wells').update(payload).eq('id', well.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Electric meter updated');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Electric Meter — {well.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.has_power_meter}
              onCheckedChange={(v) => setForm({ ...form, has_power_meter: v })}
              data-testid="edit-em-has-power"
              className="h-8 w-14 sm:h-6 sm:w-11 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-5 sm:[&>span]:w-5 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-5"
            />
            Has dedicated electric meter
          </label>
          {form.has_power_meter && (
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Brand</Label><Input value={form.electric_meter_brand} onChange={e => setForm({ ...form, electric_meter_brand: e.target.value })} /></div>
              <div><Label className="text-xs">Size</Label><Input value={form.electric_meter_size} onChange={e => setForm({ ...form, electric_meter_size: e.target.value })} placeholder="kWh" /></div>
              <div><Label className="text-xs">Serial</Label><Input value={form.electric_meter_serial} onChange={e => setForm({ ...form, electric_meter_serial: e.target.value })} /></div>
              <div className="col-span-3">
                <Label className="text-xs">Installed</Label>
                <Input type="date" value={form.electric_meter_installed_date} onChange={e => setForm({ ...form, electric_meter_installed_date: e.target.value })} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} data-testid="save-electric-meter">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditHydraulicDialog({ well, latest, onClose }: { well: any; latest: any; onClose: () => void }) {
  const { user, activeOperator } = useAuth();
  const [form, setForm] = useState({
    date_gathered: format(new Date(), 'yyyy-MM-dd'),
    drilling_depth_m: (latest as any)?.drilling_depth_m ?? well.drilling_depth_m ?? '',
    static_water_level_m: latest?.static_water_level_m ?? '',
    pumping_water_level_m: latest?.pumping_water_level_m ?? '',
    pump_setting: latest?.pump_setting ?? '',
    motor_hp: latest?.motor_hp ?? '',
    tds_ppm: latest?.tds_ppm ?? '',
    turbidity_ntu: latest?.turbidity_ntu ?? '',
    remarks: '',
  });
  const submit = async () => {
    const num = (v: any) => v === '' || v == null ? null : +v;
    const { error } = await supabase.from('well_pms_records').insert({
      well_id: well.id, plant_id: well.plant_id,
      record_type: 'PMS',
      date_gathered: form.date_gathered,
      static_water_level_m: num(form.static_water_level_m),
      pumping_water_level_m: num(form.pumping_water_level_m),
      pump_setting: form.pump_setting || null,
      motor_hp: num(form.motor_hp),
      tds_ppm: num(form.tds_ppm),
      turbidity_ntu: num(form.turbidity_ntu),
      recorded_by: activeOperator?.id ?? user?.id, remarks: form.remarks || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    // Keep wells.drilling_depth_m in sync with the latest entry
    if (form.drilling_depth_m !== '') {
      await supabase.from('wells').update({ drilling_depth_m: num(form.drilling_depth_m) }).eq('id', well.id);
    }
    toast.success('Hydraulic data logged');
    onClose();
  };
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit hydraulic data — {well.name}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div><Label>Date gathered *</Label><Input type="date" value={form.date_gathered} onChange={e => set('date_gathered', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Drilling depth (m)</Label><Input type="number" step="any" value={form.drilling_depth_m} onChange={e => set('drilling_depth_m', e.target.value)} /></div>
            <div><Label>Pump setting</Label><Input value={form.pump_setting} onChange={e => set('pump_setting', e.target.value)} /></div>
            <div><Label>SWL (m)</Label><Input type="number" step="any" value={form.static_water_level_m} onChange={e => set('static_water_level_m', e.target.value)} /></div>
            <div><Label>PWL (m)</Label><Input type="number" step="any" value={form.pumping_water_level_m} onChange={e => set('pumping_water_level_m', e.target.value)} /></div>
            <div><Label>Motor HP</Label><Input type="number" step="any" value={form.motor_hp} onChange={e => set('motor_hp', e.target.value)} /></div>
            <div><Label>TDS (ppm)</Label><Input type="number" step="any" value={form.tds_ppm} onChange={e => set('tds_ppm', e.target.value)} /></div>
            <div className="col-span-2"><Label>Turbidity (NTU)</Label><Input type="number" step="any" value={form.turbidity_ntu} onChange={e => set('turbidity_ntu', e.target.value)} /></div>
            <div className="col-span-2"><Label>Remarks</Label><Input value={form.remarks} onChange={e => set('remarks', e.target.value)} /></div>
          </div>
          <p className="text-[10px] text-muted-foreground">Each save creates a new history entry so you can track changes over time.</p>
        </div>
        <DialogFooter><Button onClick={submit}>Save entry</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plant-level component type card ────────────────────────────────────────


export const WELL_CSV_HEADERS = [
  'name', 'diameter', 'drilling_depth_m',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'has_power_meter',
  'electric_meter_brand', 'electric_meter_size', 'electric_meter_serial', 'electric_meter_installed_date',
];

export function WellCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setRows(parseCsv(ev.target?.result as string));
      setErrors([]);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const errs: string[] = [];
    rows.forEach((r, i) => { if (!r.name?.trim()) errs.push(`Row ${i + 1}: name is required`); });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const payload = rows.map(r => {
      const hasPower = r.has_power_meter?.toLowerCase() === 'true';
      const row: any = {
        plant_id: plantId,
        name: r.name.trim(),
        diameter: r.diameter || null,
        drilling_depth_m: r.drilling_depth_m ? +r.drilling_depth_m : null,
        meter_brand: r.meter_brand || null,
        meter_size: r.meter_size ? +r.meter_size : null,
        meter_serial: r.meter_serial || null,
        meter_installed_date: r.meter_installed_date || null,
        has_power_meter: hasPower,
        status: 'Active',
      };
      if (hasPower) {
        row.electric_meter_brand = r.electric_meter_brand || null;
        row.electric_meter_size = r.electric_meter_size || null;
        row.electric_meter_serial = r.electric_meter_serial || null;
        row.electric_meter_installed_date = r.electric_meter_installed_date || null;
      }
      return row;
    });
    const { error } = await supabase.from('wells').insert(payload as any);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} well(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Wells from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate('wells_template.csv', WELL_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{WELL_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>name</strong> required. <strong>has_power_meter</strong>: true/false. Electric meter fields only needed if has_power_meter is true. Numeric: drilling_depth_m, meter_size.</p>
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
              <CsvPreviewTable rows={rows} headers={WELL_CSV_HEADERS} />
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

// ─── Train CSV Import ─────────────────────────────────────────────────────────

// Train CSV helpers — dynamic column names that reflect the plant-wide component type.
// The housing field uses a single descriptive column name (no separate filter_housings column).
