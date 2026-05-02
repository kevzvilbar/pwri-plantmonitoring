import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

const MAX_READINGS_PER_DAY = 3;
const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '';

// ─── CSV helpers ────────────────────────────────────────────────────────────

function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function triggerTemplateDownload(filename: string, headers: string[], exampleRow: Record<string, string>) {
  downloadCSV(filename, [exampleRow]);
}

// ─── Import audit logger ────────────────────────────────────────────────────

async function logReadingImport(entry: {
  user_id: string | null;
  plant_id: string;
  module: string;
  file_name: string;
  row_count: number;
  schema_valid: boolean;
  schema_errors: string[];
  timestamp: string;
}) {
  try {
    await (supabase.from('import_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

// ─── Shared ImportReadingsDialog ────────────────────────────────────────────
// Each module passes its own columns, validator, and inserter.

interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;           // shown in the dialog
  templateFilename: string;
  templateRow: Record<string, string>;
  validateRow: (r: Record<string, string>, i: number) => string[];
  insertRows: (rows: Record<string, string>[], plantId: string) => Promise<{ count: number; errors: string[] }>;
  onClose: () => void;
  onImported: () => void;
}

function ImportReadingsDialog({
  title, module, plantId, userId,
  schemaHint, templateFilename, templateRow,
  validateRow, insertRows,
  onClose, onImported,
}: ImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile]     = useState<File | null>(null);
  const [rows, setRows]     = useState<Record<string, string>[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [imported, setImported] = useState(0);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setDone(false); setErrors([]); setRows([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSVText(ev.target?.result as string);
      const errs: string[] = [];
      parsed.forEach((r, i) => errs.push(...validateRow(r, i + 2)));
      setRows(parsed);
      setErrors(errs);
    };
    reader.readAsText(f);
  };

  const doImport = async () => {
    if (!file || rows.length === 0 || errors.length > 0) return;
    setBusy(true);
    const ts = new Date().toISOString();
    const { count, errors: importErrors } = await insertRows(rows, plantId);
    await logReadingImport({
      user_id: userId,
      plant_id: plantId,
      module,
      file_name: file.name,
      row_count: rows.length,
      schema_valid: errors.length === 0,
      schema_errors: [...errors, ...importErrors],
      timestamp: ts,
    });
    setBusy(false);
    setImported(count);
    setDone(true);
    if (importErrors.length) toast.error(`${count} imported, ${importErrors.length} failed`);
    else toast.success(`${count} reading(s) imported`);
    onImported();
  };

  const canSubmit = !busy && !!file && rows.length > 0 && errors.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Download template */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => triggerTemplateDownload(templateFilename, Object.keys(templateRow), templateRow)}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>

          {/* Schema reference */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Expected columns:
            </p>
            <p className="text-[11px] font-mono text-foreground leading-relaxed break-all">{schemaHint}</p>
            <p className="text-[10px] text-muted-foreground">
              Columns marked <strong>*</strong> are required. <code>reading_datetime</code> accepts
              ISO 8601 format (e.g. <code>2024-06-15T08:30</code>) or <code>YYYY-MM-DD HH:mm</code>.
              Leave blank to default to the import timestamp.
            </p>
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Select CSV file <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800 border-teal-700"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose File
              </Button>
              <span className="text-xs text-muted-foreground">{file?.name ?? 'No file chosen'}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="hidden"
              data-testid="import-file-input"
            />
          </div>

          {/* Validation feedback */}
          {file && rows.length > 0 && (
            <div className={`rounded-md border p-3 space-y-2 ${
              errors.length > 0
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
            }`}>
              <p className="text-xs font-medium flex items-center gap-1.5">
                {errors.length === 0
                  ? <><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />{rows.length} row(s) in "{file.name}" — schema valid</>
                  : <><AlertCircle className="h-3.5 w-3.5 text-destructive" />{rows.length} row(s) — {errors.length} error(s)</>
                }
              </p>
              {errors.length > 0 && (
                <ul className="text-[10px] text-destructive list-disc ml-4 space-y-0.5 max-h-28 overflow-y-auto">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
          {file && rows.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> No data rows found — check the file format.
            </p>
          )}

          {/* Row preview */}
          {rows.length > 0 && errors.length === 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground font-medium">
                Preview (first {Math.min(rows.length, 5)} of {rows.length} rows):
              </p>
              <div className="overflow-x-auto rounded-md border text-[10px]">
                <table className="min-w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      {Object.keys(rows[0]).map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {Object.values(r).map((v, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap text-foreground max-w-[120px] truncate">{v || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {done && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
              {imported} record(s) imported. Audit log written.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={doImport}
            disabled={!canSubmit}
            className="bg-teal-700 text-white hover:bg-teal-800"
            data-testid="confirm-import-btn"
          >
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Per-module CSV configs ──────────────────────────────────────────────────

// Locator readings:
// locator_name*, current_reading*, reading_datetime, previous_reading
const LOCATOR_SCHEMA = 'locator_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading';
const LOCATOR_TEMPLATE_ROW = {
  locator_name: 'MCWD - M1',
  current_reading: '1234.56',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '1200.00',
};

function validateLocatorReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.locator_name?.trim()) e.push(`Row ${i}: locator_name is required`);
  if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
    e.push(`Row ${i}: current_reading must be a number`);
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(r.reading_datetime)))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

async function insertLocatorReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  // Resolve locator names → IDs
  const { data: locators } = await supabase
    .from('locators').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (locators ?? []).forEach((l: any) => { nameToId[l.name.toLowerCase()] = l.id; });

  let count = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const locatorId = nameToId[r.locator_name?.toLowerCase()];
    if (!locatorId) { errors.push(`Locator not found: "${r.locator_name}"`); continue; }
    const dt = r.reading_datetime ? new Date(r.reading_datetime).toISOString() : new Date().toISOString();
    const { error } = await supabase.from('locator_readings').insert({
      locator_id: locatorId,
      plant_id: plantId,
      current_reading: +r.current_reading,
      previous_reading: r.previous_reading ? +r.previous_reading : null,
      reading_datetime: dt,
      recorded_by: userId,
    });
    if (error) errors.push(error.message);
    else count++;
  }
  return { count, errors };
}

// Well readings:
// well_name*, current_reading*, reading_datetime, previous_reading, power_meter_reading
const WELL_SCHEMA = 'well_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, power_meter_reading';
const WELL_TEMPLATE_ROW = {
  well_name: 'Well #1',
  current_reading: '5678.90',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '5600.00',
  power_meter_reading: '',
};

function validateWellReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);
  if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
    e.push(`Row ${i}: current_reading must be a number`);
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.power_meter_reading && isNaN(Number(r.power_meter_reading)))
    e.push(`Row ${i}: power_meter_reading must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(r.reading_datetime)))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

async function insertWellReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.toLowerCase()] = w.id; });

  let count = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const wellId = nameToId[r.well_name?.toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    const dt = r.reading_datetime ? new Date(r.reading_datetime).toISOString() : new Date().toISOString();
    const { error } = await supabase.from('well_readings').insert({
      well_id: wellId,
      plant_id: plantId,
      current_reading: +r.current_reading,
      previous_reading: r.previous_reading ? +r.previous_reading : null,
      power_meter_reading: r.power_meter_reading ? +r.power_meter_reading : null,
      reading_datetime: dt,
      recorded_by: userId,
    });
    if (error) errors.push(error.message);
    else count++;
  }
  return { count, errors };
}

// Blending readings:
// well_name*, volume_m3*, event_date (YYYY-MM-DD)
const BLENDING_SCHEMA = 'well_name*, volume_m3* (m³), event_date (YYYY-MM-DD), reading_datetime (YYYY-MM-DDTHH:mm)';
const BLENDING_TEMPLATE_ROW = {
  well_name: 'Well #2',
  volume_m3: '150.00',
  event_date: '2024-06-15',
  reading_datetime: '2024-06-15T08:30',
};

function validateBlendingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);
  if (!r.volume_m3?.trim() || isNaN(Number(r.volume_m3)) || Number(r.volume_m3) <= 0)
    e.push(`Row ${i}: volume_m3 must be a positive number`);
  if (r.event_date && isNaN(Date.parse(r.event_date)))
    e.push(`Row ${i}: event_date is not a valid date (use YYYY-MM-DD)`);
  return e;
}

async function insertBlendingReadings(
  rows: Record<string, string>[],
  plantId: string,
  plantName: string,
): Promise<{ count: number; errors: string[] }> {
  const { data: wells } = await supabase
    .from('wells').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (wells ?? []).forEach((w: any) => { nameToId[w.name.toLowerCase()] = w.id; });

  let count = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const wellId = nameToId[r.well_name?.toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    const eventDate = r.event_date || new Date().toISOString().slice(0, 10);
    try {
      const res = await fetch(`${BASE}/api/blending/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          well_id: wellId,
          plant_id: plantId,
          well_name: r.well_name,
          plant_name: plantName,
          event_date: eventDate,
          volume_m3: +r.volume_m3,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      count++;
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  return { count, errors };
}

// Power readings:
// meter_reading_kwh*, reading_datetime*, daily_solar_kwh, daily_grid_kwh
const POWER_SCHEMA = 'meter_reading_kwh*, reading_datetime* (YYYY-MM-DDTHH:mm), daily_solar_kwh, daily_grid_kwh';
const POWER_TEMPLATE_ROW = {
  meter_reading_kwh: '12345.6',
  reading_datetime: '2024-06-15T08:30',
  daily_solar_kwh: '',
  daily_grid_kwh: '',
};

function validatePowerRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.meter_reading_kwh?.trim() || isNaN(Number(r.meter_reading_kwh)))
    e.push(`Row ${i}: meter_reading_kwh is required and must be a number`);
  if (!r.reading_datetime?.trim() || isNaN(Date.parse(r.reading_datetime)))
    e.push(`Row ${i}: reading_datetime is required and must be a valid datetime`);
  if (r.daily_solar_kwh && isNaN(Number(r.daily_solar_kwh)))
    e.push(`Row ${i}: daily_solar_kwh must be a number`);
  if (r.daily_grid_kwh && isNaN(Number(r.daily_grid_kwh)))
    e.push(`Row ${i}: daily_grid_kwh must be a number`);
  return e;
}

async function insertPowerReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const { error } = await supabase.from('power_readings').insert({
      plant_id: plantId,
      meter_reading_kwh: +r.meter_reading_kwh,
      reading_datetime: new Date(r.reading_datetime).toISOString(),
      daily_solar_kwh: r.daily_solar_kwh ? +r.daily_solar_kwh : 0,
      daily_grid_kwh: r.daily_grid_kwh ? +r.daily_grid_kwh : 0,
      recorded_by: userId,
    });
    if (error) errors.push(error.message);
    else count++;
  }
  return { count, errors };
}

// ─── Blending wells list (Mongo-backed) ─────────────────────────────────────
function useBlendingWells(plantId: string) {
  return useQuery<{ wells: { well_id: string }[] }>({
    queryKey: ['blending-wells', plantId],
    queryFn: async () => {
      try {
        const qs = plantId ? `?plant_id=${encodeURIComponent(plantId)}` : '';
        const res = await fetch(`${BASE}/api/blending/wells${qs}`);
        if (!res.ok) return { wells: [] };
        return res.json();
      } catch {
        return { wells: [] };
      }
    },
    enabled: !!plantId,
    retry: false,
  });
}

const TAB_ALIASES: Record<string, string> = {
  locator: 'locator', locators: 'locator',
  well: 'well', wells: 'well',
  product: 'product', production: 'product',
  blending: 'blending', bypass: 'blending',
  power: 'power',
};
const VALID_TABS = new Set(['locator', 'well', 'product', 'blending', 'power']);

// ─── PlantSelector ───────────────────────────────────────────────────────────
function PlantSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>
        {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Operations page ─────────────────────────────────────────────────────────
export default function Operations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = TAB_ALIASES[(searchParams.get('tab') || '').toLowerCase()] ?? 'locator';
  const [tab, setTab] = useState<string>(urlTab);

  useEffect(() => {
    if (urlTab !== tab) setTab(urlTab);
  }, [urlTab]);

  const handleTabChange = (next: string) => {
    if (!VALID_TABS.has(next)) return;
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
      <div className="grid grid-cols-5 gap-1 p-1 bg-muted rounded-lg w-full">
        {(['locator', 'well', 'product', 'blending', 'power'] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={[
              'py-2 text-sm font-medium rounded-md transition-all duration-200 capitalize focus-visible:outline-none',
              tab === t ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === 'locator'  && <LocatorReadingForm />}
        {tab === 'well'     && <WellReadingForm />}
        {tab === 'product'  && <ProductForm />}
        {tab === 'blending' && <BlendingForm />}
        {tab === 'power'    && <PowerForm />}
      </div>
    </div>
  );
}

// ─── LOCATOR ─────────────────────────────────────────────────────────────────

function LocatorReadingForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('locator_readings')
        .select('*').eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })).data ?? [];
    },
    enabled: !!plantId,
  });

  const { latestByLocator, todayByLocator, avgByLocator } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const volsByLocator: Record<string, number[]> = {};
    recentReadings?.forEach((r: any) => {
      if (!latest[r.locator_id]) latest[r.locator_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.locator_id] ||= []).push(r);
      if (r.daily_volume != null && r.daily_volume > 0) (volsByLocator[r.locator_id] ||= []).push(r.daily_volume);
    });
    for (const [k, v] of Object.entries(volsByLocator))
      avgs[k] = v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
    return { latestByLocator: latest, todayByLocator: today, avgByLocator: avgs };
  }, [recentReadings]);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        {/* Plant selector row — Import button sits inline on the right */}
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1">
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {isAdmin && plantId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-locator-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
            <span>Active locators</span>
            <span className="text-muted-foreground">{locators?.length ?? 0} total</span>
          </div>
          {locators?.length ? (
            <ul className="divide-y">
              {locators.map((l: any) => (
                <li key={l.id}>
                  <LocatorRow
                    locator={l} plantId={plantId}
                    previous={latestByLocator[l.id]?.current_reading ?? null}
                    todayReadings={todayByLocator[l.id] ?? []}
                    avgVol={avgByLocator[l.id] ?? null}
                    userId={user?.id}
                    onSaved={() => qc.invalidateQueries()}
                    isManagerOrAdmin={isAdmin || isManager}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No active locators for this plant</p>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Locator Readings from CSV"
          module="Locator Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={LOCATOR_SCHEMA}
          templateFilename="locator_readings_template.csv"
          templateRow={LOCATOR_TEMPLATE_ROW}
          validateRow={validateLocatorReadingRow}
          insertRows={(rows, pid) => insertLocatorReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['op-loc-recent', plantId] }); }}
        />
      )}
    </div>
  );
}

function LocatorRow({
  locator, plantId, previous, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin,
}: {
  locator: any; plantId: string; previous: number | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
}) {
  const [reading, setReading]     = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const cur       = +reading || 0;
  const dailyVol  = previous != null && reading ? cur - previous : null;
  const belowPrev = previous != null && cur > 0 && cur < previous;
  const highVol   = avgVol != null && dailyVol != null && dailyVol > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= MAX_READINGS_PER_DAY;

  const save = async () => {
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${MAX_READINGS_PER_DAY} readings/day reached`); return; }
    if (belowPrev && !window.confirm(`${locator.name}: reading below previous — save anyway?`)) return;
    if (!belowPrev && highVol && !window.confirm(`${locator.name}: volume unusually high — save anyway?`)) return;

    setSaving(true);
    let gps_lat = null, gps_lng = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator.gps_lat && locator.gps_lng)
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const payload: any = {
      locator_id: locator.id, plant_id: plantId,
      current_reading: cur, previous_reading: previous,
      gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
    };
    const { error } = editingId
      ? await supabase.from('locator_readings').update(payload).eq('id', editingId)
      : await supabase.from('locator_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${locator.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setEditingId(null); onSaved();
  };

  return (
    <div className="p-3 flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-[140px]">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate">{locator.name}</div>
          {lastToday?.off_location_flag && <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off</StatusPill>}
          {editingId && <span className="text-[10px] uppercase tracking-wide text-highlight">editing</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          prev: <span className="font-mono-num">{previous == null ? '—' : fmtNum(previous)}</span>
          {dailyVol != null && <> · Δ <span className="font-mono-num">{fmtNum(dailyVol)} m³</span></>}
          <span className="mx-1">·</span>
          <span className={atLimit ? 'text-warn-foreground' : ''}>{todayCount}/{MAX_READINGS_PER_DAY} today</span>
        </div>
      </div>

      <Input
        type="number" step="any" inputMode="decimal"
        value={reading} onChange={(e) => setReading(e.target.value)}
        placeholder="Reading" className="w-28 sm:w-32 shrink-0"
      />

      <Button onClick={save} disabled={saving || !reading || atLimit} size="sm" className="shrink-0">
        {saving ? '...' : editingId ? 'Update' : 'Save'}
      </Button>

      {lastToday && !editingId && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
          onClick={() => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); }}
          title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {editingId && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
          onClick={() => { setEditingId(null); setReading(''); }} title="Cancel edit">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {isManagerOrAdmin && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-muted-foreground"
          onClick={() => setShowHistory(true)} title="View reading history">
          <History className="h-3.5 w-3.5" />
        </Button>
      )}
      {showHistory && (
        <ReadingHistoryDialog
          entityName={locator.name}
          module="locator"
          entityId={locator.id}
          onClose={() => setShowHistory(false)}
        />
      )}
      {reading && (belowPrev || highVol) && (
        <div className="w-full text-xs text-warn-foreground bg-warn-soft px-2 py-1 rounded">
          {belowPrev ? 'Below previous' : 'Volume unusually high vs. avg'}
        </div>
      )}
    </div>
  );
}

// ─── WELL ────────────────────────────────────────────────────────────────────

function WellReadingForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-well-recent', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('well_readings')
        .select('*').eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })).data ?? [];
    },
    enabled: !!plantId,
  });

  const { latestByWell, todayByWell } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    recentReadings?.forEach((r: any) => {
      if (!latest[r.well_id]) latest[r.well_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.well_id] ||= []).push(r);
    });
    return { latestByWell: latest, todayByWell: today };
  }, [recentReadings]);

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingSet = useMemo(
    () => new Set((blendingData?.wells ?? []).map((w) => w.well_id)),
    [blendingData],
  );

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1">
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {isAdmin && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-well-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
            <span>Active wells</span>
            <span className="text-muted-foreground">{wells?.length ?? 0} total</span>
          </div>
          {wells?.length ? (
            <ul className="divide-y">
              {wells.map((w: any) => (
                <li key={w.id}>
                  <WellRow
                    well={w} plantId={plantId}
                    previousMeter={latestByWell[w.id]?.current_reading ?? null}
                    previousPower={latestByWell[w.id]?.power_meter_reading ?? null}
                    todayReadings={todayByWell[w.id] ?? []}
                    userId={user?.id}
                    isBlending={blendingSet.has(w.id)}
                    onSaved={() => qc.invalidateQueries()}
                    isManagerOrAdmin={isAdmin || isManager}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No active wells for this plant</p>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Well Readings from CSV"
          module="Well Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={WELL_SCHEMA}
          templateFilename="well_readings_template.csv"
          templateRow={WELL_TEMPLATE_ROW}
          validateRow={validateWellReadingRow}
          insertRows={(rows, pid) => insertWellReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['op-well-recent', plantId] }); }}
        />
      )}
    </div>
  );
}

function WellRow({
  well, plantId, previousMeter, previousPower, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
}) {
  const [reading, setReading]         = useState('');
  const [powerReading, setPowerReading] = useState('');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const cur        = +reading || 0;
  const dailyVol   = previousMeter != null && reading ? cur - previousMeter : null;
  const belowPrev  = previousMeter != null && cur > 0 && cur < previousMeter;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= MAX_READINGS_PER_DAY;

  const save = async () => {
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) { toast.error(`${well.name}: max ${MAX_READINGS_PER_DAY} readings/day reached`); return; }
    if (belowPrev && !window.confirm(`${well.name}: meter below previous — save anyway?`)) return;

    setSaving(true);
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const payload: any = {
      well_id: well.id, plant_id: plantId,
      current_reading: cur, previous_reading: previousMeter,
      power_meter_reading: powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: userId,
    };
    const { error } = editingId
      ? await supabase.from('well_readings').update(payload).eq('id', editingId)
      : await supabase.from('well_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${well.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setPowerReading(''); setEditingId(null); onSaved();
  };

  return (
    <div className="p-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid={`well-row-${well.id}`}>
      <div className="min-w-0 flex-1 sm:basis-[160px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-sm font-medium truncate">{well.name}</div>
          {well.has_power_meter && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">kWh</span>
          )}
          {isBlending && (
            <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 font-normal" data-testid={`blending-badge-${well.id}`}>
              Blending
            </Badge>
          )}
          {editingId && <span className="text-[10px] uppercase tracking-wide text-highlight">Editing</span>}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          prev: <span className="font-mono-num">{previousMeter == null ? '—' : fmtNum(previousMeter)}</span>
          {dailyVol != null && <> · Δ <span className="font-mono-num">{fmtNum(dailyVol)} m³</span></>}
          <span className="mx-1">·</span>
          <span className={atLimit ? 'text-warn-foreground' : ''}>{todayCount}/{MAX_READINGS_PER_DAY} today</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 sm:order-last">
        <Button onClick={save} disabled={saving || !reading || atLimit} className="h-9 px-3 text-xs">
          {saving ? '...' : editingId ? 'Update' : 'Save'}
        </Button>
        {lastToday && !editingId && (
          <Button variant="ghost" className="h-9 w-9 p-0"
            onClick={() => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading ?? '')); setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : ''); }}
            title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {editingId && (
          <Button variant="ghost" className="h-9 w-9 p-0"
            onClick={() => { setEditingId(null); setReading(''); setPowerReading(''); }} title="Cancel edit">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
        {isManagerOrAdmin && (
          <Button variant="ghost" className="h-9 w-9 p-0 text-muted-foreground"
            onClick={() => setShowHistory(true)} title="View reading history">
            <History className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          onClose={() => setShowHistory(false)}
        />
      )}

      <div className="flex items-center gap-1.5 basis-full sm:basis-auto sm:ml-auto">
        <div className="relative flex-1 sm:flex-initial sm:w-32">
          <Droplet className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-cyan-600 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={reading}
            onChange={(e) => setReading(e.target.value)} placeholder="Water Meter"
            className="h-9 pl-7 w-full border-cyan-300 focus-visible:ring-cyan-300 bg-cyan-50/40 dark:bg-cyan-950/20"
            data-testid={`well-meter-input-${well.id}`} />
        </div>
        {well.has_power_meter && (
          <div className="relative flex-1 sm:flex-initial sm:w-32">
            <Zap className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-600 pointer-events-none" />
            <Input type="number" step="any" inputMode="decimal" value={powerReading}
              onChange={(e) => setPowerReading(e.target.value)} placeholder="Power Meter"
              className="h-9 pl-7 w-full border-amber-300 focus-visible:ring-amber-300 bg-amber-50/40 dark:bg-amber-950/20"
              data-testid={`well-power-input-${well.id}`} />
          </div>
        )}
      </div>

      {reading && belowPrev && (
        <div className="w-full text-xs text-warn-foreground bg-warn-soft px-2 py-1 rounded">Meter below previous</div>
      )}
    </div>
  );
}

// ─── BLENDING ────────────────────────────────────────────────────────────────

function BlendingForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const plantName = plants?.find((p: any) => p.id === plantId)?.name ?? '';

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('id, name, plant_id, status').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingIds    = useMemo(() => new Set((blendingData?.wells ?? []).map((w) => w.well_id)), [blendingData]);
  const blendingWells  = useMemo(() => (wells ?? []).filter((w: any) => blendingIds.has(w.id)), [wells, blendingIds]);

  const { data: volumeData } = useQuery<{
    by_well: { well_id: string; volume_m3: number; today_volume_m3: number; previous_volume_m3: number | null; previous_event_date: string | null }[];
  }>({
    queryKey: ['blending-today', plantId],
    queryFn: async () => {
      try {
        const res = await fetch(`${BASE}/api/blending/volume?days=14&plant_ids=${encodeURIComponent(plantId)}`);
        if (!res.ok) return { by_well: [] };
        return res.json();
      } catch { return { by_well: [] }; }
    },
    enabled: !!plantId,
    retry: false,
  });
  const todayByWell = useMemo(() => {
    const m: Record<string, number> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = w.today_volume_m3 ?? 0;
    return m;
  }, [volumeData]);
  const prevByWell = useMemo(() => {
    const m: Record<string, { volume: number | null; date: string | null }> = {};
    for (const w of volumeData?.by_well ?? []) m[w.well_id] = { volume: w.previous_volume_m3 ?? null, date: w.previous_event_date ?? null };
    return m;
  }, [volumeData]);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1">
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {isAdmin && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-blending-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <Card className="p-0 overflow-hidden">
          <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
            <span>Blending wells</span>
            <span className="text-muted-foreground">{blendingWells.length} tagged</span>
          </div>
          {blendingWells.length ? (
            <ul className="divide-y">
              {blendingWells.map((w: any) => (
                <li key={w.id}>
                  <BlendingRow
                    well={w} plantId={plantId} plantName={plantName}
                    todayVolume={todayByWell[w.id] ?? 0}
                    previousVolume={prevByWell[w.id]?.volume ?? null}
                    previousDate={prevByWell[w.id]?.date ?? null}
                    onSaved={() => {
                      qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
                      qc.invalidateQueries({ queryKey: ['blending-volume'] });
                    }}
                    isManagerOrAdmin={isAdmin || isManager}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">
              No wells tagged as blending for this plant. Tag a well as blending under <span className="font-medium">Plants → Wells</span>.
            </div>
          )}
        </Card>
      )}

      {importOpen && (
        <ImportReadingsDialog
          title="Import Blending Readings from CSV"
          module="Blending Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BLENDING_SCHEMA}
          templateFilename="blending_readings_template.csv"
          templateRow={BLENDING_TEMPLATE_ROW}
          validateRow={validateBlendingRow}
          insertRows={(rows, pid) => insertBlendingReadings(rows, pid, plantName)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
            qc.invalidateQueries({ queryKey: ['blending-volume'] });
          }}
        />
      )}
    </div>
  );
}

function BlendingRow({
  well, plantId, plantName, todayVolume, previousVolume, previousDate, onSaved, isManagerOrAdmin,
}: {
  well: any; plantId: string; plantName?: string;
  todayVolume: number; previousVolume: number | null; previousDate: string | null;
  onSaved: () => void;
  isManagerOrAdmin: boolean;
}) {
  const [volume, setVolume] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const save = async () => {
    const v = +volume;
    if (!volume || !(v > 0)) { toast.error(`${well.name}: enter a positive blending volume`); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/blending/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          well_id: well.id, plant_id: plantId, well_name: well.name, plant_name: plantName,
          event_date: new Date().toISOString().slice(0, 10), volume_m3: v,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${well.name}: blending volume saved (${fmtNum(v)} m³)`);
      setVolume(''); onSaved();
    } catch (e: any) {
      toast.error(`Blending save failed: ${e.message || e}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 flex flex-wrap items-center gap-2" data-testid={`blending-row-${well.id}`}>
      <div className="min-w-0 flex-1 basis-[140px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="text-sm font-medium truncate">{well.name}</div>
          <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 font-normal">Blending</Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          prev: <span className="font-mono-num" title={previousDate ? `last entry on ${previousDate}` : 'no prior blending entry'}>
            {previousVolume == null ? '—' : `${fmtNum(previousVolume)} m³`}
          </span>
          <span className="mx-1">·</span>
          today: <span className="font-mono-num">{fmtNum(todayVolume)} m³</span> logged
        </div>
      </div>
      <Button onClick={save} disabled={saving || !volume} size="sm" className="h-9 px-3 text-xs shrink-0 sm:order-last">
        {saving ? '...' : 'Save'}
      </Button>
      {isManagerOrAdmin && (
        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground sm:order-last"
          onClick={() => setShowHistory(true)} title="View blending history">
          <History className="h-3.5 w-3.5" />
        </Button>
      )}
      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="blending"
          entityId={well.id}
          plantId={plantId}
          onClose={() => setShowHistory(false)}
        />
      )}
      <div className="flex items-center gap-1.5 basis-full sm:basis-auto sm:ml-auto">
        <div className="relative flex-1 sm:flex-initial sm:w-32">
          <Droplet className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-violet-600 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)} placeholder="Blending Reading"
            className="h-9 pl-7 w-full border-violet-300 focus-visible:ring-violet-300 bg-violet-50/40 dark:bg-violet-950/20"
            data-testid={`blending-input-${well.id}`} />
        </div>
      </div>
    </div>
  );
}

// ─── PRODUCT METER audit logger ──────────────────────────────────────────────

async function logProductMeterChange(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  old_value: number | null;
  new_value: number | null;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('product_meter_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

async function logProductionCalc(entry: {
  plant_id: string;
  meter_id: string;
  meter_name: string;
  entry_name: string;
  production_volume: number;
  user_id: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('production_calc_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

// ─── PRODUCT ─────────────────────────────────────────────────────────────────

function ProductForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = isAdmin || isManager;

  // Product meters for the selected plant
  const { data: meters, isLoading: metersLoading } = useQuery({
    queryKey: ['product-meters', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase
        .from('product_meters' as any)
        .select('*')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  // Latest reading per meter
  const { data: latestReadings } = useQuery({
    queryKey: ['product-readings-latest', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase
        .from('product_meter_readings' as any)
        .select('*')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(200);
      // Return only latest per meter_id
      const seen = new Set<string>();
      return ((data ?? []) as any[]).filter((r) => {
        if (seen.has(r.meter_id)) return false;
        seen.add(r.meter_id);
        return true;
      });
    },
    enabled: !!plantId,
  });

  const latestByMeter = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of latestReadings ?? []) m[r.meter_id] = r;
    return m;
  }, [latestReadings]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['product-meters', plantId] });
    qc.invalidateQueries({ queryKey: ['product-readings-latest', plantId] });
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label>Plant</Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1">
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {canEdit && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-product-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>
      </Card>

      {plantId && (
        <>
          {/* Product Meter list */}
          <Card className="p-0 overflow-hidden">
            <div className="px-3 py-2 border-b bg-muted/40 text-xs font-medium flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-teal-600" />
                <span>Product meters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{meters?.length ?? 0} configured</span>
                {canEdit && (
                  <AddProductMeterButton plantId={plantId} onAdded={invalidate} />
                )}
              </div>
            </div>

            {metersLoading ? (
              <div className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meters…
              </div>
            ) : meters?.length ? (
              <ul className="divide-y">
                {meters.map((m: any) => (
                  <li key={m.id}>
                    <ProductMeterRow
                      meter={m}
                      plantId={plantId}
                      latest={latestByMeter[m.id] ?? null}
                      userId={user?.id ?? null}
                      canEdit={canEdit}
                      onSaved={invalidate}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 text-xs text-muted-foreground">
                No product meters configured for this plant.{' '}
                {canEdit && 'Use the + button above to add one.'}
              </div>
            )}
          </Card>

          {/* CSV import dialog */}
          {importOpen && (
            <ImportReadingsDialog
              title="Import Product Meter Readings from CSV"
              module="Product Meter Readings"
              plantId={plantId}
              userId={user?.id ?? null}
              schemaHint="meter_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading"
              templateFilename="product_meter_readings_template.csv"
              templateRow={{
                meter_name: 'Main Line',
                current_reading: '12345.67',
                reading_datetime: '2024-06-15T08:30',
                previous_reading: '12200.00',
              }}
              validateRow={(r, i) => {
                const e: string[] = [];
                if (!r.meter_name?.trim()) e.push(`Row ${i}: meter_name is required`);
                if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
                  e.push(`Row ${i}: current_reading must be a number`);
                if (r.previous_reading && isNaN(Number(r.previous_reading)))
                  e.push(`Row ${i}: previous_reading must be a number`);
                if (r.reading_datetime && isNaN(Date.parse(r.reading_datetime)))
                  e.push(`Row ${i}: reading_datetime is not a valid date`);
                return e;
              }}
              insertRows={async (rows, pid) => {
                // Resolve meter names → IDs
                const { data: meterList } = await supabase
                  .from('product_meters' as any)
                  .select('id, name')
                  .eq('plant_id', pid);
                const nameToId: Record<string, string> = {};
                ((meterList ?? []) as any[]).forEach((m: any) => {
                  nameToId[m.name.toLowerCase()] = m.id;
                });
                let count = 0;
                const errors: string[] = [];
                for (const r of rows) {
                  const meterId = nameToId[r.meter_name?.toLowerCase()];
                  if (!meterId) { errors.push(`Meter not found: "${r.meter_name}"`); continue; }
                  const dt = r.reading_datetime ? new Date(r.reading_datetime).toISOString() : new Date().toISOString();
                  const { error } = await supabase.from('product_meter_readings' as any).insert({
                    meter_id: meterId,
                    plant_id: pid,
                    current_reading: +r.current_reading,
                    previous_reading: r.previous_reading ? +r.previous_reading : null,
                    reading_datetime: dt,
                    recorded_by: user?.id ?? null,
                  } as any);
                  if (error) errors.push(error.message);
                  else count++;
                }
                return { count, errors };
              }}
              onClose={() => setImportOpen(false)}
              onImported={() => { setImportOpen(false); invalidate(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Add product meter button (Manager/Admin only) ─────────────────────────────

function AddProductMeterButton({ plantId, onAdded }: { plantId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Enter a meter name'); return; }
    setBusy(true);
    const { error } = await supabase.from('product_meters' as any).insert({
      plant_id: plantId,
      name: name.trim(),
      sort_order: 0,
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`"${name.trim()}" added`);
    setName(''); setOpen(false); onAdded();
  };

  return (
    <>
      <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={() => setOpen(true)}>
        <span className="text-base leading-none">+</span> Add meter
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setName(''); } setOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add product meter</DialogTitle></DialogHeader>
          <div className="space-y-2 py-1">
            <Label>Meter name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Line, Secondary Line…"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This name appears in Operations → Product and in all audit logs.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Product meter row ─────────────────────────────────────────────────────────

function ProductMeterRow({
  meter, plantId, latest, userId, canEdit, onSaved,
}: {
  meter: any;
  plantId: string;
  latest: any | null;
  userId: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(meter.name ?? '');
  const [nameSaving, setNameSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const previous = latest?.current_reading ?? null;
  const cur = +reading || 0;
  const productionVolume = previous != null && reading ? cur - previous : null;

  const save = async () => {
    if (!reading) { toast.error(`${meter.name}: enter a reading`); return; }
    setSaving(true);
    const dt = new Date().toISOString();
    const { error } = await supabase.from('product_meter_readings' as any).insert({
      meter_id: meter.id,
      plant_id: plantId,
      current_reading: cur,
      previous_reading: previous,
      reading_datetime: dt,
      recorded_by: userId,
    } as any);
    if (error) { toast.error(error.message); setSaving(false); return; }

    // Audit the production volume calculation
    if (productionVolume != null) {
      await logProductionCalc({
        plant_id: plantId,
        meter_id: meter.id,
        meter_name: meter.name,
        entry_name: meter.name,
        production_volume: productionVolume,
        user_id: userId,
        timestamp: dt,
      });
    }

    toast.success(`${meter.name}: reading saved${productionVolume != null ? ` · ${fmtNum(productionVolume)} m³ produced` : ''}`);
    setReading(''); setSaving(false); onSaved();
  };

  const saveName = async () => {
    if (!nameInput.trim()) { toast.error('Name required'); return; }
    setNameSaving(true);
    const { error } = await supabase
      .from('product_meters' as any)
      .update({ name: nameInput.trim() } as any)
      .eq('id', meter.id);
    setNameSaving(false);
    if (error) { toast.error(error.message); return; }

    // Audit name change
    await logProductMeterChange({
      plant_id: plantId,
      meter_id: meter.id,
      meter_name: nameInput.trim(),
      old_value: null,
      new_value: null,
      user_id: userId,
      timestamp: new Date().toISOString(),
    });

    toast.success('Meter name updated');
    setEditingName(false);
    onSaved();
  };

  return (
    <div className="p-3 flex flex-wrap items-center gap-2" data-testid={`product-meter-row-${meter.id}`}>
      {/* Name + rename button */}
      <div className="min-w-0 flex-1 basis-[160px]">
        {editingName ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="h-7 text-sm w-36"
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              autoFocus
            />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={saveName} disabled={nameSaving}>
              {nameSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingName(false); setNameInput(meter.name); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="text-sm font-medium truncate flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-teal-600 shrink-0" />
              {meter.name}
            </div>
            {canEdit && (
              <Button
                size="sm" variant="ghost"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => { setNameInput(meter.name); setEditingName(true); }}
                title="Rename meter"
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">
          prev: <span className="font-mono-num">{previous == null ? '—' : fmtNum(previous)}</span>
          {productionVolume != null && (
            <>
              {' · '}
              <span className="font-mono-num text-teal-600 font-medium">{fmtNum(productionVolume)} m³</span>
              {' produced'}
            </>
          )}
        </div>
      </div>

      {/* Reading input */}
      <div className="relative shrink-0">
        <Gauge className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-600 pointer-events-none" />
        <Input
          type="number" step="any" inputMode="decimal"
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          placeholder="Product Reading"
          className="h-9 pl-7 w-36 border-teal-300 focus-visible:ring-teal-300 bg-teal-50/40 dark:bg-teal-950/20"
          data-testid={`product-meter-input-${meter.id}`}
        />
      </div>

      {/* Save + History */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          onClick={save}
          disabled={saving || !reading}
          size="sm"
          className="h-9 px-3 text-xs"
          data-testid={`product-meter-save-${meter.id}`}
        >
          {saving ? '…' : 'Save'}
        </Button>
        {canEdit && (
          <Button
            variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground"
            onClick={() => setShowHistory(true)} title="View history"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Inline production volume badge */}
      {productionVolume != null && (
        <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-xs">
          <Gauge className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          <span className="text-teal-700 dark:text-teal-300">
            Production volume: <span className="font-mono-num font-semibold">{fmtNum(productionVolume)} m³</span>
            <span className="text-teal-600/70 ml-1.5">(current − previous)</span>
          </span>
        </div>
      )}

      {showHistory && (
        <ProductMeterHistoryDialog
          meter={meter}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ── Product meter history dialog ──────────────────────────────────────────────

function ProductMeterHistoryDialog({ meter, onClose }: { meter: any; onClose: () => void }) {
  const [days, setDays] = useState<7 | 14 | 30 | 60>(7);
  const WINDOWS = [{ label: '7D', days: 7 }, { label: '14D', days: 14 }, { label: '30D', days: 30 }, { label: '60D', days: 60 }] as const;

  const { data: rows, isLoading } = useQuery({
    queryKey: ['product-meter-history', meter.id, days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, reading_datetime')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-teal-600" /> {meter.name} — History
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {WINDOWS.map(({ label, days: d }) => (
            <button key={label} onClick={() => setDays(d as any)}
              className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === d ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>{label}</button>
          ))}
        </div>
        <div className="overflow-auto max-h-80 rounded border text-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !rows?.length ? (
            <p className="p-4 text-center text-muted-foreground">No readings in the last {days} days</p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  <th className="px-3 py-2 font-medium text-right">Reading</th>
                  <th className="px-3 py-2 font-medium text-right">Production (m³)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const vol = r.previous_reading != null
                    ? r.current_reading - r.previous_reading
                    : null;
                  return (
                    <tr key={r.id ?? i} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                      <td className="px-3 py-1.5 text-right font-mono-num text-teal-600">
                        {vol != null ? fmtNum(vol) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Showing up to {days} days · {rows?.length ?? 0} records
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ─── POWER ───────────────────────────────────────────────────────────────────

function PowerForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId]     = useState('');
  const [reading, setReading]     = useState('');
  const [solarKwh, setSolarKwh]   = useState('');
  const [gridKwh, setGridKwh]     = useState('');
  const [dt, setDt]               = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [powerHistoryOpen, setPowerHistoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Multiplier: auto-populated from latest saved electric bill; editable by admin only when no bill exists
  const [multiplierInput, setMultiplierInput] = useState('');

  const plant     = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const showSolar = !!plant?.has_solar;
  const showGrid  = plant?.has_grid !== false;

  // Fetch latest electric bill to get the saved multiplier
  const { data: latestBill, isLoading: billLoading } = useQuery({
    queryKey: ['op-power-bill', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('electric_bills').select('multiplier').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(1)).data?.[0] ?? null
      : null,
    enabled: !!plantId,
  });

  // billMultiplier = value from saved bill (read-only); null = no bill yet
  const billMultiplier: number | null = latestBill?.multiplier ?? null;
  // Effective multiplier used in calculations: bill value takes priority, else admin's input
  const effectiveMultiplier = billMultiplier ?? (+multiplierInput || 1);
  // Admin can type a value only when there is no saved bill
  const multiplierEditable = isAdmin && billMultiplier === null && !billLoading;

  // Auto-reset manual input when plant changes
  const handlePlantChange = (v: string) => { setPlantId(v); setEditingId(null); setMultiplierInput(''); };

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('power_readings').select('*').eq('plant_id', plantId).order('reading_datetime', { ascending: false }).limit(7)).data ?? []
      : [],
    enabled: !!plantId,
  });
  const previous = history?.find((r: any) => r.id !== editingId)?.meter_reading_kwh ?? null;
  const daily    = previous != null && reading ? +reading - previous : null;
  // Effective daily kWh = Δ reading × multiplier
  const dailyEffective = daily != null ? daily * effectiveMultiplier : null;

  const submit = async () => {
    if (!plantId || !reading) return;
    if (!editingId) {
      const dup = await findExistingReading({
        table: 'power_readings', entityCol: 'plant_id', entityId: plantId,
        datetime: new Date(dt), windowKind: 'day',
      });
      if (dup) {
        if (!confirm('A power reading already exists for this plant today. Edit it instead?')) return;
        setEditingId(dup);
      }
    }
    const payload: any = {
      plant_id: plantId, reading_datetime: new Date(dt).toISOString(),
      meter_reading_kwh: +reading, recorded_by: user?.id,
      multiplier: effectiveMultiplier,
    };
    if (showSolar || showGrid) {
      payload.daily_solar_kwh = solarKwh ? +solarKwh : 0;
      payload.daily_grid_kwh  = gridKwh  ? +gridKwh  : 0;
    }
    const { error } = editingId
      ? await supabase.from('power_readings').update(payload).eq('id', editingId)
      : await supabase.from('power_readings').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setSolarKwh(''); setGridKwh(''); setEditingId(null);
    qc.invalidateQueries();
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setSolarKwh(r.daily_solar_kwh != null ? String(r.daily_solar_kwh) : '');
    setGridKwh(r.daily_grid_kwh  != null ? String(r.daily_grid_kwh)  : '');
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <div>
          <Label>Plant</Label>
          {/* Plant row with inline Import button */}
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1">
              <PlantSelector value={plantId} onChange={handlePlantChange} />
            </div>
            {isAdmin && plantId && (
              <Button
                size="sm" variant="outline"
                className="shrink-0 gap-1.5 border-teal-600 text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/30"
                onClick={() => setImportOpen(true)}
                data-testid="import-power-readings-btn"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>
            )}
          </div>
        </div>

        <div>
          <Label>Date &amp; Time</Label>
          <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="h-10 w-full max-w-[260px] min-w-[220px] mx-auto sm:mx-0 block text-center sm:text-left" />
        </div>

        {/* Meter Reading + Multiplier — same row, labels inline */}
        <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
          {/* Left: Meter Reading */}
          <div>
            <Label>Meter Reading {editingId && <span className="text-xs text-highlight">(editing)</span>}</Label>
            <Input type="number" step="any" value={reading} onChange={e => setReading(e.target.value)}
              placeholder="Plant Power Reading" data-testid="power-meter-input" />
          </div>

          {/* Right: Multiplier */}
          <div className="w-28">
            <Label className="flex items-center gap-1">
              Multiplier
              {plantId && !billLoading && (
                billMultiplier !== null
                  ? <span className="text-[10px] text-muted-foreground font-normal">(from bill)</span>
                  : isAdmin
                    ? <span className="text-[10px] text-amber-600 font-normal">(no bill yet)</span>
                    : null
              )}
            </Label>
            <Input
              type="number"
              step="any"
              min="1"
              value={billMultiplier !== null ? billMultiplier : multiplierInput}
              onChange={e => multiplierEditable && setMultiplierInput(e.target.value)}
              readOnly={!multiplierEditable}
              placeholder={billLoading ? '…' : '1'}
              className={[
                'text-center font-mono-num',
                !multiplierEditable ? 'bg-muted cursor-not-allowed text-muted-foreground' : '',
              ].join(' ')}
              title={
                billMultiplier !== null
                  ? `CT multiplier from latest bill (×${billMultiplier}). Update via Costs → Power bill.`
                  : isAdmin
                    ? 'No bill saved yet — enter multiplier manually. Save a bill in Costs to lock it.'
                    : 'Multiplier is set by the latest electric bill.'
              }
              data-testid="power-multiplier-input"
            />
          </div>
        </div>

        {/* Previous reading + daily effective kWh hint */}
        {previous != null && (
          <div className="text-xs text-muted-foreground space-y-0.5 -mt-1">
            <span>
              Previous: <span className="font-mono-num">{fmtNum(previous)}</span>
              {daily != null && <> · Δ <span className="font-mono-num">{fmtNum(daily)} kWh</span></>}
            </span>
            {dailyEffective != null && effectiveMultiplier !== 1 && (
              <div className="inline-flex items-center gap-1.5 ml-2 rounded bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 px-2 py-0.5">
                <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                <span className="font-mono-num font-medium text-amber-700 dark:text-amber-300">
                  {fmtNum(dailyEffective, 2)} kWh
                </span>
                <span className="text-amber-600/70 dark:text-amber-400/60">effective (×{effectiveMultiplier})</span>
              </div>
            )}
          </div>
        )}

        {(showSolar || showGrid) && (
          <details className="rounded-md border bg-muted/30 px-3 py-2" open={showSolar}>
            <summary className="text-xs font-medium cursor-pointer flex items-center gap-2">
              Energy Source Breakdown
              <span className="text-[10px] text-muted-foreground">
                {showSolar && showGrid ? 'Solar + Grid' : showSolar ? 'Solar only' : 'Grid only'}
              </span>
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {showSolar && (
                <div>
                  <Label className="text-xs">Daily Solar (kWh)</Label>
                  <Input type="number" step="any" value={solarKwh}
                    onChange={e => setSolarKwh(e.target.value)} placeholder="kWh from solar" data-testid="power-solar-input" />
                </div>
              )}
              {showGrid && (
                <div>
                  <Label className="text-xs">Daily Grid (kWh)</Label>
                  <Input type="number" step="any" value={gridKwh}
                    onChange={e => setGridKwh(e.target.value)} placeholder="kWh from grid" data-testid="power-grid-input" />
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Optional. Leave blank if you only have a single combined meter.
            </p>
          </details>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} className="flex-1">{editingId ? 'Update' : 'Save'}</Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(null); setReading(''); setSolarKwh(''); setGridKwh(''); }}>Cancel</Button>
          )}
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Last 7 readings</h4>
          {(isAdmin || isManager) && plantId && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground px-2"
              onClick={() => setPowerHistoryOpen(true)}>
              <History className="h-3 w-3" /> Full history
            </Button>
          )}
        </div>
        {history?.length ? history.map((r: any) => (
          <div key={r.id} className="flex justify-between items-center text-xs py-1.5 border-t">
            <span className="flex-1">{format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm')}</span>
            <span className="font-mono-num mr-2">{fmtNum(r.daily_consumption_kwh ?? 0)} kWh</span>
            {(r.daily_solar_kwh > 0 || r.daily_grid_kwh > 0) && (
              <span className="font-mono-num mr-2 text-[10px] text-muted-foreground">
                ☀{fmtNum(r.daily_solar_kwh ?? 0)} · ⚡{fmtNum(r.daily_grid_kwh ?? 0)}
              </span>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )) : <p className="text-xs text-muted-foreground">No readings</p>}
      </Card>

      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Readings from CSV"
          module="Power Readings"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={POWER_SCHEMA}
          templateFilename="power_readings_template.csv"
          templateRow={POWER_TEMPLATE_ROW}
          validateRow={validatePowerRow}
          insertRows={(rows, pid) => insertPowerReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); qc.invalidateQueries({ queryKey: ['op-power', plantId] }); }}
        />
      )}
      {powerHistoryOpen && plantId && (
        <ReadingHistoryDialog
          entityName={plants?.find((p: any) => p.id === plantId)?.name ?? 'Plant'}
          module="power"
          entityId={plantId}
          onClose={() => setPowerHistoryOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Reading History Dialog ───────────────────────────────────────────────────

type HistoryModule = 'locator' | 'well' | 'blending' | 'power';
const HISTORY_WINDOWS = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '60D', days: 60 },
] as const;

function ReadingHistoryDialog({ entityName, module, entityId, plantId, onClose }: {
  entityName: string;
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  onClose: () => void;
}) {
  const [days, setDays] = useState<7 | 14 | 30 | 60>(7);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['reading-history', module, entityId, days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceIso = since.toISOString();

      if (module === 'locator') {
        const { data } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceIso)
          .order('reading_datetime', { ascending: false });
        return data ?? [];
      }
      if (module === 'well') {
        const { data } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceIso)
          .order('reading_datetime', { ascending: false });
        return data ?? [];
      }
      if (module === 'power') {
        const { data } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, reading_datetime')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceIso)
          .order('reading_datetime', { ascending: false });
        return data ?? [];
      }
      if (module === 'blending') {
        // Blending events are in MongoDB via backend
        try {
          const res = await fetch(
            `${BASE}/api/blending/history?well_id=${encodeURIComponent(entityId)}&days=${days}`
          );
          if (!res.ok) return [];
          const json = await res.json();
          return json.events ?? [];
        } catch { return []; }
      }
      return [];
    },
  });

  const title = module === 'power' ? `Power — ${entityName}` : `${entityName} — History`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        {/* Window selector */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {HISTORY_WINDOWS.map(({ label, days: d }) => (
            <button
              key={label}
              onClick={() => setDays(d as any)}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === d ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-auto max-h-80 rounded border text-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !rows?.length ? (
            <p className="p-4 text-center text-muted-foreground">No readings in the last {days} days</p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {module === 'locator' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ m³</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </>}
                  {module === 'well' && <>
                    <th className="px-3 py-2 font-medium text-right">Water (m³)</th>
                    <th className="px-3 py-2 font-medium text-right">Δ m³</th>
                    <th className="px-3 py-2 font-medium text-right">Power (kWh)</th>
                  </>}
                  {module === 'blending' && <>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                  </>}
                  {module === 'power' && <>
                    <th className="px-3 py-2 font-medium text-right">Daily (kWh)</th>
                    <th className="px-3 py-2 font-medium text-right">Solar</th>
                    <th className="px-3 py-2 font-medium text-right">Grid</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const dt = r.reading_datetime ?? r.event_date ?? r.created_at ?? '';
                  const dateStr = dt
                    ? format(new Date(dt), 'MMM d, yyyy HH:mm')
                    : '—';
                  return (
                    <tr key={r.id ?? i} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{dateStr}</td>
                      {module === 'locator' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.previous_reading != null ? fmtNum(r.current_reading - r.previous_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.off_location_flag && <span className="text-amber-600 font-medium">off-loc</span>}
                        </td>
                      </>}
                      {module === 'well' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.previous_reading != null ? fmtNum(r.current_reading - r.previous_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.power_meter_reading != null ? fmtNum(r.power_meter_reading) : '—'}
                        </td>
                      </>}
                      {module === 'blending' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.volume_m3 ?? 0)}</td>
                      </>}
                      {module === 'power' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.daily_consumption_kwh ?? 0)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num text-yellow-600">{fmtNum(r.daily_solar_kwh ?? 0)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num text-blue-600">{fmtNum(r.daily_grid_kwh ?? 0)}</td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          Showing up to {days} days of history · {rows?.length ?? 0} records
        </p>
      </DialogContent>
    </Dialog>
  );
}
