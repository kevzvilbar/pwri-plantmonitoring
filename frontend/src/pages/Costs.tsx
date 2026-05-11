import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, FileText, AlertCircle, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';

import { StatusPill } from '@/components/StatusPill';
import { ExportButton } from '@/components/ExportButton';
import { fmtNum } from '@/lib/calculations';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, subMonths, parseISO } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';

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

function triggerTemplateDownload(filename: string, _headers: string[], exampleRow: Record<string, string>) {
  downloadCSV(filename, [exampleRow]);
}

// ─── Import audit logger ─────────────────────────────────────────────────────

async function logBillingImport(entry: {
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

// ─── Duplicate decision state (module-level, reset each import run) ──────────

const _billingDupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();
function clearBillingDupDecisions() { _billingDupDecisions.clear(); }

let _billingDupPromptResolver: ((d: 'overwrite' | 'skip') => void) | null = null;
let _billingDupShowPrompt: ((label: string, isDateOnly: boolean) => void) | null = null;
let _billingBulkDupDecision: 'overwrite' | 'skip' | null = null;
function clearBillingBulkDupDecision() { _billingBulkDupDecision = null; }

async function resolveBillingDuplicate(key: string, label: string, isDateOnly = false): Promise<'overwrite' | 'skip'> {
  if (_billingDupDecisions.has(key)) return _billingDupDecisions.get(key)!;
  if (_billingBulkDupDecision) {
    _billingDupDecisions.set(key, _billingBulkDupDecision);
    return _billingBulkDupDecision;
  }
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _billingDupPromptResolver = resolve;
    _billingDupShowPrompt?.(label, isDateOnly);
  });
  _billingDupDecisions.set(key, decision);
  return decision;
}

// ─── Shared ImportReadingsDialog ─────────────────────────────────────────────

interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;
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
  const [file, setFile]         = useState<File | null>(null);
  const [rows, setRows]         = useState<Record<string, string>[]>([]);
  const [errors, setErrors]     = useState<string[]>([]);
  const [busy, setBusy]         = useState(false);
  const [done, setDone]         = useState(false);
  const [imported, setImported] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [_dupRows, setDupRows]  = useState<Record<string, string>[]>([]);
  const [dupResolved, setDupResolved] = useState(false);
  const [dupConfirm, setDupConfirm]   = useState<{ label: string; isDateOnly: boolean } | null>(null);

  useEffect(() => {
    _billingDupShowPrompt = (label, isDateOnly) => setDupConfirm({ label, isDateOnly });
    return () => { _billingDupShowPrompt = null; _billingDupPromptResolver = null; };
  }, []);

  const handleDupDecision = (decision: 'overwrite' | 'skip', applyToAll = false) => {
    if (applyToAll) _billingBulkDupDecision = decision;
    setDupConfirm(null);
    _billingDupPromptResolver?.(decision);
    _billingDupPromptResolver = null;
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setDone(false); setErrors([]); setRows([]); setDupRows([]); setDupResolved(false); setImportErrors([]);
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
    clearBillingDupDecisions();
    clearBillingBulkDupDecision();
    const ts = new Date().toISOString();

    // Intra-file duplicate detection (billing_month is the key per plant)
    const seenKeys = new Map<string, number>();
    const intraDups: number[] = [];
    rows.forEach((r, i) => {
      const key = (r.billing_month || '').trim().slice(0, 7); // YYYY-MM
      if (seenKeys.has(key)) intraDups.push(i);
      else seenKeys.set(key, i);
    });

    if (intraDups.length > 0 && !dupResolved) {
      setRows(rows.filter((_r, i) => !intraDups.includes(i)));
      setDupResolved(true);
      setBusy(false);
      return;
    }

    const { count, errors: importErrors } = await insertRows(rows, plantId);
    await logBillingImport({
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
    setImportErrors(importErrors);
    setDone(true);
    if (importErrors.length) toast.error(`${count} imported, ${importErrors.length} failed`);
    else if (count === 0) toast.info('No rows imported — all duplicates were skipped.');
    else toast.success(`${count} bill(s) imported`);
    if (count > 0) onImported();
  };

  const canSubmit = !busy && !!file && rows.length > 0 && errors.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
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
              Columns marked <strong>*</strong> are required.{' '}
              <code>billing_month</code> accepts <code>YYYY-MM-DD</code> or <code>M/D/YYYY</code> — always stored as first of month.
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
                        {Object.values(r).map((val, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap text-foreground max-w-[120px] truncate">{val || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {done && imported > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
              {imported} record(s) imported. Audit log written.
            </p>
          )}

          {done && importErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {imported} imported · {importErrors.length} failed
              </p>
              <ul className="text-[10px] text-destructive list-disc ml-4 space-y-0.5 max-h-32 overflow-y-auto">
                {importErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* Intra-file duplicate notice */}
          {dupResolved && !done && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Duplicate billing months within the file were removed — only the first occurrence is kept. Click <strong>Import Rows</strong> to proceed.</span>
            </div>
          )}

          {/* DB-level duplicate confirmation */}
          {dupConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Duplicate detected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                A bill for <strong>"{dupConfirm.label}"</strong> already exists{' '}
                {dupConfirm.isDateOnly ? 'for this billing month' : 'at this date'}.
                Overwrite it, or skip this row?
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs" onClick={() => handleDupDecision('overwrite')}>Overwrite</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip')}>Skip</Button>
                <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs" onClick={() => handleDupDecision('overwrite', true)} title="Overwrite this and all remaining duplicates">Overwrite All</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip', true)} title="Skip this and all remaining duplicates">Skip All</Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!dupConfirm}>Cancel</Button>
          <Button
            onClick={doImport}
            disabled={!canSubmit}
            className="bg-teal-700 text-white hover:bg-teal-800"
          >
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Power Billing CSV config ─────────────────────────────────────────────────

const BILLING_SCHEMA = 'billing_month* (YYYY-MM-DD), period_start, period_end, previous_reading, current_reading, multiplier, generation_charge, distribution_charge, other_charges, total_amount*, provider, remarks';

const BILLING_TEMPLATE_ROW: Record<string, string> = {
  billing_month: '2026-05-01',
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  previous_reading: '12000',
  current_reading: '12950',
  multiplier: '120',
  generation_charge: '15000',
  distribution_charge: '8000',
  other_charges: '2000',
  total_amount: '25000',
  provider: 'VECO / NGCP',
  remarks: '',
};

function validateBillingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.billing_month?.trim()) e.push(`Row ${i}: billing_month is required`);
  else if (isNaN(Date.parse(r.billing_month))) e.push(`Row ${i}: billing_month must be a valid date (YYYY-MM-DD)`);
  if (!r.total_amount?.trim() || isNaN(Number(r.total_amount)) || Number(r.total_amount) < 0)
    e.push(`Row ${i}: total_amount is required and must be a non-negative number`);
  if (r.period_start && isNaN(Date.parse(r.period_start))) e.push(`Row ${i}: period_start is not a valid date`);
  if (r.period_end   && isNaN(Date.parse(r.period_end)))   e.push(`Row ${i}: period_end is not a valid date`);
  if (r.previous_reading    && isNaN(Number(r.previous_reading)))    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.current_reading     && isNaN(Number(r.current_reading)))     e.push(`Row ${i}: current_reading must be a number`);
  if (r.multiplier          && isNaN(Number(r.multiplier)))          e.push(`Row ${i}: multiplier must be a number`);
  if (r.generation_charge   && isNaN(Number(r.generation_charge)))   e.push(`Row ${i}: generation_charge must be a number`);
  if (r.distribution_charge && isNaN(Number(r.distribution_charge))) e.push(`Row ${i}: distribution_charge must be a number`);
  if (r.other_charges       && isNaN(Number(r.other_charges)))       e.push(`Row ${i}: other_charges must be a number`);
  return e;
}

// Normalise any parseable date string to YYYY-MM-DD (local date, no timezone shift).
// Handles M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD, and ISO strings.
function normDate(val: string | undefined): string | null {
  if (!val?.trim()) return null;
  const s = val.trim();
  // Already YYYY-MM-DD — return as-is to avoid any UTC shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Format in local time so M/D/YYYY dates don't shift by a day
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function insertBillingRows(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  for (const r of rows) {
    // Normalise billing_month → first-of-month YYYY-MM-DD regardless of input format
    const parsedBillingDate = normDate(r.billing_month);
    if (!parsedBillingDate) { errors.push(`billing_month invalid: "${r.billing_month}"`); continue; }
    const billingMonth = parsedBillingDate.slice(0, 7) + '-01'; // always first of month

    // Normalise all other date fields
    const periodStart = normDate(r.period_start);
    const periodEnd   = normDate(r.period_end);

    // Duplicate check: same plant + same billing_month
    const { data: existing } = await supabase
      .from('electric_bills')
      .select('id')
      .eq('plant_id', plantId)
      .eq('billing_month', billingMonth)
      .limit(1);

    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: billingMonth,
      period_start:        periodStart,
      period_end:          periodEnd,
      previous_reading:    r.previous_reading    !== '' && r.previous_reading    != null ? +r.previous_reading    : null,
      current_reading:     r.current_reading     !== '' && r.current_reading     != null ? +r.current_reading     : null,
      multiplier:          r.multiplier          !== '' && r.multiplier          != null ? +r.multiplier          : 1,
      generation_charge:   r.generation_charge   !== '' && r.generation_charge   != null ? +r.generation_charge   : null,
      distribution_charge: r.distribution_charge !== '' && r.distribution_charge != null ? +r.distribution_charge : null,
      other_charges:       r.other_charges       !== '' && r.other_charges       != null ? +r.other_charges       : null,
      total_amount:        +r.total_amount,
      remarks:             r.remarks             || 'Imported',
      recorded_by:         userId,
    };

    if (existing && existing.length > 0) {
      const label = `Bill @ ${billingMonth.slice(0, 7)}`;
      const decision = await resolveBillingDuplicate(`${plantId}|${billingMonth}`, label, true);
      if (decision === 'skip') continue;
      const { error } = await supabase.from('electric_bills').update(payload).eq('id', existing[0].id);
      if (error) errors.push(`${billingMonth}: ${error.message}`); else count++;
    } else {
      const { error } = await supabase.from('electric_bills').insert(payload);
      if (error) errors.push(`${billingMonth}: ${error.message}`); else count++;
    }
  }
  return { count, errors };
}

export default function Costs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rollup';
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Costs</h1>
        <p className="text-sm text-muted-foreground">Production cost, power bills & tariffs, chemical prices</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="grid grid-cols-4 w-full h-auto bg-muted rounded-xl p-1">
          <TabsTrigger value="rollup" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Rollup</TabsTrigger>
          <TabsTrigger value="power" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Power</TabsTrigger>
          <TabsTrigger value="compare" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Compare</TabsTrigger>
          <TabsTrigger value="prices" className="text-xs sm:text-sm py-2 rounded-lg data-[state=active]:bg-teal-700 data-[state=active]:text-white data-[state=active]:shadow-sm">Prices</TabsTrigger>
        </TabsList>
        <TabsContent value="rollup" className="mt-3"><Rollup /></TabsContent>
        <TabsContent value="power" className="mt-3"><Power /></TabsContent>
        {/* "tariff" and "bills" tabs removed — both merged into the Power tab */}
        <TabsContent value="compare" className="mt-3"><Compare /></TabsContent>
        <TabsContent value="prices" className="mt-3"><ChemicalPrices /></TabsContent>
      </Tabs>
    </div>
  );
}

function ChemicalPrices() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
  const KNOWN = ['Chlorine', 'SMBS', 'Anti Scalant', 'Soda Ash', 'Caustic Soda', 'HCl', 'SLS'];
  const UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal', '__custom__'];

  // ── Add form state ───────────────────────────────────────────────────────────
  const [v, setV] = useState({ chemical_name: '', custom: '', unit: 'kg', customUnit: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });

  // ── Inline edit state ────────────────────────────────────────────────────────
  const [editId, setEditId]     = useState<string | null>(null);
  const [editV, setEditV]       = useState({ chemical_name: '', unit_price: '', effective_date: '' });
  const [saving, setSaving]     = useState(false);

  // ── Delete confirm state ─────────────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data } = useQuery({
    queryKey: ['chem-prices'],
    queryFn: async () => (await supabase.from('chemical_prices').select('*').order('effective_date', { ascending: false }).limit(50)).data ?? [],
  });

  // ── Add new price ────────────────────────────────────────────────────────────
  const submit = async () => {
    const finalName = v.chemical_name === '__custom__' ? v.custom.trim() : v.chemical_name;
    const finalUnit = v.unit === '__custom__' ? v.customUnit.trim() : v.unit;
    if (!finalName || !v.unit_price || !finalUnit) { toast.error('Chemical, unit and price required'); return; }
    const { error } = await supabase.from('chemical_prices').insert({
      chemical_name: `${finalName} (${finalUnit})`, unit_price: +v.unit_price,
      effective_date: v.effective_date, updated_by: user?.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Price added');
    setV({ chemical_name: '', custom: '', unit: 'kg', customUnit: '', unit_price: '', effective_date: format(new Date(), 'yyyy-MM-dd') });
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  // ── Start editing a row ──────────────────────────────────────────────────────
  const startEdit = (p: any) => {
    setDeleteId(null);
    setEditId(p.id);
    setEditV({
      chemical_name: p.chemical_name ?? '',
      unit_price: String(p.unit_price ?? ''),
      effective_date: p.effective_date ?? '',
    });
  };

  const cancelEdit = () => setEditId(null);

  // ── Save edited row ──────────────────────────────────────────────────────────
  const saveEdit = async () => {
    if (!editId) return;
    const price = parseFloat(editV.unit_price);
    if (!editV.chemical_name.trim() || isNaN(price) || price < 0 || !editV.effective_date) {
      toast.error('Chemical name, price (≥ 0) and date are required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('chemical_prices').update({
      chemical_name:  editV.chemical_name.trim(),
      unit_price:     price,
      effective_date: editV.effective_date,
      updated_by:     user?.id,
    }).eq('id', editId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Price updated');
    setEditId(null);
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  // ── Delete a row ─────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from('chemical_prices').delete().eq('id', deleteId);
    setDeleting(false);
    setDeleteId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Price record deleted');
    qc.invalidateQueries({ queryKey: ['chem-prices'] });
    qc.invalidateQueries({ queryKey: ['chem-current-prices'] });
  };

  return (
    <div className="space-y-3">
      {/* ── Add price form ─────────────────────────────────────────────────── */}
      <Card className="p-3 space-y-2">
        <h4 className="text-sm font-semibold">Add price</h4>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label className="text-xs">Chemical</Label>
            <Select value={v.chemical_name} onValueChange={(x) => setV({ ...v, chemical_name: x })}>
              <SelectTrigger><SelectValue placeholder="Pick chemical" /></SelectTrigger>
              <SelectContent>
                {KNOWN.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {v.chemical_name === '__custom__' && (
              <Input className="mt-2" placeholder="Custom name" value={v.custom} onChange={(e) => setV({ ...v, custom: e.target.value })} />
            )}
          </div>
          <div>
            <Label className="text-xs">Unit</Label>
            <Select value={v.unit} onValueChange={(x) => setV({ ...v, unit: x })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.filter(u => u !== '__custom__').map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                <SelectItem value="__custom__">+ Custom…</SelectItem>
              </SelectContent>
            </Select>
            {v.unit === '__custom__' && (
              <Input className="mt-2" placeholder="e.g. drum" value={v.customUnit} onChange={(e) => setV({ ...v, customUnit: e.target.value })} />
            )}
          </div>
          <div>
            <Label className="text-xs">Price ₱ / {v.unit === '__custom__' ? (v.customUnit || 'unit') : v.unit}</Label>
            <Input type="number" step="any" value={v.unit_price} onChange={(e) => setV({ ...v, unit_price: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Effective date</Label>
            <Input type="date" value={v.effective_date} onChange={(e) => setV({ ...v, effective_date: e.target.value })} />
          </div>
        </div>
        <Button onClick={submit} className="w-full bg-teal-700 hover:bg-teal-800 text-white" size="sm">Add price</Button>
      </Card>

      {/* ── Price history table ────────────────────────────────────────────── */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Price history</h4>
          <ExportButton table="chemical_prices" label="Export" />
        </div>

        {/* Column headers */}
        <div className={`grid gap-2 text-[10px] text-muted-foreground pb-1 border-b ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
          <div>Chemical</div>
          <div className="text-right">Price</div>
          <div className="text-right">Date</div>
          {canEdit && <div />}
        </div>

        {/* Rows */}
        {data?.map((p: any) => {
          const isEditing = editId === p.id;
          const isPendingDelete = deleteId === p.id;

          // ── Inline edit row ──────────────────────────────────────────────
          if (isEditing) {
            return (
              <div key={p.id} className="py-2 border-b last:border-0 space-y-2">
                <div className="grid grid-cols-[1fr_90px_80px] gap-2 items-start">
                  <Input
                    className="h-7 text-xs"
                    value={editV.chemical_name}
                    onChange={(e) => setEditV({ ...editV, chemical_name: e.target.value })}
                    placeholder="Chemical name"
                  />
                  <Input
                    className="h-7 text-xs font-mono-num"
                    type="number"
                    step="any"
                    min="0"
                    value={editV.unit_price}
                    onChange={(e) => setEditV({ ...editV, unit_price: e.target.value })}
                    placeholder="Price"
                  />
                  <Input
                    className="h-7 text-xs"
                    type="date"
                    value={editV.effective_date}
                    onChange={(e) => setEditV({ ...editV, effective_date: e.target.value })}
                  />
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={cancelEdit}
                    disabled={saving}
                  >
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 bg-teal-700 hover:bg-teal-800 text-white"
                    onClick={saveEdit}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </Button>
                </div>
              </div>
            );
          }

          // ── Delete confirm row ───────────────────────────────────────────
          if (isPendingDelete) {
            return (
              <div key={p.id} className="py-2 border-b last:border-0">
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2">
                  <p className="text-xs text-destructive font-medium">
                    Delete <strong>{p.chemical_name}</strong> — ₱{(+p.unit_price).toFixed(2)} ({p.effective_date})?
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      onClick={() => setDeleteId(null)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs flex-1 gap-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      onClick={confirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          // ── Normal read row ──────────────────────────────────────────────
          return (
            <div key={p.id} className={`grid gap-2 text-xs py-1.5 border-b last:border-0 items-center ${canEdit ? 'grid-cols-[1fr_90px_80px_56px]' : 'grid-cols-[1fr_100px_90px]'}`}>
              <span>{p.chemical_name}</span>
              <span className="font-mono-num font-semibold text-right">₱{(+p.unit_price).toFixed(2)}</span>
              <span className="text-muted-foreground font-mono-num text-right">{p.effective_date}</span>
              {canEdit && (
                <div className="flex gap-1 justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    title="Edit"
                    onClick={() => startEdit(p)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    title="Delete"
                    onClick={() => { setEditId(null); setDeleteId(p.id); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {!data?.length && <p className="text-xs text-muted-foreground py-2 text-center">No prices yet</p>}
      </Card>
    </div>
  );
}

function PlantPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>{plants?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Rollup() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  const [from, setFrom] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data, refetch } = useQuery({
    queryKey: ['cost-rollup', plantId, from, to],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await supabase.from('production_costs')
        .select('*').eq('plant_id', plantId)
        .gte('cost_date', from).lte('cost_date', to)
        .order('cost_date');
      return data ?? [];
    },
    enabled: !!plantId,
  });

  const totals = useMemo(() => {
    const r = (data ?? []).reduce((acc: any, x: any) => {
      acc.chem += +x.chem_cost || 0; acc.power += +x.power_cost || 0;
      acc.prod += +x.production_m3 || 0;
      return acc;
    }, { chem: 0, power: 0, prod: 0 });
    return { ...r, total: r.chem + r.power, perM3: r.prod ? (r.chem + r.power) / r.prod : null };
  }, [data]);

  const chartData = (data ?? []).map((d: any) => ({
    date: d.cost_date ? format(parseISO(d.cost_date), 'MMM d') : '—',
    chem: +d.chem_cost || 0,
    power: +d.power_cost || 0,
    perM3: +d.cost_per_m3 || 0,
  }));

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div><Label className="text-xs">Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="flex-1 min-w-0"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
      </Card>
      {plantId && (
        <>
          <div className="flex justify-end">
            <ExportButton table="production_costs" label="Export rollup" filters={{ plant_id: plantId }} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card className="p-3"><div className="text-xs text-muted-foreground">Chem cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.chem, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Power cost</div><div className="font-mono-num text-lg">₱{fmtNum(totals.power, 0)}</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Production</div><div className="font-mono-num text-lg">{fmtNum(totals.prod, 0)} m³</div></Card>
            <Card className="p-3"><div className="text-xs text-muted-foreground">Cost/m³</div><div className="font-mono-num text-lg">{totals.perM3 ? `₱${totals.perM3.toFixed(2)}` : '—'}</div></Card>
          </div>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Daily costs</h4>
            <div className="h-64 sm:h-72">
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="chem" stackId="c" fill="hsl(var(--chart-2))" name="Chem ₱" />
                  <Bar dataKey="power" stackId="c" fill="hsl(var(--chart-1))" name="Power ₱" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <CostInsights rows={data ?? []} totals={totals} from={from} to={to} />
        </>
      )}
      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}
    </div>
  );
}

function CostInsights({ rows, totals, from, to }: { rows: any[]; totals: any; from: string; to: string }) {
  const insights = useMemo(() => {
    const out: { label: string; tone: 'accent' | 'warn' | 'danger' | 'info'; text: string }[] = [];
    if (!rows.length) return out;
    const days = rows.length;
    const avgCost = totals.total / days;
    const peak = rows.reduce((m: any, r: any) => ((+r.chem_cost + +r.power_cost) > (+m.chem_cost + +m.power_cost) ? r : m), rows[0]);
    const peakTotal = (+peak.chem_cost || 0) + (+peak.power_cost || 0);
    const chemShare = totals.total ? (totals.chem / totals.total) * 100 : 0;
    out.push({ label: 'Period', tone: 'info', text: `${days} day(s) · ₱${fmtNum(avgCost, 0)} avg/day · ${chemShare.toFixed(0)}% chem / ${(100 - chemShare).toFixed(0)}% power.` });
    if (avgCost > 0 && peakTotal > avgCost * 1.5) {
      out.push({ label: 'Spike', tone: 'warn', text: `${peak.cost_date}: ₱${fmtNum(peakTotal, 0)} (${((peakTotal / avgCost - 1) * 100).toFixed(0)}% above average). Check for tariff change or chemical top-up.` });
    }
    if (totals.perM3 && totals.perM3 > 25) {
      out.push({ label: 'Cost/m³', tone: 'danger', text: `₱${totals.perM3.toFixed(2)}/m³ exceeds ₱25 benchmark. Review power efficiency or chemical dosing.` });
    } else if (totals.perM3) {
      out.push({ label: 'Cost/m³', tone: 'accent', text: `₱${totals.perM3.toFixed(2)}/m³ within healthy range.` });
    }
    if (totals.prod === 0) {
      out.push({ label: 'No production', tone: 'danger', text: 'Production volume is zero — verify well meter readings are recorded.' });
    }
    return out;
  }, [rows, totals]);

  if (!rows.length) return (
    <Card className="p-4 text-center text-sm text-muted-foreground">No cost data in {from} → {to}</Card>
  );

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Auto insights</h4>
        <span className="text-[10px] text-muted-foreground">Computed monthly · no manual notes needed</span>
      </div>
      <div className="space-y-1.5">
        {insights.map((i, idx) => (
          <div key={`${i.tone ?? 'none'}-${i.label}-${idx}`} className="flex items-start gap-2 text-xs">
            <StatusPill tone={i.tone}>{i.label}</StatusPill>
            <span className="flex-1 pt-0.5">{i.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Power() {
  const qc = useQueryClient();
  const { user, isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  // Month dropdown: generate last 24 months + next 2
  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = -2; i <= 23; i++) {
      const d = subMonths(startOfMonth(new Date()), i);
      opts.push({ value: format(d, 'yyyy-MM-dd'), label: format(d, 'MMMM yyyy') });
    }
    return opts.reverse();
  }, []);

  const [v, setV] = useState({
    billing_month: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    period_start: format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    period_end: format(endOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'),
    previous_reading: '', current_reading: '', multiplier: '1',
    generation_charge: '', distribution_charge: '', other_charges: '', total_amount: '',
    provider: '', remarks: '',
  });

  // Multiplier confirmation dialog state
  const [pendingMultiplier, setPendingMultiplier] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Track whether auto-populate from useEffect is running so we skip the confirm dialog
  const skipConfirmRef = { current: false };

  const totalKwh = v.previous_reading && v.current_reading
    ? (+v.current_reading - +v.previous_reading) * (+v.multiplier || 1) : null;
  const derivedRate = totalKwh && totalKwh > 0 && +v.total_amount ? (+v.total_amount / totalKwh) : null;

  const { data: bills } = useQuery({
    queryKey: ['bills', plantId],
    queryFn: async () => plantId ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });
  const { data: tariffs } = useQuery({
    queryKey: ['tariffs', plantId],
    queryFn: async () => plantId ? (await supabase.from('power_tariffs').select('*').eq('plant_id', plantId).order('effective_date', { ascending: false })).data ?? [] : [],
    enabled: !!plantId,
  });

  // Auto-populate multiplier from last bill — skip confirm dialog during init
  useEffect(() => {
    if (bills && bills.length > 0) {
      const lastBill = bills[0] as any;
      if (lastBill.multiplier && lastBill.multiplier !== 1) {
        skipConfirmRef.current = true;
        setV(prev => ({ ...prev, multiplier: String(lastBill.multiplier) }));
      }
    }
  }, [bills]);

  const handleMultiplierChange = (val: string) => {
    if (!canEdit) return;
    if (skipConfirmRef.current) { skipConfirmRef.current = false; return; }
    const current = v.multiplier;
    if (val !== current && bills && bills.length > 0) {
      setPendingMultiplier(val);
      setConfirmOpen(true);
    } else {
      setV({ ...v, multiplier: val });
    }
  };

  const submit = async () => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    if (!v.total_amount) { toast.error('Total amount is required'); return; }
    if (totalKwh !== null && totalKwh < 0) { toast.error('Current reading is less than previous — check meter values'); return; }

    // Build payload — omit total_kwh entirely: it is a GENERATED column in the DB
    // and Supabase will throw "cannot insert a non-DEFAULT value" if we supply it.
    // The DB computes it as (current_reading - previous_reading) * multiplier automatically.
    const payload: Record<string, any> = {
      plant_id: plantId,
      billing_month: v.billing_month,
      period_start: v.period_start || null,
      period_end: v.period_end || null,
      previous_reading: v.previous_reading ? +v.previous_reading : null,
      current_reading: v.current_reading ? +v.current_reading : null,
      multiplier: +v.multiplier || 1,
      generation_charge: v.generation_charge ? +v.generation_charge : null,
      distribution_charge: v.distribution_charge ? +v.distribution_charge : null,
      other_charges: v.other_charges ? +v.other_charges : null,
      total_amount: +v.total_amount,
      remarks: v.remarks || null,
      recorded_by: user?.id,
    };

    const billRes = await supabase.from('electric_bills').insert(payload);
    if (billRes.error) { toast.error(billRes.error.message); return; }

    if (derivedRate) {
      await supabase.from('power_tariffs').insert({
        plant_id: plantId, effective_date: v.period_start || v.billing_month,
        rate_per_kwh: derivedRate, multiplier: +v.multiplier || 1,
        provider: v.provider || null,
        remarks: `Derived from bill ${format(parseISO(v.billing_month), 'MMM yyyy')}`,
        created_by: user?.id,
      });
    }
    toast.success(derivedRate ? 'Bill saved · tariff auto-derived' : 'Bill saved');
    // Reset meter reading fields but keep plant/month context for quick re-entry
    setV(prev => ({ ...prev, previous_reading: '', current_reading: '', total_amount: '', generation_charge: '', distribution_charge: '', other_charges: '', remarks: '' }));
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['tariffs'] });
  };

  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-3">
      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Billing from CSV"
          module="power_billing"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={BILLING_SCHEMA}
          templateFilename="power_billing_template.csv"
          templateRow={BILLING_TEMPLATE_ROW}
          validateRow={validateBillingRow}
          insertRows={(rows, pid) => insertBillingRows(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            qc.invalidateQueries({ queryKey: ['bills'] });
            qc.invalidateQueries({ queryKey: ['tariffs'] });
          }}
        />
      )}

      <Card className="p-3 space-y-3">
        <div>
          <Label className="text-xs">Plant</Label>
          <div className="flex gap-2 items-center">
            <div className="flex-1"><PlantPicker value={plantId} onChange={setPlantId} /></div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 h-9 text-xs whitespace-nowrap"
              onClick={() => { if (!plantId) { toast.error('Select a plant first'); return; } setImportOpen(true); }}
            >
              Import
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Billing</div>
          <div className="grid grid-cols-2 gap-2">
            {/* Billing Month — dropdown instead of date picker */}
            <div>
              <Label className="text-xs">Billing month</Label>
              <Select value={v.billing_month} onValueChange={(val) => setV({ ...v, billing_month: val })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Provider</Label><Input value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })} placeholder="VECO / NGCP" /></div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 min-w-0"><Label className="text-xs">Period from</Label><Input type="date" value={v.period_start} onChange={(e) => setV({ ...v, period_start: e.target.value })} /></div>
            <div className="flex-1 min-w-0"><Label className="text-xs">Period to</Label><Input type="date" value={v.period_end} onChange={(e) => setV({ ...v, period_end: e.target.value })} /></div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Meter</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Previous</Label><Input type="number" step="any" value={v.previous_reading} onChange={(e) => setV({ ...v, previous_reading: e.target.value })} /></div>
            <div><Label className="text-xs">Current</Label><Input type="number" step="any" value={v.current_reading} onChange={(e) => setV({ ...v, current_reading: e.target.value })} /></div>
          </div>
          {/* Multiplier + Total kWh on same row */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs flex items-center gap-1">
                Multiplier
                {!canEdit && <span className="text-[10px] text-muted-foreground">(read-only)</span>}
              </Label>
              <Input
                type="number" step="any" value={v.multiplier}
                readOnly={!canEdit}
                className={!canEdit ? 'bg-muted cursor-not-allowed' : ''}
                onChange={(e) => handleMultiplierChange(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Total kWh (auto)</Label>
              <Input value={totalKwh != null ? fmtNum(totalKwh, 2) : ''} readOnly className="bg-muted" />
            </div>
          </div>
          {canEdit && (
            <p className="text-[10px] text-muted-foreground">
              Multiplier auto-fills from the last saved bill. Change only if the meter transformer ratio changes.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Charges (₱)</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Generation</Label><Input type="number" step="any" value={v.generation_charge} onChange={(e) => setV({ ...v, generation_charge: e.target.value })} /></div>
            <div><Label className="text-xs">Distribution</Label><Input type="number" step="any" value={v.distribution_charge} onChange={(e) => setV({ ...v, distribution_charge: e.target.value })} /></div>
            <div><Label className="text-xs">Other</Label><Input type="number" step="any" value={v.other_charges} onChange={(e) => setV({ ...v, other_charges: e.target.value })} /></div>
            <div><Label className="text-xs font-semibold">Total</Label><Input type="number" step="any" value={v.total_amount} onChange={(e) => setV({ ...v, total_amount: e.target.value })} /></div>
          </div>
        </div>

        {derivedRate && (
          <div className="rounded-md bg-accent-soft border border-accent/30 p-2 text-xs">
            <span className="font-semibold">Auto-derived tariff:</span>{' '}
            <span className="font-mono-num">₱{derivedRate.toFixed(4)}/kWh</span>
            <span className="text-muted-foreground"> · effective {v.period_start}</span>
          </div>
        )}

        <div><Label className="text-xs">Remarks</Label><Input value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></div>
        <Button onClick={submit} className="w-full">Save bill {derivedRate ? '+ tariff' : ''}</Button>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Recent bills</h4>
          {plantId && <ExportButton table="electric_bills" label="Export" filters={{ plant_id: plantId }} />}
        </div>
        <div className="space-y-1.5">
          {bills?.map((b: any) => (
            <div key={b.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{b.billing_month ? format(parseISO(b.billing_month), 'MMM yyyy') : '—'}</div>
                <div className="text-muted-foreground font-mono-num">{fmtNum(b.total_kwh, 0)} kWh · ₱{b.total_kwh && +b.total_kwh > 0 ? (+b.total_amount / +b.total_kwh).toFixed(4) : '—'}/kWh · ×{b.multiplier}</div>
              </div>
              <div className="font-mono-num font-semibold">₱{fmtNum(b.total_amount, 2)}</div>
            </div>
          ))}
          {!bills?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No bills yet</p>}
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Tariff history</h4>
          {plantId && <ExportButton table="power_tariffs" label="Export" filters={{ plant_id: plantId }} />}
        </div>
        <div className="space-y-1.5">
          {tariffs?.map((t: any) => (
            <div key={t.id} className="flex justify-between items-center text-xs border-b last:border-0 py-1.5">
              <div>
                <div className="font-mono-num">{t.effective_date}</div>
                <div className="text-muted-foreground">{t.provider ?? '—'} · ×{t.multiplier}</div>
              </div>
              <div className="font-mono-num font-semibold">₱{(+t.rate_per_kwh).toFixed(4)}/kWh</div>
            </div>
          ))}
          {!tariffs?.length && plantId && <p className="text-xs text-center text-muted-foreground py-2">No tariffs</p>}
        </div>
      </Card>

      {/* Multiplier change confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Multiplier?</AlertDialogTitle>
            <AlertDialogDescription>
              The multiplier is changing from <strong>×{v.multiplier}</strong> to <strong>×{pendingMultiplier}</strong>.
              This should only be done if the CT/PT transformer ratio on the meter has physically changed.
              All future kWh calculations for this plant will use the new value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingMultiplier(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingMultiplier !== null) setV(prev => ({ ...prev, multiplier: pendingMultiplier }));
                setPendingMultiplier(null);
                setConfirmOpen(false);
              }}
            >
              Yes, change multiplier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function Compare() {
  const { selectedPlantId } = useAppStore();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');
  // Range: '14d' | '30d' | '60d' | '90d' | 'bills' (bill-aligned) | 'custom'
  const [viewMode, setViewMode] = useState<'14d' | '30d' | '60d' | '90d' | 'bills' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');
  // Chart type for daily view
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');

  // ── Date range derived from viewMode ────────────────────────────────────────
  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    if (viewMode === 'custom' && customFrom && customTo) {
      return { rangeStart: customFrom, rangeEnd: customTo };
    }
    if (viewMode === 'bills') return { rangeStart: '', rangeEnd: '' }; // bill-aligned handled below
    const days = viewMode === '14d' ? 14 : viewMode === '30d' ? 30 : viewMode === '60d' ? 60 : 90;
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    return {
      rangeStart: format(start, 'yyyy-MM-dd'),
      rangeEnd:   format(now,   'yyyy-MM-dd'),
    };
  }, [viewMode, customFrom, customTo]);

  // ── Bills query (for bill-aligned view + variance table) ─────────────────
  const { data: bills } = useQuery({
    queryKey: ['bills-cmp', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('electric_bills').select('*').eq('plant_id', plantId).order('billing_month', { ascending: false }).limit(12)).data ?? []
      : [],
    enabled: !!plantId,
  });

  // ── Daily power readings query ─────────────────────────────────────────────
  const queryStart = viewMode === 'bills'
    ? ((bills ?? []) as any[]).slice(-1)[0]?.period_start ?? ''
    : rangeStart;
  const queryEnd = viewMode === 'bills'
    ? ((bills ?? []) as any[])[0]?.period_end ?? ''
    : rangeEnd;

  const { data: dailyKwh, isFetching } = useQuery({
    queryKey: ['daily-kwh-cmp', plantId, queryStart, queryEnd],
    queryFn: async () => {
      if (!plantId || !queryStart || !queryEnd) return [];
      const { data } = await supabase.from('power_readings')
        .select('reading_datetime,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,multiplier')
        .eq('plant_id', plantId)
        .gte('reading_datetime', queryStart)
        .lte('reading_datetime', `${queryEnd}T23:59:59.999Z`)
        .order('reading_datetime', { ascending: true });
      return data ?? [];
    },
    enabled: !!plantId && !!queryStart && !!queryEnd,
  });

  // ── Daily chart data ───────────────────────────────────────────────────────
  const dailyChartData = useMemo(() => {
    if (!dailyKwh?.length) return [];
    return dailyKwh.map((r: any) => {
      const grid   = +(r.daily_consumption_kwh ?? r.daily_grid_kwh ?? 0);
      const solar  = +(r.daily_solar_kwh ?? 0);
      const mult   = +(r.multiplier ?? 1);
      const effective = grid * mult;
      return {
        date: format(new Date(r.reading_datetime), 'MMM d'),
        grid:      +grid.toFixed(1),
        solar:     solar > 0 ? +solar.toFixed(1) : null,
        effective: mult !== 1 ? +effective.toFixed(1) : null,
        total:     +(grid + solar).toFixed(1),
      };
    });
  }, [dailyKwh]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!dailyChartData.length) return null;
    const totalGrid   = dailyChartData.reduce((s, d) => s + d.grid,   0);
    const totalSolar  = dailyChartData.reduce((s, d) => s + (d.solar ?? 0), 0);
    const avgDaily    = totalGrid / dailyChartData.length;
    const peakDay     = dailyChartData.reduce((max, d) => d.total > max.total ? d : max, dailyChartData[0]);
    const solarPct    = (totalGrid + totalSolar) > 0 ? (totalSolar / (totalGrid + totalSolar)) * 100 : 0;
    return { totalGrid, totalSolar, avgDaily, peakDay, solarPct };
  }, [dailyChartData]);

  // ── Bill-aligned variance rows ─────────────────────────────────────────────
  const billRows = useMemo(() => (bills ?? []).map((b: any) => {
    const billMult = b.multiplier ? +b.multiplier : 1;
    const periodReadings = (dailyKwh ?? [])
      .filter((d: any) => d.reading_datetime >= b.period_start && d.reading_datetime <= `${b.period_end}T23:59:59.999Z`);
    const sumDaily = periodReadings.reduce((s: number, d: any) => s + (+d.daily_consumption_kwh || 0), 0);
    const sumEffective = periodReadings.reduce((s: number, d: any) => {
      const mult = d.multiplier != null ? +d.multiplier : billMult;
      return s + (+d.daily_consumption_kwh || 0) * mult;
    }, 0);
    // Billed kWh already reflects CT ratio (utility applies it before issuing the bill).
    // billedEffective = total_kwh × bill multiplier so all three columns are on the same scale.
    const billedEffective = (+b.total_kwh || 0) * billMult;
    // Variance: compare effective daily readings vs billed-effective
    const variance = billedEffective > 0 ? ((sumEffective - billedEffective) / billedEffective) * 100 : null;
    return { ...b, sumDaily: Math.round(sumDaily), sumEffective: Math.round(sumEffective), billedEffective: Math.round(billedEffective), variance };
  }), [bills, dailyKwh]);

  const billsChartData = useMemo(() => billRows.slice().reverse().map((r: any) => ({
    month: r.billing_month ? format(parseISO(r.billing_month), 'MMM yy') : '—',
    billed:    r.billedEffective || 0,
    daily:     r.sumDaily        || 0,
    effective: r.sumEffective    || 0,
  })), [billRows]);

  const rangeBtns: { key: typeof viewMode; label: string }[] = [
    { key: '14d', label: '14D' }, { key: '30d', label: '30D' },
    { key: '60d', label: '60D' }, { key: '90d', label: '90D' },
    { key: 'bills', label: 'Bills' }, { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>Plant</Label><PlantPicker value={plantId} onChange={setPlantId} /></div>
          {plantId && (
            <div className="flex items-center gap-1 flex-wrap">
              {rangeBtns.map(({ key, label }) => (
                <button key={key} onClick={() => setViewMode(key)}
                  className={['h-6 px-2 rounded text-[11px] font-medium border transition-colors',
                    viewMode === key ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>{label}</button>
              ))}
              {viewMode === 'custom' && (
                <>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-6 w-[110px] text-[11px] px-1.5" />
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <Input type="date" value={customTo}   onChange={(e) => setCustomTo(e.target.value)}   className="h-6 w-[110px] text-[11px] px-1.5" />
                </>
              )}
              <div className="ml-2 flex items-center gap-1">
                <button onClick={() => setChartType('line')}
                  className={['h-6 px-2 rounded text-[11px] font-medium border transition-colors',
                    chartType === 'line' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>Line</button>
                <button onClick={() => setChartType('bar')}
                  className={['h-6 px-2 rounded text-[11px] font-medium border transition-colors',
                    chartType === 'bar' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground hover:text-foreground border-border',
                  ].join(' ')}>Bar</button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Stat boxes ──────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Grid kWh', value: fmtNum(stats.totalGrid, 0), sub: `avg ${fmtNum(stats.avgDaily, 0)}/day`, color: 'text-chart-1' },
            { label: 'Solar kWh', value: fmtNum(stats.totalSolar, 0), sub: `${stats.solarPct.toFixed(1)}% of total`, color: 'text-green-600' },
            { label: 'Peak Day', value: fmtNum(stats.peakDay.total, 0), sub: stats.peakDay.date, color: 'text-amber-600' },
            { label: 'Days in range', value: String(dailyChartData.length), sub: `${rangeStart} – ${rangeEnd}`, color: 'text-muted-foreground' },
          ].map(({ label, value, sub, color }) => (
            <Card key={label} className="p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
              <div className={`text-xl font-bold font-mono-num ${color}`}>{value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Daily trend chart ───────────────────────────────────────────────── */}
      {plantId && dailyChartData.length > 0 && viewMode !== 'bills' && (
        <Card className="p-3">
          <h4 className="text-sm font-semibold mb-2">
            Daily kWh — {viewMode === 'custom' ? `${customFrom} → ${customTo}` : viewMode.toUpperCase()}
            {isFetching && <span className="text-[10px] text-muted-foreground ml-2">Loading…</span>}
          </h4>
          <div className="h-64">
            <ResponsiveContainer>
              {chartType === 'bar' ? (
                <BarChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(dailyChartData.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: string) => [v != null ? `${(+v).toLocaleString()} kWh` : '—', name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="grid"      fill="hsl(var(--chart-1))" name="Grid kWh" />
                  <Bar dataKey="solar"     fill="#22c55e"              name="Solar kWh" />
                  <Bar dataKey="effective" fill="hsl(var(--chart-3))" name="Eff. kWh (×mult)" />
                </BarChart>
              ) : (
                <LineChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(dailyChartData.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kWh', angle: -90, position: 'insideLeft', fontSize: 9, offset: 8 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any, name: string) => [v != null ? `${(+v).toLocaleString()} kWh` : '—', name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="grid"      stroke="hsl(var(--chart-1))" strokeWidth={2}   dot={false} name="Grid kWh" connectNulls />
                  <Line type="monotone" dataKey="solar"     stroke="#22c55e"              strokeWidth={2}   dot={false} name="Solar kWh" connectNulls />
                  <Line type="monotone" dataKey="effective" stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Eff. kWh (×mult)" connectNulls />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Bill-aligned comparison chart (Bills mode) ─────────────────────── */}
      {plantId && viewMode === 'bills' && billRows.length > 0 && (
        <>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Billed vs Daily Sum (per billing period)</h4>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={billsChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="billed"    fill="hsl(var(--chart-1))" name="Billed×mult kWh" />
                  <Bar dataKey="daily"     fill="hsl(var(--chart-2))" name="Sum daily kWh" />
                  <Bar dataKey="effective" fill="hsl(var(--chart-3))" name="Eff. kWh (×mult)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-3">
            <h4 className="text-sm font-semibold mb-2">Variance table</h4>
            <div className="space-y-1.5">
              {billRows.map((r: any) => (
                <div key={r.id} className="grid grid-cols-5 gap-2 text-xs border-b last:border-0 py-1.5 items-center">
                  <div className="font-mono-num">{r.billing_month ? format(parseISO(r.billing_month), 'MMM yy') : '—'}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.billedEffective, 0)}</div>
                  <div className="font-mono-num text-right">{fmtNum(r.sumDaily, 0)}</div>
                  <div className="font-mono-num text-right text-amber-700 dark:text-amber-400">{fmtNum(r.sumEffective, 0)}</div>
                  <div className="text-right">
                    {r.variance != null && (
                      <StatusPill tone={Math.abs(r.variance) > 15 ? 'danger' : Math.abs(r.variance) > 5 ? 'warn' : 'accent'}>
                        {r.variance > 0 ? '+' : ''}{r.variance.toFixed(1)}%
                      </StatusPill>
                    )}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-5 gap-2 text-[10px] text-muted-foreground pt-1">
                <div>Month</div><div className="text-right">Billed×mult</div><div className="text-right">Daily Σ</div>
                <div className="text-right text-amber-600">Eff. kWh×</div><div className="text-right">Δ%</div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Billed×mult = total_kwh × CT multiplier. Eff. kWh× = Σ(daily reading × multiplier). Variance = (Eff − Billed×mult) / Billed×mult.
              </p>
            </div>
          </Card>
        </>
      )}
      {plantId && !billRows.length && viewMode === 'bills' && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No bills entered yet</Card>
      )}
      {plantId && !dailyChartData.length && viewMode !== 'bills' && !isFetching && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No power readings in selected range</Card>
      )}
    </div>
  );
}
