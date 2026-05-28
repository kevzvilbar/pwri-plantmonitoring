import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.
function GridPylonIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <line x1="4" y1="22" x2="20" y2="22" />
      <line x1="8" y1="22" x2="10" y2="14" />
      <line x1="16" y1="22" x2="14" y2="14" />
      <line x1="8" y1="22" x2="14" y2="14" />
      <line x1="16" y1="22" x2="10" y2="14" />
      <line x1="10" y1="14" x2="11" y2="8" />
      <line x1="14" y1="14" x2="13" y2="8" />
      <line x1="10" y1="14" x2="13" y2="8" />
      <line x1="14" y1="14" x2="11" y2="8" />
      <line x1="11" y1="8" x2="11.8" y2="4" />
      <line x1="13" y1="8" x2="12.2" y2="4" />
      <line x1="11" y1="8" x2="12.2" y2="4" />
      <line x1="13" y1="8" x2="11.8" y2="4" />
      <line x1="7" y1="6" x2="17" y2="6" />
      <line x1="12" y1="4" x2="12" y2="6" />
      <line x1="7" y1="6" x2="7" y2="8" />
      <line x1="17" y1="6" x2="17" y2="8" />
    </svg>
  );
}
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// Wells keep a fixed default limit; locators use per-plant configurable limit from Plant Configuration.
const WELL_MAX_READINGS_PER_DAY = 3;
const BASE = (import.meta.env.VITE_BACKEND_URL as string) || '';

// ─── Shared Dashboard invalidator ────────────────────────────────────────────
// Called after every successful save/import in any Operations sub-form so that
// the Dashboard stat cards, NRW, PV ratio, and TrendChart series all refresh
// immediately — no page reload or 60-second poll wait required.
// The broad qc.invalidateQueries() at the end is a safety-net for any mounted
// queries not listed here (e.g. new keys added in future features).
import type { QueryClient } from '@tanstack/react-query';
// ─── Hybrid Strategy: delta cache invalidation ────────────────────────────────
// After every mutating operation (insert / update / delete / import) we flush the
// in-memory deltaCache for the affected entity IDs so the next render recomputes
// deltas from raw DB rows rather than serving a stale cached value.
// The cache is populated lazily on the next Dashboard/TrendChart render via
// hydrateFromStoredDeltas or the computePivotFromReadings fallback path.
import { flushDeltaCache } from '@/lib/deltaCache';

function invalidateDashboard(qc: QueryClient, entityIds?: string[]) {
  // Dashboard stat-card sources
  qc.invalidateQueries({ queryKey: ['dash-loc-today'] });
  qc.invalidateQueries({ queryKey: ['dash-loc-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-wells-today'] });
  qc.invalidateQueries({ queryKey: ['dash-wells-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
  qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
  qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
  qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-power-today'] });
  qc.invalidateQueries({ queryKey: ['dash-power-yest'] });
  qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
  qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
  qc.invalidateQueries({ queryKey: ['dash-chem'] });
  qc.invalidateQueries({ queryKey: ['alerts-feed'] });
  // TrendChart series
  qc.invalidateQueries({ queryKey: ['trend-loc'] });
  qc.invalidateQueries({ queryKey: ['trend-loc-ids'] });
  qc.invalidateQueries({ queryKey: ['trend-product'] });
  qc.invalidateQueries({ queryKey: ['trend-well'] });
  qc.invalidateQueries({ queryKey: ['trend-power'] });
  qc.invalidateQueries({ queryKey: ['trend-cost'] });
  qc.invalidateQueries({ queryKey: ['trend-ro'] });
  qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
  // DataSummaryModal — invalidated explicitly so the modal refreshes immediately
  // when open, without waiting for the broad catch-all below.
  qc.invalidateQueries({ queryKey: ['dsm-cons-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-prod-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
  qc.invalidateQueries({ queryKey: ['dsm-ro-trains'] });
  qc.invalidateQueries({ queryKey: ['dsm-locators'] });
  qc.invalidateQueries({ queryKey: ['dsm-product-meters'] });
  qc.invalidateQueries({ queryKey: ['dsm-meter-configs'] });
  // ── HYBRID STRATEGY: flush in-memory delta cache ───────────────────────────
  // Targeted flush for known entity IDs (locators, wells, trains) so the next
  // render recomputes deltas from fresh DB rows instead of a stale cache entry.
  // Passing no entityIds performs a full flush as a safety-net — this matches
  // the existing broad qc.invalidateQueries() behaviour below.
  flushDeltaCache(entityIds);
  // Broad safety-net — catches any other mounted queries
  qc.invalidateQueries();
}

// ─── CSV helpers ────────────────────────────────────────────────────────────

// Fix #6 — RFC-4180 compliant CSV parser. Handles quoted fields that contain
// commas, newlines, or escaped double-quotes (""). Plain split(',') breaks on
// values like "Well #1, North" or plant names with commas.
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (line[i] === '"') {
      // Quoted field — consume opening quote
      i++;
      let val = '';
      while (i < len) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"'; i += 2;          // escaped double-quote
        } else if (line[i] === '"') {
          i++; break;                  // closing quote
        } else {
          val += line[i++];
        }
      }
      fields.push(val.trim());
      if (i < len && line[i] === ',') i++; // skip field separator
    } else {
      // Unquoted field — read until next comma
      const start = i;
      while (i < len && line[i] !== ',') i++;
      fields.push(line.slice(start, i).trim());
      if (i < len && line[i] === ',') i++; // skip field separator
    }
  }
  // Handle trailing comma (empty last field) e.g. "a,b," → ["a","b",""]
  if (len > 0 && line[len - 1] === ',') fields.push('');
  return fields;
}

function parseCSVText(text: string): Record<string, string>[] {
  // Strip UTF-8 BOM (\uFEFF) — Excel adds it when saving as CSV; it silently
  // attaches to the first column header and makes that header unrecognisable.
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

function triggerTemplateDownload(filename: string, headers: string[], exampleRow: Record<string, string>) {
  downloadCSV(filename, [exampleRow]);
}

// ─── Date normaliser ─────────────────────────────────────────────────────────
// Handles the formats users commonly export from Excel / Google Sheets:
//   "2025-12-31 0:00"   → "2025-12-31T00:00"  (space sep, no leading zero)
//   "2025-12-31 8:30"   → "2025-12-31T08:30"
//   "2025-12-31T08:30"  → unchanged (already ISO)
//   "2025-12-31"        → unchanged (date-only)
//   ""                  → ""
// Without this, new Date("2025-12-31 0:00") returns Invalid Date in many
// environments (Node, Firefox strict mode) and every insert silently fails.
function normalizeDatetime(raw: string): string {
  if (!raw?.trim()) return '';
  // Replace space separator with T
  let s = raw.trim().replace(' ', 'T');
  // Zero-pad single-digit hour: "T0:" → "T00:", "T8:" → "T08:"
  s = s.replace(/T(\d):/, 'T0$1:');
  return s;
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

// ─── Duplicate check helper for CSV imports ──────────────────────────────────
// Uses a per-import-session cache so we only ask once per unique key.
// The actual prompt is driven by React state (see ImportReadingsDialog) via a
// Promise resolver — avoids window.confirm which is blocked in iframes.
const _dupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();
function clearDupDecisions() { _dupDecisions.clear(); }

// Set by ImportReadingsDialog before each import run; resolved by the in-dialog confirm UI.
let _dupPromptResolver: ((decision: 'overwrite' | 'skip') => void) | null = null;
let _dupShowPrompt: ((label: string, isDateOnly: boolean) => void) | null = null;
// When the user chooses "Overwrite All" or "Skip All", this is set so subsequent
// duplicates are resolved immediately without prompting again.
let _bulkDupDecision: 'overwrite' | 'skip' | null = null;
function clearBulkDupDecision() { _bulkDupDecision = null; }

async function resolveImportDuplicate(key: string, label: string, isDateOnly = false): Promise<'overwrite' | 'skip'> {
  if (_dupDecisions.has(key)) return _dupDecisions.get(key)!;
  // If user already chose "Overwrite All" or "Skip All", apply that immediately.
  if (_bulkDupDecision) {
    _dupDecisions.set(key, _bulkDupDecision);
    return _bulkDupDecision;
  }
  // Ask via the React dialog (not window.confirm)
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _dupPromptResolver = resolve;
    _dupShowPrompt?.(label, isDateOnly);
  });
  _dupDecisions.set(key, decision);
  return decision;
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
  const [importErrors, setImportErrors] = useState<string[]>([]);
  // Intra-file duplicate handling
  const [dupRows, setDupRows] = useState<Record<string, string>[]>([]);
  const [dupResolved, setDupResolved] = useState(false);
  // DB-level duplicate confirmation (replaces window.confirm)
  const [dupConfirm, setDupConfirm] = useState<{ label: string; isDateOnly: boolean } | null>(null);

  // Wire up the module-level resolver hooks so resolveImportDuplicate() can
  // pause and ask the user via React state instead of window.confirm.
  useEffect(() => {
    _dupShowPrompt = (label, isDateOnly) => setDupConfirm({ label, isDateOnly });
    return () => { _dupShowPrompt = null; _dupPromptResolver = null; };
  }, []);

  const handleDupDecision = (decision: 'overwrite' | 'skip', applyToAll = false) => {
    if (applyToAll) {
      _bulkDupDecision = decision;
    }
    setDupConfirm(null);
    _dupPromptResolver?.(decision);
    _dupPromptResolver = null;
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
    clearDupDecisions();
    clearBulkDupDecision();
    const ts = new Date().toISOString();

    // ── Duplicate detection ──────────────────────────────────────────────────
    // Power readings are one-per-day: use date-only key (YYYY-MM-DD) so that
    // two rows on the same date but different times are still caught as dups.
    // All other modules: key = entityName|YYYY-MM-DDTHH:mm so rows with the
    // same datetime but a DIFFERENT well/locator/blending name are NOT deduped.
    const isPowerModule = module === 'power';
    const seenKeys = new Map<string, number>(); // key → first row index
    const intraDups: number[] = [];
    rows.forEach((r, i) => {
      const dtRaw = r.reading_datetime || r.event_date || '';
      // Entity name: prefer well_name, then locator_name (power uses plant_name — handled separately below)
      const entityName = (r.well_name || r.locator_name || '').trim().toLowerCase();
      let dtKey: string;
      if (!dtRaw) {
        dtKey = `__nodate__${i}`;
      } else if (isPowerModule) {
        dtKey = new Date(dtRaw).toISOString().slice(0, 10); // YYYY-MM-DD
      } else {
        dtKey = new Date(dtRaw).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
      }
      // All modules: key = "entityName|dtKey" — different names are allowed at the same datetime.
      // Power uses plant_name as its entity name (from the CSV column).
      const powerName = isPowerModule ? (r.plant_name || '').trim().toLowerCase() : '';
      const key = isPowerModule ? `${powerName}|${dtKey}` : `${entityName}|${dtKey}`;
      if (seenKeys.has(key)) intraDups.push(i);
      else seenKeys.set(key, i);
    });

    // If intra-file duplicates exist, warn and block
    if (intraDups.length > 0 && !dupResolved) {
      // Keep only first occurrence of each key, then let user confirm by clicking Import again
      const uniqueRows = rows.filter((_r, i) => !intraDups.includes(i));
      setRows(uniqueRows);
      setDupResolved(true);
      setBusy(false);
      return; // let user click Import again with deduplicated rows
    }

    const { count, errors: insertErrs } = await insertRows(rows, plantId);
    await logReadingImport({
      user_id: userId,
      plant_id: plantId,
      module,
      file_name: file.name,
      row_count: rows.length,
      schema_valid: errors.length === 0,
      schema_errors: [...errors, ...insertErrs],
      timestamp: ts,
    });
    setBusy(false);
    setImported(count);
    setDone(true);
    setImportErrors(insertErrs);
    if (insertErrs.length) toast.error(`${count} imported, ${insertErrs.length} failed`);
    else if (count === 0) toast.info('No rows imported — all duplicates were skipped.');
    else toast.success(`${count} reading(s) imported`);
    // Only auto-close when at least one row was actually imported;
    // if everything was skipped (user chose Cancel on every overwrite prompt)
    // keep the dialog open so the user can see what happened.
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
            <div className="space-y-2">
              <p className={`text-xs font-medium flex items-center gap-1.5 ${importErrors.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                <span className={`h-2 w-2 rounded-full inline-block ${importErrors.length > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {imported} record(s) imported{importErrors.length > 0 ? `, ${importErrors.length} failed` : ''}. Audit log written.
              </p>
              {importErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 max-h-40 overflow-y-auto">
                  <p className="text-[11px] font-semibold text-destructive mb-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Import errors (first {Math.min(importErrors.length, 20)} of {importErrors.length}):
                  </p>
                  <ul className="text-[10px] text-destructive list-disc ml-3 space-y-0.5">
                    {importErrors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Intra-file duplicate notice (shown after dedup, before re-import) */}
          {dupResolved && !done && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Duplicate rows within the file were removed — only the first occurrence of each date is kept. Click <strong>Import Rows</strong> to proceed.</span>
            </div>
          )}

          {/* DB-level duplicate confirmation (replaces window.confirm) */}
          {dupConfirm && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Duplicate detected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                A reading for <strong>"{dupConfirm.label}"</strong> already exists{' '}
                {dupConfirm.isDateOnly ? 'on this date' : 'at this date & time'}.
                Overwrite it, or skip this row?
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs"
                  onClick={() => handleDupDecision('overwrite')}
                >
                  Overwrite
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleDupDecision('skip')}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs"
                  onClick={() => handleDupDecision('overwrite', true)}
                  title="Overwrite this and all remaining duplicates"
                >
                  Overwrite All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleDupDecision('skip', true)}
                  title="Skip this and all remaining duplicates"
                >
                  Skip All
                </Button>
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
// locator_name*, current_reading*, reading_datetime, previous_reading, input_mode, daily_volume
// input_mode: "raw" (default — cumulative meter reading) | "direct" (daily m³ entered directly)
// When input_mode=direct, supply daily_volume instead of current_reading; current_reading can be blank.
const LOCATOR_SCHEMA = 'locator_name*, current_reading, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, input_mode (raw|direct), daily_volume';
const LOCATOR_TEMPLATE_ROW = {
  locator_name: 'MCWD - M1',
  current_reading: '1234.56',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '1200.00',
  input_mode: 'raw',
  daily_volume: '',
};

function validateLocatorReadingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.locator_name?.trim()) e.push(`Row ${i}: locator_name is required`);
  const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';
  if (isDirect) {
    if (!r.daily_volume?.trim() || isNaN(Number(r.daily_volume)) || Number(r.daily_volume) <= 0)
      e.push(`Row ${i}: daily_volume must be a positive number when input_mode=direct`);
  } else {
    if (!r.current_reading?.trim() || isNaN(Number(r.current_reading)))
      e.push(`Row ${i}: current_reading must be a number`);
  }
  if (r.previous_reading && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.daily_volume && !isDirect && isNaN(Number(r.daily_volume)))
    e.push(`Row ${i}: daily_volume must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date`);
  return e;
}

async function insertLocatorReadings(
  rows: Record<string, string>[],
  plantId: string,
  userId: string | null,
): Promise<{ count: number; errors: string[]; affectedIds: string[] }> {
  // Resolve locator names → IDs (single query for the whole batch)
  const { data: locators } = await supabase
    .from('locators').select('id, name').eq('plant_id', plantId);
  const nameToId: Record<string, string> = {};
  (locators ?? []).forEach((l: any) => { nameToId[l.name.trim().toLowerCase()] = l.id; });

  // ── FIX: Batch duplicate check ───────────────────────────────────────────────
  // Old code did one SELECT per row inside the loop → 60 sequential round-trips
  // for a 60-row CSV, causing the import to hang/never finish.
  // New approach: resolve all locator IDs first, then fetch ALL existing readings
  // for those locators in a single query keyed by "locatorId|YYYY-MM-DDTHH:mm".
  const locatorIds = Object.values(nameToId);
  let existingByKey: Record<string, string> = {}; // "locatorId|dtMin" → reading id
  if (locatorIds.length > 0) {
    const { data: existingReadings } = await supabase
      .from('locator_readings')
      .select('id, locator_id, reading_datetime')
      .in('locator_id', locatorIds);
    (existingReadings ?? []).forEach((e: any) => {
      const key = `${e.locator_id}|${(e.reading_datetime as string).slice(0, 16)}`;
      existingByKey[key] = e.id;
    });
  }

  let count = 0;
  const errors: string[] = [];
  // ── HYBRID STRATEGY: track mutated entity IDs for targeted cache flush ──────
  const affectedIds = new Set<string>();

  for (const r of rows) {
    const locatorId = nameToId[r.locator_name?.trim().toLowerCase()];
    if (!locatorId) { errors.push(`Locator not found: "${r.locator_name}"`); continue; }

    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    const dtMin = dt.slice(0, 16); // minute-level key e.g. "2026-04-01T00:00"
    const dupKey = `${locatorId}|${dtMin}`;
    const existingId = existingByKey[dupKey];

    const isDirect = r.input_mode?.trim().toLowerCase() === 'direct';

    if (existingId) {
      // ── Duplicate: ask user then overwrite or skip ───────────────────────────
      const decision = await resolveImportDuplicate(dupKey, `${r.locator_name} @ ${dtMin}`);
      if (decision === 'skip') continue;

      // Build update payload.
      // FIX: daily_volume is a GENERATED ALWAYS column — omit it from UPDATE too;
      //      Postgres recomputes it automatically from current_reading - previous_reading.
      // Clear is_estimated: operator is entering actual data, overriding any regression estimate.
      const updatePayload: Record<string, any> = { reading_datetime: dt, recorded_by: userId, is_estimated: false };
      if (isDirect) {
        updatePayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
        updatePayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
        // daily_volume omitted — generated column
      } else {
        const csvCurLoc  = +r.current_reading;
        const csvPrevLoc = r.previous_reading ? +r.previous_reading : null;
        updatePayload.current_reading  = csvCurLoc;
        updatePayload.previous_reading = csvPrevLoc;
        const rawLocDelta = csvPrevLoc != null ? csvCurLoc - csvPrevLoc : null;
        if (rawLocDelta != null && rawLocDelta < 0)
          errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta.toFixed(2)}) — meter rollback detected.`);
        // daily_volume omitted — generated column
      }
      const { error } = await supabase.from('locator_readings').update(updatePayload).eq('id', existingId);
      if (error) errors.push(error.message); else { count++; existingByKey[dupKey] = existingId; }
      continue;
    }

    // ── New insert ────────────────────────────────────────────────────────────
    // FIX: daily_volume removed — it is a GENERATED ALWAYS AS column in Postgres
    //      (auto-computed as current_reading - previous_reading). Supplying it
    //      causes: "cannot insert a non-DEFAULT value into column daily_volume".
    //      plant_id IS required (NOT NULL constraint) — keep it.
    const insertPayload: Record<string, any> = {
      locator_id:       locatorId,
      plant_id:         plantId,
      reading_datetime: dt,
      recorded_by:      userId,
      is_estimated:     false, // operator-entered — never an estimate
    };

    if (isDirect) {
      // Direct m³ mode: user supplied daily volume explicitly.
      // Store current_reading = previous to preserve the cumulative sequence.
      insertPayload.current_reading  = r.previous_reading ? +r.previous_reading : 0;
      insertPayload.previous_reading = r.previous_reading ? +r.previous_reading : null;
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    } else {
      // Raw cumulative meter mode
      const csvCurLoc2  = +r.current_reading;
      const csvPrevLoc2 = r.previous_reading ? +r.previous_reading : null;
      insertPayload.current_reading  = csvCurLoc2;
      insertPayload.previous_reading = csvPrevLoc2;
      const rawLocDelta2 = csvPrevLoc2 != null ? csvCurLoc2 - csvPrevLoc2 : null;
      if (rawLocDelta2 != null && rawLocDelta2 < 0)
        errors.push(`Locator "${r.locator_name}" @ ${dtMin}: negative delta (${rawLocDelta2.toFixed(2)}) — meter rollback detected.`);
      // daily_volume intentionally omitted — GENERATED ALWAYS column
    }

    const { error } = await supabase.from('locator_readings').insert(insertPayload);
    if (error) errors.push(error.message);
    else {
      count++;
      affectedIds.add(locatorId); // ── HYBRID: track for cache invalidation
      existingByKey[dupKey] = 'inserted'; // mark so intra-batch dups resolve correctly
    }
  }
  return { count, errors, affectedIds: Array.from(affectedIds) };
}

// Well readings:
// well_name*, current_reading*, reading_datetime, previous_reading, power_meter_reading, solar_meter_reading
const WELL_SCHEMA = 'well_name*, current_reading*, reading_datetime (YYYY-MM-DDTHH:mm), previous_reading, power_meter_reading, solar_meter_reading';
const WELL_TEMPLATE_ROW = {
  well_name: 'Well #1',
  current_reading: '5678.90',
  reading_datetime: '2024-06-15T08:30',
  previous_reading: '5600.00',
  power_meter_reading: '',
  solar_meter_reading: '',
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
  if (r.solar_meter_reading && isNaN(Number(r.solar_meter_reading)))
    e.push(`Row ${i}: solar_meter_reading must be a number`);
  if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
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
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  let count = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
    const dtMin = dt.slice(0, 16);

    // Duplicate check
    const { data: existing } = await supabase.from('well_readings')
      .select('id').eq('well_id', wellId)
      .gte('reading_datetime', `${dtMin}:00`)
      .lte('reading_datetime', `${dtMin}:59`).limit(1);

    if (existing && existing.length > 0) {
      const decision = await resolveImportDuplicate(`${wellId}|${dtMin}`, `${r.well_name} @ ${dtMin}`);
      if (decision === 'skip') continue;
      // Fix #5 — overwrite path was missing daily_volume; TrendChart/Dashboard aggregation
      // would silently use the stale delta from the original insert after a CSV overwrite.
      const ovwCur = +r.current_reading;
      const ovwPrev = r.previous_reading ? +r.previous_reading : null;
      const ovwDailyVol = ovwPrev != null ? Math.max(0, ovwCur - ovwPrev) : null;
      const ovwPayload: Record<string, any> = {
        current_reading: ovwCur,
        previous_reading: ovwPrev,
        power_meter_reading: r.power_meter_reading ? +r.power_meter_reading : null,
        reading_datetime: dt,
        recorded_by: userId,
        daily_volume: ovwDailyVol,
      };
      // Only include solar_meter_reading when non-empty — sending null for a missing
      // DB column causes Supabase to reject the entire row with a schema cache error.
      if (r.solar_meter_reading?.trim()) ovwPayload.solar_meter_reading = +r.solar_meter_reading;
      const { error } = await supabase.from('well_readings').update(ovwPayload).eq('id', existing[0].id);
      if (error) errors.push(error.message); else count++;
      continue;
    }

    const csvCur = +r.current_reading;
    const csvPrev = r.previous_reading ? +r.previous_reading : null;
    const rawWellDelta = csvPrev != null ? csvCur - csvPrev : null;
    if (rawWellDelta != null && rawWellDelta < 0)
      errors.push(`Well "${r.well_name}" @ ${dt.slice(0, 10)}: negative delta (${rawWellDelta.toFixed(2)}) — meter rollback detected. daily_volume stored as 0.`);
    const csvDailyVol = rawWellDelta != null ? Math.max(0, rawWellDelta) : null;

    const insertPayload: Record<string, any> = {
      well_id: wellId,
      plant_id: plantId,
      current_reading: csvCur,
      previous_reading: csvPrev,
      daily_volume: csvDailyVol,
      power_meter_reading: r.power_meter_reading ? +r.power_meter_reading : null,
      reading_datetime: dt,
      recorded_by: userId,
    };
    // Only include solar_meter_reading when non-empty — sending null for a missing
    // DB column causes Supabase to reject the entire row with a schema cache error.
    if (r.solar_meter_reading?.trim()) insertPayload.solar_meter_reading = +r.solar_meter_reading;
    const { error } = await supabase.from('well_readings').insert(insertPayload);
    if (error) errors.push(error.message);
    else count++;
  }
  return { count, errors };
}

// Blending readings — two input modes (mirrors manual BlendingRow):
//   Raw meter : supply raw_meter_reading (cumulative); Δ is auto-computed from the
//               previous reading (from previous_reading column > intra-batch > localStorage).
//   Direct    : supply volume_m3 (daily m³ already computed).
// Exactly one of raw_meter_reading / volume_m3 must be present per row.
const BLENDING_SCHEMA =
  'well_name*,  raw_meter_reading (cumulative) | volume_m3* (daily m³),  ' +
  'previous_reading (prev cumulative — raw mode only; auto-detected if omitted),  ' +
  'event_date (YYYY-MM-DD),  reading_datetime (YYYY-MM-DDTHH:mm)';

const BLENDING_TEMPLATE_ROW = {
  well_name:          'Well #2',
  raw_meter_reading:  '12345.00',   // ← provide this (cumulative) …
  previous_reading:   '12195.00',   //   … and optionally the previous cumulative value
  volume_m3:          '',           //   OR provide volume_m3 (daily m³) instead
  event_date:         '2024-06-15',
  reading_datetime:   '2024-06-15T08:30',
};

function validateBlendingRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.well_name?.trim()) e.push(`Row ${i}: well_name is required`);

  const hasRaw = !!r.raw_meter_reading?.trim();
  const hasVol = !!r.volume_m3?.trim();

  if (!hasRaw && !hasVol)
    e.push(`Row ${i}: provide raw_meter_reading (cumulative meter) or volume_m3 (daily m³) — one is required`);
  if (hasRaw && hasVol)
    e.push(`Row ${i}: provide raw_meter_reading OR volume_m3, not both`);
  if (hasRaw && (isNaN(Number(r.raw_meter_reading)) || Number(r.raw_meter_reading) < 0))
    e.push(`Row ${i}: raw_meter_reading must be a non-negative number`);
  if (hasVol && (isNaN(Number(r.volume_m3)) || Number(r.volume_m3) <= 0))
    e.push(`Row ${i}: volume_m3 must be a positive number`);
  if (r.previous_reading?.trim() && isNaN(Number(r.previous_reading)))
    e.push(`Row ${i}: previous_reading must be a number`);
  if (r.event_date && isNaN(Date.parse(r.event_date)))
    e.push(`Row ${i}: event_date is not a valid date (use YYYY-MM-DD)`);
  if (r.reading_datetime?.trim() && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is not a valid date (use YYYY-MM-DDTHH:mm)`);
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
  (wells ?? []).forEach((w: any) => { nameToId[w.name.trim().toLowerCase()] = w.id; });

  // ── Raw meter tracking ────────────────────────────────────────────────────
  // Priority for "previous cumulative reading" resolution (highest → lowest):
  //   1. Explicit `previous_reading` column in the CSV row
  //   2. Last raw_meter_reading processed for this well earlier in this batch
  //      (rows are sorted chronologically before processing)
  //   3. localStorage value persisted by manual BlendingRow entries or prior imports
  // If nothing is found → baseline entry: store the raw value as volume_m3 directly
  // (same behaviour as the manual raw-mode save with no prior reading).
  const prevRawByWell: Record<string, number | null> = {};

  const initPrevRaw = (wellId: string) => {
    if (wellId in prevRawByWell) return; // already seeded
    try {
      const stored = localStorage.getItem(`blending-raw-${wellId}`);
      prevRawByWell[wellId] = stored ? (JSON.parse(stored) as { reading: number }).reading : null;
    } catch {
      prevRawByWell[wellId] = null;
    }
  };

  // Sort chronologically so intra-batch deltas are computed in the right order
  const sorted = [...rows].sort((a, b) => {
    const da = a.reading_datetime || a.event_date || '';
    const db = b.reading_datetime || b.event_date || '';
    return da.localeCompare(db);
  });

  // Accumulate localStorage updates; apply them all at the end so a mid-import
  // error doesn't leave localStorage in a half-written state.
  const pendingRawPersist: Record<string, { reading: number; date: string }> = {};

  let count = 0;
  const errors: string[] = [];

  for (const r of sorted) {
    const wellId = nameToId[r.well_name?.trim().toLowerCase()];
    if (!wellId) { errors.push(`Well not found: "${r.well_name}"`); continue; }
    // Normalise event_date to YYYY-MM-DD regardless of what the CSV contains
    // (Excel commonly exports as M/D/YYYY e.g. "5/19/2026"; PostgreSQL stores
    // dates in ISO format so the duplicate-check .eq() and future queries must
    // use the same canonical form to match correctly).
    const _rawEventDate = r.event_date || '';
    const _parsedEvent = _rawEventDate ? new Date(_rawEventDate) : null;
    const eventDate = (_parsedEvent && !isNaN(_parsedEvent.getTime()))
      ? `${_parsedEvent.getFullYear()}-${String(_parsedEvent.getMonth() + 1).padStart(2, '0')}-${String(_parsedEvent.getDate()).padStart(2, '0')}`
      : new Date().toISOString().slice(0, 10);

    // ── Compute the volume_m3 value to store ──────────────────────────────
    let storeVol: number;
    const isRawRow = !!r.raw_meter_reading?.trim();

    if (isRawRow) {
      const curRaw = +r.raw_meter_reading;
      initPrevRaw(wellId);

      // Determine previous: explicit CSV column wins, then batch-tracked, then localStorage
      const prevRaw: number | null =
        r.previous_reading?.trim() ? +r.previous_reading
        : prevRawByWell[wellId] ?? null;

      if (prevRaw == null) {
        // No prior reading available → baseline: store raw value as first volume entry
        // (mirrors manual raw-mode behaviour for first-ever reading on a well)
        storeVol = curRaw;
      } else {
        storeVol = curRaw - prevRaw;
        if (storeVol < 0) {
          errors.push(
            `${r.well_name} @ ${eventDate}: negative delta ${storeVol.toFixed(2)} m³ ` +
            `(raw ${curRaw} − prev ${prevRaw}) — meter rollback? Row skipped.`,
          );
          continue;
        }
        if (storeVol === 0) {
          errors.push(
            `${r.well_name} @ ${eventDate}: delta is 0 (current reading equals previous ${curRaw}). Row skipped.`,
          );
          continue;
        }
      }

      // Advance the batch tracker so the next row for this well uses this reading
      prevRawByWell[wellId] = curRaw;
      pendingRawPersist[wellId] = { reading: curRaw, date: eventDate };
    } else {
      // Direct m³ mode — use volume_m3 as-is
      storeVol = +r.volume_m3;
    }

    if (!(storeVol > 0)) {
      errors.push(`${r.well_name} @ ${eventDate}: computed volume must be positive (got ${storeVol}). Row skipped.`);
      continue;
    }

    // ── Duplicate check: same well + same event_date ───────────────────────
    try {
      const { data: existing } = await (supabase.from('blending_events' as any) as any)
        .select('id')
        .eq('well_id', wellId)
        .eq('event_date', eventDate)
        .limit(1);
      if (existing && existing.length > 0) {
        const decision = await resolveImportDuplicate(
          `${wellId}|${eventDate}`,
          `${r.well_name} @ ${eventDate}`,
          true, // date-only match
        );
        if (decision === 'skip') continue;
        // overwrite: fall through to upsert below
      }
    } catch {
      // blending_events table may not exist yet — fall through and let the insert handle it
    }

    try {
      const { data: existingRec } = await (supabase.from('blending_events' as any) as any)
        .select('id').eq('well_id', wellId).eq('event_date', eventDate).limit(1);
      // Resolve reading_datetime from CSV: prefer reading_datetime column, fall back to event_date
      const _csvDt = r.reading_datetime?.trim() ? normalizeDatetime(r.reading_datetime.trim()) : null;
      const _rdIso = _csvDt && !isNaN(Date.parse(_csvDt)) ? new Date(_csvDt).toISOString() : null;
      let insErr: any;
      if (existingRec?.length) {
        ({ error: insErr } = await (supabase.from('blending_events' as any) as any)
          .update({ volume_m3: storeVol, plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            ...(isRawRow ? { raw_meter_reading: +r.raw_meter_reading } : {}) })
          .eq('id', existingRec[0].id));
      } else {
        ({ error: insErr } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: wellId, plant_id: plantId, well_name: r.well_name, plant_name: plantName,
            event_date: eventDate,
            ...(_rdIso ? { reading_datetime: _rdIso } : {}),
            volume_m3: storeVol, ...(isRawRow ? { raw_meter_reading: +r.raw_meter_reading } : {}) }));
      }
      if (insErr) throw new Error(insErr.message);
      count++;
    } catch (e: any) {
      errors.push(e.message);
    }
  }

  // ── Persist latest raw readings to localStorage ────────────────────────────
  // Applied after the loop so BlendingRow's delta calculation stays correct on
  // the next manual entry, and future imports can auto-detect the previous value.
  for (const [wellId, v] of Object.entries(pendingRawPersist)) {
    try { localStorage.setItem(`blending-raw-${wellId}`, JSON.stringify(v)); } catch {}
  }

  return { count, errors };
}

// Power readings:
// meter_reading_kwh*, reading_datetime* — solar/grid columns optional and only needed
// if the energy migration (20260427) has been run on this Supabase instance.
// solar_input_mode: "raw" (default — cumulative meter reading, Δ auto-computed)
//                 | "direct" (daily kWh entered directly — stored as daily_solar_kwh; solar_meter_reading ignored)
const POWER_SCHEMA = 'plant_name*, meter_reading_kwh*, reading_datetime* (YYYY-MM-DDTHH:mm), solar_meter_reading (optional), solar_input_mode (raw|direct, optional), daily_solar_kwh (optional), daily_grid_kwh (optional)';
const POWER_TEMPLATE_ROW = {
  plant_name: 'Plant A',
  meter_reading_kwh: '12345.6',
  reading_datetime: '2024-06-15T08:30',
  solar_meter_reading: '',
  solar_input_mode: '',
  daily_solar_kwh: '',
  daily_grid_kwh: '',
};

function validatePowerRow(r: Record<string, string>, i: number): string[] {
  const e: string[] = [];
  if (!r.plant_name?.trim()) e.push(`Row ${i}: plant_name is required`);
  if (!r.meter_reading_kwh?.trim() || isNaN(Number(r.meter_reading_kwh)))
    e.push(`Row ${i}: meter_reading_kwh is required and must be a number`);
  if (!r.reading_datetime?.trim() || isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
    e.push(`Row ${i}: reading_datetime is required and must be a valid datetime`);
  if (r.solar_meter_reading && isNaN(Number(r.solar_meter_reading)))
    e.push(`Row ${i}: solar_meter_reading must be a number`);
  if (r.solar_input_mode && !['raw', 'direct'].includes(r.solar_input_mode.trim().toLowerCase()))
    e.push(`Row ${i}: solar_input_mode must be "raw" or "direct"`);
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
  // ── 1. Load all plants ────────────────────────────────────────────────────
  const { data: allPlants } = await supabase.from('plants' as any).select('id, name');
  const plantNameToId: Record<string, string> = {};
  const plantIdToName: Record<string, string> = {};
  (allPlants ?? []).forEach((p: any) => {
    plantNameToId[p.name.trim().toLowerCase()] = p.id;
    plantIdToName[p.id] = p.name.trim();
  });

  // ── 2. Pre-load plant_power_config for all plants (grid meter names + multipliers) ──
  // This allows resolving "SRP Grid Meter 1 STP" → plantId for SRP, meterIndex 0.
  // Without this, multi-meter CSV rows all fall back to plantId, overwrite each other,
  // and never write grid_meter_readings, so the history dialog shows no change.
  type PlantPowerCfg = { names: string[]; multipliers: number[] };
  const powerCfgByPlant: Record<string, PlantPowerCfg> = {};
  try {
    const { data: allCfgs } = await (supabase.from('plant_power_config' as any) as any)
      .select('plant_id, grid_meter_names, grid_meter_multipliers');
    (allCfgs ?? []).forEach((c: any) => {
      powerCfgByPlant[c.plant_id] = {
        names:       Array.isArray(c.grid_meter_names)        ? c.grid_meter_names.map(String)  : [],
        multipliers: Array.isArray(c.grid_meter_multipliers)  ? c.grid_meter_multipliers.map(Number) : [],
      };
    });
  } catch { /* table may not exist; single-meter path still works */ }

  const getPerMeterMult = (pid: string, mi: number): number => {
    const cfg = powerCfgByPlant[pid];
    const m = cfg?.multipliers?.[mi];
    return m && m > 0 ? m : 1;
  };

  // ── 3. Resolve each CSV row to { resolvedPlantId, meterIndex } ──────────────
  // Priority:
  //   a) Exact match against plant name → meter 0  (single-meter / legacy path)
  //   b) "${plantName} ${meterName}" composite → the matching plant + meter index
  //   c) Fallback to the UI-selected plantId, meter 0
  type ResolvedRow = { r: Record<string, string>; pid: string; mi: number };
  const resolvedRows: ResolvedRow[] = rows.map(r => {
    const csvName = r.plant_name?.trim() ?? '';
    const csvLower = csvName.toLowerCase();

    // (a) Exact plant name match
    if (plantNameToId[csvLower]) return { r, pid: plantNameToId[csvLower], mi: 0 };

    // (b) Composite "${plantName} ${meterLabel}" match
    for (const [pNameLower, pId] of Object.entries(plantNameToId)) {
      const cfg = powerCfgByPlant[pId];
      if (!cfg?.names?.length) continue;
      for (let idx = 0; idx < cfg.names.length; idx++) {
        if (`${pNameLower} ${cfg.names[idx].toLowerCase()}` === csvLower) {
          return { r, pid: pId, mi: idx };
        }
      }
    }

    // (c) Fallback
    return { r, pid: plantId, mi: 0 };
  });

  // ── 4. Group rows by plantId + calendar-date ─────────────────────────────
  // Rows for the same plant on the same day belong in ONE power_readings row,
  // with each meter's value stored under its index in grid_meter_readings JSONB.
  // Without grouping, the three CSV rows for SRP on 2026-05-01 would hit the
  // same duplicate-decision key and overwrite each other, losing meters 0 and 1.
  type DayGroup = {
    pid: string;
    dt: string;       // ISO UTC string for the DB
    dtDate: string;   // YYYY-MM-DD UTC (dup-check window key)
    meters: Map<number, number>;
    solar?: number;
    dailySolar?: number;
    dailyGrid?: number;
    solarMode?: string;
  };
  const groups = new Map<string, DayGroup>();
  for (const { r, pid, mi } of resolvedRows) {
    const dt = new Date(normalizeDatetime(r.reading_datetime)).toISOString();
    const dtDate = dt.slice(0, 10);
    const key = `${pid}|${dtDate}`;
    if (!groups.has(key)) groups.set(key, { pid, dt, dtDate, meters: new Map() });
    const g = groups.get(key)!;
    g.meters.set(mi, +r.meter_reading_kwh);
    // Solar / grid totals come from whichever row supplies them (typically meter-0)
    if (g.solar     == null && r.solar_meter_reading?.trim()) g.solar     = +r.solar_meter_reading;
    if (g.dailySolar == null && r.daily_solar_kwh?.trim())    g.dailySolar = +r.daily_solar_kwh;
    if (g.dailyGrid  == null && r.daily_grid_kwh?.trim())     g.dailyGrid  = +r.daily_grid_kwh;
    if (!g.solarMode          && r.solar_input_mode?.trim())  g.solarMode  = r.solar_input_mode.trim().toLowerCase();
  }

  // ── 5. Insert or overwrite one DB row per group ──────────────────────────
  let count = 0;
  const errors: string[] = [];

  for (const [key, g] of groups) {
    const { pid: gPid, dt, dtDate, meters } = g;
    const dayStart = `${dtDate}T00:00:00.000Z`;
    const dayEnd   = `${dtDate}T23:59:59.999Z`;

    // Build grid_meter_readings JSONB from all meters in this group
    const gmrObj: Record<string, number> = {};
    for (const [mi, val] of meters) gmrObj[String(mi)] = val;

    const meter0Val = meters.get(0) ?? 0;

    const payload: Record<string, any> = {
      plant_id:          gPid,
      meter_reading_kwh: meter0Val,         // backward compat / meter-0 cumulative
      grid_meter_readings: gmrObj,           // full per-meter JSONB — the key fix
      reading_datetime:  dt,
      recorded_by:       userId,
    };

    // Solar
    const explicitDirect = g.solarMode === 'direct';
    const impliedDirect  = !g.solarMode && g.dailySolar != null;
    const solarMode = (explicitDirect || impliedDirect) ? 'direct' : 'raw';
    if (solarMode === 'direct') {
      const kw = g.dailySolar ?? g.solar;
      if (kw != null) payload.daily_solar_kwh = kw;
    } else {
      if (g.solar      != null) payload.solar_meter_reading = g.solar;
      if (g.dailySolar != null) payload.daily_solar_kwh     = g.dailySolar;
    }
    if (g.dailyGrid != null) payload.daily_grid_kwh = g.dailyGrid;

    // daily_consumption_kwh: sum Δ × per-meter multiplier across all meters in group
    try {
      const { data: prevRows } = await supabase
        .from('power_readings')
        .select('meter_reading_kwh, grid_meter_readings')
        .eq('plant_id', gPid)
        .lt('reading_datetime', dayStart)
        .order('reading_datetime', { ascending: false })
        .limit(1);
      if (prevRows && prevRows.length > 0) {
        const prev = prevRows[0] as any;
        const prevGmr = prev.grid_meter_readings as Record<string, number> | null | undefined;
        let total = 0;
        let allPresent = true;
        for (const [mi, currVal] of meters) {
          const prevVal = prevGmr?.[String(mi)] ?? (mi === 0 ? prev.meter_reading_kwh : null);
          if (prevVal == null) { allPresent = false; continue; }
          const delta = currVal - prevVal;
          if (delta >= 0) total += delta * getPerMeterMult(gPid, mi);
        }
        if (allPresent || meters.size === 1) {
          if (total >= 0) payload.daily_consumption_kwh = total;
        }
      }
    } catch { /* non-critical */ }

    // Duplicate check — one row per plant per calendar day
    const { data: existing } = await supabase.from('power_readings')
      .select('id').eq('plant_id', gPid)
      .gte('reading_datetime', dayStart)
      .lte('reading_datetime', dayEnd).limit(1);

    const doInsert = async () => {
      const { error } = await supabase.from('power_readings').insert(payload);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').insert(fb);
          if (e2) errors.push(e2.message); else count++;
        } else { errors.push(error.message); }
      } else { count++; }
    };

    if (existing && existing.length > 0) {
      const plantLabel = plantIdToName[gPid] ?? gPid;
      const decision = await resolveImportDuplicate(key, `${plantLabel} @ ${dtDate}`, true);
      if (decision === 'skip') continue;
      // Merge: keep existing meter readings for indices NOT present in this CSV import,
      // so uploading a partial CSV (e.g. only meter-0) doesn't zero out meters 1 and 2.
      let mergedGmr = gmrObj;
      try {
        const { data: existRow } = await supabase.from('power_readings')
          .select('grid_meter_readings').eq('id', existing[0].id).maybeSingle();
        const existGmr = (existRow?.grid_meter_readings as Record<string, number> | null) ?? {};
        mergedGmr = { ...existGmr, ...gmrObj }; // CSV values win; existing secondary meters preserved
      } catch { /* use gmrObj as-is */ }
      payload.grid_meter_readings = mergedGmr;

      const { error } = await supabase.from('power_readings').update(payload).eq('id', existing[0].id);
      if (error) {
        if (error.message.includes('daily_solar_kwh') || error.message.includes('daily_grid_kwh') ||
            error.message.includes('solar_meter_reading') || error.message.includes('grid_meter_readings')) {
          const { daily_solar_kwh: _s, daily_grid_kwh: _g, solar_meter_reading: _sm, grid_meter_readings: _gmr, ...fb } = payload as any;
          const { error: e2 } = await supabase.from('power_readings').update(fb).eq('id', existing[0].id);
          if (e2) errors.push(e2.message); else count++;
        } else { errors.push(error.message); }
      } else { count++; }
    } else {
      await doInsert();
    }
  }
  return { count, errors };
}

// ─── Blending wells list (Mongo-backed with Supabase fallback) ───────────────
function useBlendingWells(plantId: string) {
  return useQuery<{ wells: { well_id: string }[] }>({
    queryKey: ['blending-wells', plantId],
    queryFn: async () => {
      // 1. Try the backend API first (Mongo-backed)
      try {
        const qs = plantId ? `?plant_id=${encodeURIComponent(plantId)}` : '';
        const res = await fetch(`${BASE}/api/blending/wells${qs}`);
        if (res.ok) {
          const json = await res.json();
          // Only trust the result if it actually returned wells data
          if (Array.isArray(json?.wells)) return json;
        }
      } catch {
        // API unavailable — fall through to Supabase
      }

      // 2. Fallback: read directly from the well_blending Supabase table
      // (same source Plants.tsx uses for the blending checkbox)
      try {
        const { data, error } = await supabase
          .from('well_blending' as any)
          .select('well_id')
          .eq('plant_id', plantId);
        if (!error && Array.isArray(data) && data.length > 0) {
          return { wells: (data as any[]).map((r) => ({ well_id: r.well_id })) };
        }
      } catch {
        // Table may not exist yet
      }

      return { wells: [] };
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
  // Fix: onChange is intentionally excluded from deps. Including it caused an
  // infinite render loop when parents passed inline arrow functions (new reference
  // every render → effect fires → onChange(selectedPlantId) → re-render → repeat).
  // value is kept so the effect re-checks after the first auto-select clears the
  // empty-string condition. selectedPlantId covers the "global plant changed" case.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId, value]);
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

const TAB_CONFIG = [
  { key: 'locator',  label: 'Locator',  icon: MapPin },
  { key: 'well',     label: 'Well',     icon: Droplet },
  { key: 'product',  label: 'Product',  icon: FlaskConical },
  { key: 'blending', label: 'Blending', icon: Gauge },
  { key: 'power',    label: 'Power',    icon: Zap },
] as const;

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
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Operations</h1>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-0.5 p-1 bg-muted/60 border border-border/50 rounded-xl w-full">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={[
                'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40',
                active
                  ? 'bg-white dark:bg-card shadow-sm text-teal-700 dark:text-teal-400 border border-border/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Icon className={['h-3.5 w-3.5 shrink-0', active ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/70'].join(' ')} />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'locator'  && <LocatorReadingForm />}
        {tab === 'well'     && <WellReadingForm />}
        {tab === 'product'  && <ProductForm />}
        {tab === 'blending' && <BlendingForm />}
        {tab === 'power'    && <PowerForm />}
      </div>
    </div>
  );
}

// ─── OdometerRollerInput ─────────────────────────────────────────────────────
// Mobile-only odometer drum display.
//
// Design rules
// • 6 whole-digit cells (######) by default; auto-expands to 8 (########) once
//   the reading value ≥ 1,000,000 (7-digit overflow).
// • 2 fixed decimal cells — always visible but visually muted.
// • Alert colour ring applied to whole cells + decimal dot:
//     neutral → cyan  |  ok → green  |  warn → amber  |  error → red
// • Transparent-safe: cells use translucent tinted backgrounds so the component
//   renders correctly on dark, light, or glass/card backgrounds.
// • A hidden <input type="text" inputMode="decimal"> owns all keyboard / touch
//   events. The visual drum layer is pointer-events: none.

type OdometerAlertState = 'neutral' | 'ok' | 'warn' | 'error';

const ODO_THEME: Record<OdometerAlertState, {
  cell: string; cellActive: string;
  digit: string; digitActive: string;
  decCell: string; decDigit: string;
  dot: string; glow: string;
}> = {
  neutral: {
    cell:        'bg-slate-100/90 dark:bg-slate-800/80 border-slate-300/70 dark:border-slate-600/60',
    cellActive:  'bg-cyan-100/90  dark:bg-cyan-900/60  border-cyan-400    dark:border-cyan-500',
    digit:       'text-slate-700  dark:text-slate-200',
    digitActive: 'text-cyan-700   dark:text-cyan-200',
    decCell:     'bg-slate-50/80  dark:bg-slate-900/50  border-slate-200/50 dark:border-slate-700/40',
    decDigit:    'text-slate-400/70 dark:text-slate-500/60',
    dot:         'text-slate-400  dark:text-slate-500',
    glow:        'ring-2 ring-cyan-300/50 dark:ring-cyan-600/40',
  },
  ok: {
    cell:        'bg-emerald-50/90 dark:bg-emerald-950/50 border-emerald-300/70 dark:border-emerald-700/60',
    cellActive:  'bg-emerald-100/90 dark:bg-emerald-900/60 border-emerald-500  dark:border-emerald-400',
    digit:       'text-emerald-800 dark:text-emerald-200',
    digitActive: 'text-emerald-700 dark:text-emerald-100',
    decCell:     'bg-emerald-50/50  dark:bg-emerald-950/30 border-emerald-200/50 dark:border-emerald-800/40',
    decDigit:    'text-emerald-500/60 dark:text-emerald-500/50',
    dot:         'text-emerald-500 dark:text-emerald-400',
    glow:        'ring-2 ring-emerald-300/50 dark:ring-emerald-600/40',
  },
  warn: {
    cell:        'bg-amber-50/90  dark:bg-amber-950/50 border-amber-300/70  dark:border-amber-700/60',
    cellActive:  'bg-amber-100/90 dark:bg-amber-900/60 border-amber-500    dark:border-amber-400',
    digit:       'text-amber-800  dark:text-amber-200',
    digitActive: 'text-amber-700  dark:text-amber-100',
    decCell:     'bg-amber-50/50  dark:bg-amber-950/30 border-amber-200/50 dark:border-amber-800/40',
    decDigit:    'text-amber-500/60 dark:text-amber-500/50',
    dot:         'text-amber-500  dark:text-amber-400',
    glow:        'ring-2 ring-amber-300/50 dark:ring-amber-600/40',
  },
  error: {
    cell:        'bg-red-50/90   dark:bg-red-950/50 border-red-300/70   dark:border-red-700/60',
    cellActive:  'bg-red-100/90  dark:bg-red-900/60 border-red-500      dark:border-red-400',
    digit:       'text-red-800   dark:text-red-200',
    digitActive: 'text-red-700   dark:text-red-100',
    decCell:     'bg-red-50/50   dark:bg-red-950/30 border-red-200/50  dark:border-red-800/40',
    decDigit:    'text-red-500/60 dark:text-red-500/50',
    dot:         'text-red-500   dark:text-red-400',
    glow:        'ring-2 ring-red-300/50 dark:ring-red-600/40',
  },
} as const;

// ─── Mobile Tap-Roller ───────────────────────────────────────────────────────
// On mobile: each digit box is split top/bottom — tap top → roll up, tap bottom → roll down.
// Carry-over is automatic. Auto-expands to 8 whole digits when value ≥ 1,000,000.
// Decimal boxes (2, fixed) have a cyan highlight border.
// On desktop: falls back to the hidden-text-input keyboard-driven display.

function OdometerRollerInput({
  value, onChange, alertState = 'neutral', disabled = false, testId,
}: {
  value: string;
  onChange: (v: string) => void;
  alertState?: OdometerAlertState;
  disabled?: boolean;
  testId?: string;
}) {
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const [focused,  setFocused]  = useState(false);
  const [selStart, setSelStart] = useState<number | null>(null);
  // Mobile keyboard mode: show a text input instead of tap-drum
  const [keyboardMode, setKeyboardMode] = useState(false);
  // Swipe gesture: track touch-start Y per cell to detect swipe direction.
  const touchStartY = useRef<number | null>(null);

  // ── Digit parsing ──────────────────────────────────────────────────────────
  const dotIdx      = value.indexOf('.');
  const rawWhole    = dotIdx >= 0 ? value.slice(0, dotIdx) : value;
  const rawDec      = dotIdx >= 0 ? value.slice(dotIdx + 1) : '';
  const rawWholeLen = rawWhole.replace(/[^0-9]/g, '').length || 0;

  // Overflow: auto-expand to 8 whole-digit cells when reading ≥ 1,000,000
  const wholeLen    = rawWholeLen > 6 ? 8 : 6;
  const wholeDisplay = rawWhole.padStart(wholeLen, '0').slice(-wholeLen);
  // Single decimal digit (tenths only) — simpler and less cramped on mobile.
  const decDisplay   = rawDec.slice(0, 1).padEnd(1, '0');

  const theme = ODO_THEME[alertState];

  // ── Cell sizing — taller cells give a larger swipe/tap surface ────────────
  const cellW    = wholeLen === 8 ? 'w-[32px]' : 'w-[38px]';
  const cellH    = 'h-[56px]';
  const fontSize = wholeLen === 8 ? 'text-[17px]' : 'text-[19px]';

  // ── Mobile digit handler ───────────────────────────────────────────────────
  // pos: 0-indexed from left across ALL displayed cells (whole + dec).
  // direction: +1 = increment (swipe up), -1 = decrement (swipe down).
  const handleDigitTap = useCallback((pos: number, direction: 1 | -1) => {
    if (disabled) return;

    // Represent the number as an integer scaled by 10 (avoids float drift).
    // One decimal digit means: intVal = whole * 10 + tenths.
    const safeWhole = rawWhole.replace(/[^0-9]/g, '') || '0';
    const safeDec   = rawDec.slice(0, 1).padEnd(1, '0');
    const intVal    = parseInt(safeWhole, 10) * 10 + parseInt(safeDec, 10);

    // Place value in the ×10 scaled integer:
    //   whole digit at pos → 10^(wholeLen - pos)   [e.g. pos=0 → 10^6 for 6-digit]
    //   dec digit 0 (tenths) → 1
    let placeTenths: number;
    if (pos < wholeLen) {
      placeTenths = Math.pow(10, wholeLen - pos);
    } else {
      placeTenths = 1; // only one decimal digit
    }

    let newInt = intVal + direction * placeTenths;
    if (newInt < 0) newInt = 0; // clamp at zero

    const newWholePart = Math.floor(newInt / 10);
    const newDecPart   = newInt % 10;
    onChange(`${newWholePart || 0}.${newDecPart}`);
  }, [disabled, rawWhole, rawDec, wholeLen, onChange]);

  // ── Swipe-gesture handler (mobile) ────────────────────────────────────────
  // A swipe of ≥8 px determines direction; shorter movements fall back to
  // top/bottom-half tap so a stationary tap still works as expected.
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((
    e: React.TouchEvent<HTMLDivElement>,
    pos: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const endY   = e.changedTouches[0].clientY;
    const startY = touchStartY.current ?? endY;
    const delta  = startY - endY; // positive = finger moved up = increment
    touchStartY.current = null;

    const SWIPE_THRESHOLD = 8; // px
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      handleDigitTap(pos, delta > 0 ? 1 : -1);
    } else {
      // Short tap: use top/bottom-half of the cell as fallback
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relY = endY - rect.top;
      handleDigitTap(pos, relY < rect.height / 2 ? 1 : -1);
    }
  }, [handleDigitTap]);

  // Mouse click fallback (desktop preview / non-touch devices)
  const handleClick = useCallback((
    e: React.MouseEvent<HTMLDivElement>,
    pos: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = e.clientY - rect.top;
    handleDigitTap(pos, relY < rect.height / 2 ? 1 : -1);
  }, [handleDigitTap]);

  // ── Desktop: active-cell tracking via hidden input cursor ─────────────────
  const activeCellIdx = useMemo(() => {
    if (!focused || selStart === null || isMobile) return null;
    const paddingLen    = Math.max(0, wholeLen - rawWholeLen);
    const displayCursor = Math.min(selStart, rawWholeLen) + paddingLen;
    return Math.max(0, Math.min(wholeLen - 1, displayCursor - 1));
  }, [focused, selStart, wholeLen, rawWholeLen, isMobile]);

  const updateSel = () => {
    const el = inputRef.current;
    if (el) setSelStart(el.selectionStart ?? null);
  };

  // ── Shared cell renderer ───────────────────────────────────────────────────
  const renderCell = (
    d: string,
    key: string | number,
    pos: number,
    isDecimal: boolean,
    isActive: boolean,
  ) => {
    // Decimal cells: always show cyan highlight border
    const cellBorder = isDecimal
      ? 'border-2 border-cyan-400 dark:border-cyan-500'
      : isActive
        ? `border-2 ${theme.cellActive}`
        : `border-2 ${theme.cell}`;

    const cellColor = isDecimal
      ? 'text-cyan-700 dark:text-cyan-300'
      : isActive
        ? theme.digitActive
        : theme.digit;

    const glowClass = isActive && !isDecimal ? theme.glow : '';

    // Background tints for the top/bottom tap zones inside each cell
    const zoneBg     = isDecimal
      ? 'bg-cyan-50/60 dark:bg-cyan-950/30'
      : isActive
        ? ''
        : 'bg-slate-50/60 dark:bg-slate-900/40';
    const zoneDivide = isDecimal
      ? 'border-cyan-200/60 dark:border-cyan-700/40'
      : 'border-slate-200/70 dark:border-slate-700/50';

    if (isMobile) {
      // Three-zone layout: top tap zone (▲) | digit | bottom tap zone (▼).
      // Zones are visually distinct so users immediately know where to act.
      return (
        <div
          key={key}
          role="button"
          aria-label={`Digit ${d}, swipe up or tap top to increase, swipe down or tap bottom to decrease`}
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => handleTouchEnd(e, pos)}
          onClick={(e)   => handleClick(e, pos)}
          className={[
            cellW, cellH,
            'relative rounded-[8px] flex flex-col items-center justify-between select-none touch-manipulation overflow-hidden',
            'border-2 font-mono font-black transition-all duration-75',
            cellBorder, cellColor, glowClass, zoneBg,
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-95',
          ].join(' ')}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {/* Top zone — ▲ indicator */}
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-[9px] opacity-40 pt-[3px] pb-[2px]',
            `border-b ${zoneDivide}`,
          ].join(' ')}>▲</span>
          {/* Digit */}
          <span className={['pointer-events-none font-mono font-black leading-none', fontSize].join(' ')}>{d}</span>
          {/* Bottom zone — ▼ indicator */}
          <span className={[
            'w-full flex items-center justify-center pointer-events-none leading-none',
            'text-[9px] opacity-40 pb-[3px] pt-[2px]',
            `border-t ${zoneDivide}`,
          ].join(' ')}>▼</span>
        </div>
      );
    }

    // Desktop: passive visual cell (input overlay handles events)
    return (
      <div
        key={key}
        className={[
          cellW, cellH,
          'rounded-[8px] flex items-center justify-center',
          'font-mono font-black leading-none transition-all duration-100',
          fontSize, cellBorder, cellColor, glowClass,
        ].join(' ')}
      >
        {d}
      </div>
    );
  };

  return (
    <div className="relative w-full">
      {/* ── Hidden text input: keyboard events on desktop, also provides testId ── */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        value={value}
        onChange={e => {
          const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/\.(.*)\./, '.$1');
          onChange(raw);
        }}
        onFocus={() => { setFocused(true); setTimeout(updateSel, 0); }}
        onBlur={() => { setFocused(false); setSelStart(null); }}
        onKeyUp={updateSel}
        onMouseUp={updateSel}
        onSelect={updateSel}
        onTouchEnd={isMobile ? undefined : updateSel}
        disabled={disabled}
        data-testid={testId}
        aria-label="Meter reading"
        // On mobile the tap cells handle events; hide input completely.
        // On desktop the input is the interaction layer.
        className={isMobile
          ? 'absolute inset-0 w-0 h-0 opacity-0 pointer-events-none'
          : 'absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10'}
      />

      {/* ── Mobile keyboard mode: full-width text input with done button ── */}
      {isMobile && keyboardMode && (
        <div className="flex items-center gap-2 py-1">
          <input
            ref={keyboardInputRef}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={value}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/\.(.*)\./, '.$1');
              onChange(raw);
            }}
            onBlur={() => setKeyboardMode(false)}
            disabled={disabled}
            placeholder="Enter reading"
            aria-label="Meter reading (keyboard)"
            autoFocus
            className={[
              'flex-1 h-[48px] rounded-lg border-2 text-center font-mono font-bold text-[18px]',
              'focus:outline-none focus:ring-2 px-2',
              alertState === 'ok'   ? 'border-emerald-400 text-emerald-800 ring-emerald-200 dark:border-emerald-500 dark:text-emerald-200' :
              alertState === 'warn' ? 'border-amber-400   text-amber-800   ring-amber-200   dark:border-amber-500   dark:text-amber-200' :
              alertState === 'error'? 'border-red-400     text-red-800     ring-red-200     dark:border-red-500     dark:text-red-200' :
                                     'border-cyan-400    text-slate-800   ring-cyan-200    dark:border-cyan-500    dark:text-slate-100',
              'bg-white dark:bg-slate-900',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          />
          {/* Done button — dismisses keyboard and returns to drum view */}
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setKeyboardMode(false); }}
            className="shrink-0 h-[48px] px-4 rounded-lg bg-cyan-600 text-white text-sm font-semibold active:bg-cyan-700"
          >
            Done
          </button>
        </div>
      )}

      {/* ── Visual drum display (shown when not in keyboard mode on mobile) ── */}
      {(!isMobile || !keyboardMode) && (
        <div className="flex flex-col items-center gap-0 select-none">
          {/* Drum row */}
          <div className="flex items-center justify-center gap-[4px] py-1">
            {/* Whole-digit cells */}
            {wholeDisplay.split('').map((d, i) =>
              renderCell(d, i, i, false, !isMobile && focused && activeCellIdx === i)
            )}

            {/* Decimal point */}
            <span className={['text-2xl font-black pb-1 mx-[2px] leading-none', theme.dot].join(' ')}>.</span>

            {/* Single decimal cell (tenths) — cyan border highlight */}
            {renderCell(decDisplay, 'dec-0', wholeLen, true, false)}

            {/* Keyboard toggle — mobile only, labeled "Type" for discoverability */}
            {isMobile && !disabled && (
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => setKeyboardMode(true)}
                aria-label="Switch to keyboard input"
                className={[
                  'ml-1 h-[40px] px-2 rounded-[8px] flex items-center gap-1',
                  'border-2 border-slate-300 dark:border-slate-600',
                  'bg-slate-50 dark:bg-slate-800',
                  'text-slate-500 dark:text-slate-400 text-[11px] font-medium',
                  'active:bg-slate-100 dark:active:bg-slate-700',
                  'touch-manipulation transition-colors',
                ].join(' ')}
              >
                <Keyboard size={14} />
                <span>Type</span>
              </button>
            )}
          </div>

          {/* Swipe hint — mobile only, shown below the drum */}
          {isMobile && !disabled && (
            <div className="flex items-center justify-center gap-3 pb-1">
              <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-[8px]">↑</span>
                swipe up +
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 text-[8px]">↓</span>
                swipe down −
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MobileCarousel ──────────────────────────────────────────────────────────
// On mobile, show one item at a time and let the user swipe left/right (or use
// arrow buttons) to navigate. The counter "X / N" is shown in the header row.
// On desktop this renders all items without pagination (original behaviour).

function MobileCarousel({
  items,
  renderItem,
  headerLeft,
  isMobile,
}: {
  items: any[];
  renderItem: (item: any, index: number) => React.ReactNode;
  headerLeft?: React.ReactNode;
  isMobile: boolean;
}) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Clamp index on items change (e.g. plant switch)
  useEffect(() => { setCurrent(0); }, [items.length]);

  const prev = () => setCurrent(i => Math.max(0, i - 1));
  const next = () => setCurrent(i => Math.min(items.length - 1, i + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - (touchStartY.current ?? 0));
    if (Math.abs(dx) > 45 && Math.abs(dx) > dy * 1.5) {
      if (dx < 0) next(); else prev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (!isMobile) {
    return <>{items.map((item, i) => renderItem(item, i))}</>;
  }

  if (!items.length) return null;

  const clampedIdx = Math.min(current, items.length - 1);

  return (
    <div>
      {/* Navigation bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/20">
        {headerLeft ?? <span />}
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            disabled={clampedIdx === 0}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
            aria-label="Previous"
          >‹</button>
          <span className="text-[11px] font-semibold text-muted-foreground tabular-nums min-w-[32px] text-center">
            {clampedIdx + 1} / {items.length}
          </span>
          <button
            onClick={next}
            disabled={clampedIdx === items.length - 1}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
            aria-label="Next"
          >›</button>
        </div>
      </div>
      {/* Swipeable item */}
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {renderItem(items[clampedIdx], clampedIdx)}
      </div>
    </div>
  );
}

// ─── LOCATOR ─────────────────────────────────────────────────────────────────

function LocatorReadingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Fetch per-plant locator reading limit from Plant Configuration (manager-configurable)
  const { data: locatorReadingLimit } = useQuery({
    queryKey: ['plant-locator-limit', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (data?.config?.locator_readings_per_day != null) return data.config.locator_readings_per_day as number;
      } catch { /* table may not exist yet */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) {
          const cfg = JSON.parse(raw);
          if (cfg.locator_readings_per_day != null) return cfg.locator_readings_per_day as number;
        }
      } catch { /* ignore */ }
      return 3; // default
    },
  });
  const maxLocatorReadings = locatorReadingLimit ?? 3;

  const { data: locators } = useQuery({
    queryKey: ['op-locators', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('locators').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  // BUG FIX: locator_readings has NO plant_id column — filtering by it returns 0 rows.
  // Two-step query: resolve active locator IDs for this plant, then fetch readings
  // by locator_id. This mirrors the fix already applied in TrendChart and Dashboard.
  const { data: _locatorIds } = useQuery({
    queryKey: ['op-locator-ids', plantId],
    queryFn: async () => {
      if (!plantId) return [] as string[];
      const { data } = await supabase
        .from('locators').select('id').eq('plant_id', plantId).eq('status', 'Active');
      return (data ?? []).map((l: any) => l.id as string);
    },
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-loc-recent', plantId],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      return (await supabase.from('locator_readings')
        .select('*').in('locator_id', locatorIds)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false })
        // Safety cap — PostgREST default is 1 000 rows; high-frequency plants
        // (e.g. hourly Mambaling: 24/day × 30d × N locators) can exceed that,
        // causing silent truncation. 5 000 covers even the most aggressive schedule.
        .limit(5000)).data ?? [];
    },
    enabled: !!plantId && (_locatorIds !== undefined),
    staleTime: 0,            // always treat cached data as stale on mount/focus
    refetchInterval: 30_000, // poll every 30 s so readings from other sessions appear
  });

  // ── Dedicated latest-reading query ────────────────────────────────────────
  // Fetches exactly ONE row per locator (the absolute newest), completely
  // independent of the 30-day window above.  This guarantees that `prev` in
  // the entry card always reflects the true latest reading even when the plant
  // has hourly readings and the 30-day dump would otherwise be truncated by
  // PostgREST's row limit.
  const { data: latestReadingsRaw } = useQuery({
    queryKey: ['op-loc-latest', _locatorIds],
    queryFn: async () => {
      const locatorIds = _locatorIds ?? [];
      if (!locatorIds.length) return [];
      // One lightweight query per locator — N is small (typically 1–10)
      const results = await Promise.all(
        locatorIds.map(id =>
          supabase.from('locator_readings')
            .select('*')
            .eq('locator_id', id)
            .order('reading_datetime', { ascending: false })
            .limit(1),
        ),
      );
      return results.flatMap(r => r.data ?? []);
    },
    enabled: !!plantId && !!_locatorIds?.length,
    staleTime: 0,
    refetchInterval: 30_000,
  });

  // latestByLocator — sourced from the dedicated query above, NOT from the
  // 30-day dump, so it is immune to row-limit truncation.
  const latestByLocator = useMemo(() => {
    const latest: Record<string, any> = {};
    latestReadingsRaw?.forEach((r: any) => { latest[r.locator_id] = r; });
    return latest;
  }, [latestReadingsRaw]);

  const { todayByLocator, avgByLocator } = useMemo(() => {
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    // 10-day window for average flow-rate computation (not 30-day raw volume)
    const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const readingsByLocator: Record<string, any[]> = {};
    recentReadings?.forEach((r: any) => {
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.locator_id] ||= []).push(r);
      // Collect readings within the 10-day window for Q=V/t computation
      if (new Date(r.reading_datetime) >= tenDaysAgo)
        (readingsByLocator[r.locator_id] ||= []).push(r);
    });
    // Q = V / t — compute time-normalised flow rate (m³/hr) for each consecutive pair,
    // then average those rates so that readings taken at different intervals are comparable.
    for (const [locId, readings] of Object.entries(readingsByLocator)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const flowRates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const vol = sorted[i].current_reading - sorted[i - 1].current_reading;
        const hrs = (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        if (vol > 0 && hrs > 0) flowRates.push(vol / hrs);
      }
      avgs[locId] = flowRates.length ? flowRates.reduce((s, n) => s + n, 0) / flowRates.length : null;
    }
    return { todayByLocator: today, avgByLocator: avgs };
  }, [recentReadings]);

  return (
    <div className="space-y-3">
      {/* Plant selector card */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
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
          {/* Section header */}
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Locators</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
              {locators?.length ?? 0} total
            </span>
          </div>
          {locators?.length ? (
            <MobileCarousel
              isMobile={isMobile}
              items={locators ?? []}
              renderItem={(l: any) => (
                <LocatorRow
                  key={l.id}
                  locator={l} plantId={plantId}
                  previous={latestByLocator[l.id]?.current_reading ?? null}
                  previousDt={latestByLocator[l.id]?.reading_datetime ?? null}
                  todayReadings={todayByLocator[l.id] ?? []}
                  avgVol={avgByLocator[l.id] ?? null}
                  userId={user?.id}
                  onSaved={() => invalidateDashboard(qc)}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                  maxReadingsPerDay={maxLocatorReadings}
                />
              )}
            />
          ) : (
            <p className="p-4 text-xs text-muted-foreground text-center">No active locators for this plant</p>
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
          onImported={() => { setImportOpen(false); invalidateDashboard(qc); }}
        />
      )}
    </div>
  );
}

function LocatorRow({
  locator, plantId, previous, previousDt, todayReadings, avgVol, userId, onSaved, isManagerOrAdmin, maxReadingsPerDay = 3,
}: {
  locator: any; plantId: string; previous: number | null; previousDt: string | null;
  todayReadings: any[]; avgVol: number | null;
  userId: string | undefined; onSaved: () => void;
  isManagerOrAdmin: boolean;
  maxReadingsPerDay?: number;
}) {
  const isMobile = useIsMobile();

  const [reading, setReading]     = useState('');
  const lastPrefilledLoc = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt]   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // 'raw'  = user enters cumulative meter reading; delta = cur - prev
  // 'direct' = user enters daily m³ directly; stored as daily_volume
  const [locInputMode, setLocInputMode] = useState<'raw' | 'direct'>('raw');

  // Pre-fill the drum with the latest previous reading so the operator
  // starts from the real odometer value and rolls only the changed digits.
  //
  // Race-condition fix — two scenarios both produce stale display:
  //  (A) After save: setReading('') fires synchronously, effect pre-fills with
  //      OLD `previous` before 'op-loc-recent' refetches. When the query later
  //      returns NEW `previous`, reading !== '' so the effect no-ops → stale drum.
  //  (B) The 30-second poll (refetchInterval) on op-loc-recent fires and brings in
  //      a newer reading from another session — same no-op because reading !== ''.
  //  Fix: track the last auto-filled value in a ref. If `previous` changes and the
  //  drum still shows that old auto-fill (user hasn't touched it), update to latest.
  useEffect(() => {
    if (locInputMode !== 'raw' || previous == null || editingId) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledLoc.current) {
      setReading(expected);
      lastPrefilledLoc.current = expected;
    }
  }, [previous, locInputMode, editingId, reading]);

  const cur      = +reading || 0;
  // A reading that exactly equals previous is the pre-filled baseline, not a new entry.
  const readingChanged = reading !== '' && (previous == null || cur !== previous);
  const dailyVol = locInputMode === 'direct'
    ? (reading ? +reading : null)                      // entered value IS the delta
    : (readingChanged && previous != null ? cur - previous : null);
  const belowPrev = locInputMode === 'raw' && previous != null && cur > 0 && cur < previous;
  // Q = V / t: compute current flow rate (m³/hr) from delta ÷ hours since last reading.
  // avgVol is the 10-day average flow rate (m³/hr); warn when current rate exceeds avg × multiplier.
  const hoursElapsedLoc = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const currentFlowRateLoc = dailyVol != null && hoursElapsedLoc != null && hoursElapsedLoc > 0
    ? dailyVol / hoursElapsedLoc
    : null;
  const highVol = locInputMode === 'raw' && avgVol != null && currentFlowRateLoc != null
    && currentFlowRateLoc > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= maxReadingsPerDay;

  // ── Alert state for odometer drum ─────────────────────────────────────────
  const odometerAlert: OdometerAlertState =
    !readingChanged   ? 'neutral' :
    belowPrev         ? 'warn'    :
    highVol           ? 'warn'    :
    (+reading < 0 && locInputMode === 'raw') ? 'error' :
    'ok';

  const save = async () => {
    if (!reading) { toast.error(`${locator.name}: enter a reading`); return; }
    if (atLimit) { toast.error(`${locator.name}: max ${maxReadingsPerDay} readings/day reached`); return; }
    if (locInputMode === 'direct' && +reading <= 0) { toast.error(`${locator.name}: enter a positive volume`); return; }
    // Fix #8 — window.confirm is blocked in iframes. The below-prev and high-vol
    // warnings are already shown as inline alert banners in the UI (the yellow strip
    // below the input). We now use those banners as the only warning and remove the
    // blocking confirm dialogs. If the user clicks Save while the banner is visible
    // they have implicitly acknowledged the warning.
    if (belowPrev) toast.warning(`${locator.name}: reading below previous — saved anyway`);
    else if (highVol) toast.warning(`${locator.name}: volume unusually high vs. avg — saved anyway`);

    setSaving(true);
    let gps_lat = null, gps_lng = null, off = false;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
      if (locator.gps_lat && locator.gps_lng)
        off = isOffLocation(gps_lat, gps_lng, locator.gps_lat, locator.gps_lng, 100);
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    // FIX: daily_volume removed — GENERATED ALWAYS column.
    //      plant_id IS required (NOT NULL) — keep it.
    //      is_estimated: false — this is an operator-entered real reading;
    //      clears any regression estimate that may have been written for this slot.
    const payload: any = locInputMode === 'direct'
      ? {
          locator_id: locator.id, plant_id: plantId,
          current_reading: previous ?? cur,
          previous_reading: previous,
          // daily_volume intentionally omitted — GENERATED ALWAYS column
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        }
      : {
          locator_id: locator.id, plant_id: plantId,
          current_reading: cur, previous_reading: previous,
          // daily_volume intentionally omitted — GENERATED ALWAYS column
          gps_lat, gps_lng, off_location_flag: off, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
          is_estimated: false,
        };
    const { error } = editingId
      ? await supabase.from('locator_readings').update(payload).eq('id', editingId)
      : await supabase.from('locator_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${locator.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setEditingId(null); onSaved();
  };

  // ── Shared action buttons row (edit / cancel / history) ────────────────────
  const ActionButtons = (
    <>
      {lastToday && !editingId && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => { setEditingId(lastToday.id); setReading(String(lastToday.current_reading)); }}
          title={`Edit last reading (${fmtNum(lastToday.current_reading)})`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {editingId && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => { setEditingId(null); setReading(''); }} title="Cancel edit">
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      {isManagerOrAdmin && (
        <Button variant="ghost" size="sm"
          className="h-10 w-10 p-0 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
          onClick={() => setShowHistory(true)} title="View reading history">
          <History className="h-3.5 w-3.5" />
        </Button>
      )}
    </>
  );

  return (
    <div className="px-4 py-3 space-y-2.5">
      {/* Row 1: Name + editing badge (full width — no truncation) */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground break-words">{locator.name}</div>
          {lastToday?.off_location_flag && (
            <StatusPill tone="warn"><MapPin className="h-3 w-3" /> off-site</StatusPill>
          )}
          {editingId && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 rounded">Editing</span>
          )}
        </div>
        {/* Date picker always visible, not fighting for space with the name */}
        <label className="shrink-0 cursor-pointer relative">
          <span className="text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-2.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors">
            {customDt ? new Date(customDt).toLocaleString([], { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
          </span>
          <Input type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" title="Reading date & time" />
        </label>
      </div>

      {/* Row 2: input mode toggle + status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-border overflow-hidden text-[10px] font-semibold shrink-0">
          <button type="button"
            onClick={() => { setLocInputMode('raw'); setReading(''); }}
            className={`px-2.5 py-1.5 transition-colors ${locInputMode === 'raw' ? 'bg-teal-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
            title="Cumulative meter reading — Δ auto-computed">Raw</button>
          <button type="button"
            onClick={() => { setLocInputMode('direct'); setReading(''); }}
            className={`px-2.5 py-1.5 transition-colors border-l border-border ${locInputMode === 'direct' ? 'bg-teal-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
            title="Enter daily m³ directly">Direct m³</button>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {locInputMode === 'raw' ? (
            <>
              prev: <span className="font-mono-num text-foreground/80">{previous == null ? '—' : fmtNum(previous)}</span>
              {/* On mobile the delta is shown below the drum, so only show it inline on desktop */}
              {!isMobile && dailyVol != null && <> · Δ <span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span></>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          ) : (
            <>
              {dailyVol != null ? <><span className="font-mono-num font-medium text-teal-700 dark:text-teal-400">{fmtNum(dailyVol)} m³</span> to save</> : <span className="text-muted-foreground/60">enter daily volume</span>}
              <span className="mx-1.5 text-border">·</span>
              <span className={atLimit ? 'text-warn-foreground font-medium' : 'text-muted-foreground'}>{todayCount}/{maxReadingsPerDay} today</span>
            </>
          )}
        </div>
      </div>

      {/* ── Row 3 (mobile raw mode): Odometer drum + current reading + save ── */}
      {isMobile && locInputMode === 'raw' ? (
        <div className="space-y-2">
          {/* Drum display */}
          <OdometerRollerInput
            value={reading}
            onChange={setReading}
            alertState={odometerAlert}
            disabled={saving || atLimit}
            testId={`loc-odometer-${locator.id}`}
          />

          {/* Current reading label + delta */}
          <div className="flex items-center justify-between text-xs px-0.5 min-h-[18px]">
            <span className="text-muted-foreground">
              Current:{' '}
              <span className={`font-mono-num font-semibold ${reading ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                {reading ? (+reading).toFixed(2) : '—'}
              </span>
            </span>
            {dailyVol != null && (
              <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                Δ {fmtNum(dailyVol)} m³
              </span>
            )}
          </div>

          {/* Save + action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !readingChanged || atLimit}
              className="flex-1 h-11 text-sm bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update' : 'Save'}
            </Button>
            {ActionButtons}
          </div>
        </div>
      ) : (
        /* ── Row 3 (desktop or direct-mode): standard Input row ── */
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Droplet className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-500 pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={(e) => setReading(e.target.value)}
              placeholder={locInputMode === 'direct' ? 'Daily volume (m³)' : 'Meter reading'}
              className="pl-8 h-10 bg-teal-50/30 dark:bg-teal-950/10 border-teal-200 dark:border-teal-800/50 focus-visible:ring-teal-500/30"
            />
          </div>
          <Button
            onClick={save} disabled={saving || !readingChanged || atLimit}
            className="h-10 px-4 text-sm shrink-0 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
          </Button>
          {ActionButtons}
        </div>
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
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {belowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {highVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Flow rate is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the 10-day average — unusually high.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WELL ────────────────────────────────────────────────────────────────────

// ─── SharedPowerMeterRow ──────────────────────────────────────────────────────
// Shown once per shared-power-meter group, above the member wells.
// Saves the raw kWh reading to the primary well's record for that day.
function SharedPowerMeterRow({
  groupName, primaryWellId, plantId, previousPower, userId, onSaved,
}: {
  groupName: string;
  primaryWellId: string;
  plantId: string;
  previousPower: number | null;
  userId: string | undefined;
  onSaved: () => void;
}) {
  const [reading, setReading] = useState('');
  const [saving, setSaving] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const save = async () => {
    if (!reading) { toast.error(`${groupName}: enter a power meter reading`); return; }
    setSaving(true);
    const val = +reading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    // Check if primary well already has a reading today — update it if so
    const { data: todayRecs } = await supabase
      .from('well_readings')
      .select('id')
      .eq('well_id', primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false })
      .limit(1);

    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val })
        .eq('id', (todayRecs[0] as any).id);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
    } else {
      // No water reading yet for today — insert a standalone power record
      const { error } = await supabase.from('well_readings').insert({
        well_id: primaryWellId,
        plant_id: plantId,
        current_reading: previousPower ?? 0,
        power_meter_reading: val,
        recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
    }

    toast.success(`${groupName}: power meter saved`);
    setReading('');
    onSaved();
  };

  return (
    /* ── Shared meter group header — owns the kWh input ── */
    <div className="border-b border-amber-200/80 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20">
      {/* Title bar */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
          <Zap className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground tracking-tight truncate">{groupName}</span>
          <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-200/70 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full shrink-0">
            Shared Meter
          </span>
        </div>
        {/* Date picker */}
        <label className="shrink-0 cursor-pointer relative">
          <span className="text-[11px] text-muted-foreground bg-muted border border-border/70 rounded-md px-2.5 py-1.5 font-mono-num whitespace-nowrap hover:bg-muted/80 transition-colors">
            {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <Input type="datetime-local" value={customDt}
            onChange={e => setCustomDt(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            title="Reading date & time" />
        </label>
      </div>

      {/* kWh input */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          prev: <span className="font-mono-num font-medium text-foreground/80">{previousPower == null ? '—' : fmtNum(previousPower)}</span>
        </span>
        <div className="relative flex-1">
          <Zap className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-500 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={reading}
            onChange={e => setReading(e.target.value)} placeholder="Shared power kWh"
            className="h-10 pl-8 w-full border-amber-200 dark:border-amber-800/50 focus-visible:ring-amber-400/40 bg-white/70 dark:bg-amber-950/30 placeholder:text-muted-foreground/50"
            data-testid={`shared-power-input-${primaryWellId}`} />
        </div>
        <Button onClick={save} disabled={saving || !reading}
          className="h-10 px-4 text-sm shrink-0 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-sm border-0">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function WellReadingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  // Load plant meter config to detect shared power meter groups
  const { data: meterConfig } = useQuery({
    queryKey: ['plant-meter-config', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const { data } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config').eq('plant_id', plantId).maybeSingle();
        if (data?.config) return data.config as Record<string, any>;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) return JSON.parse(raw) as Record<string, any>;
      } catch { /* ignore */ }
      return {} as Record<string, any>;
    },
  });

  const sharedGroups: Array<{ id: string; name: string; members: string[] }> =
    (meterConfig?.wells_shared_electric_groups as any[]) ?? [];

  // Map: well ID → { groupId, groupName, primaryWellId (first member) }
  const wellGroupMap = useMemo(() => {
    const m: Record<string, { groupId: string; groupName: string; primaryWellId: string }> = {};
    for (const grp of sharedGroups) {
      if (!grp.members?.length) continue;
      for (const wId of grp.members) {
        m[wId] = { groupId: grp.id, groupName: grp.name, primaryWellId: grp.members[0] };
      }
    }
    return m;
  }, [sharedGroups]);

  const { data: wells } = useQuery({
    queryKey: ['op-wells', plantId],
    queryFn: async () => plantId
      ? (await supabase.from('wells').select('*').eq('plant_id', plantId).eq('status', 'Active').order('name')).data ?? []
      : [],
    enabled: !!plantId,
  });

  const { data: recentReadings } = useQuery({
    queryKey: ['op-well-recent', plantId],
    // meta.silent suppresses the global QueryCache error toast — the well section
    // degrades gracefully to empty state when the table / columns are missing.
    meta: { silent: true },
    queryFn: async () => {
      if (!plantId) return [];
      const start = new Date(); start.setDate(start.getDate() - 30);
      const { data, error } = await supabase.from('well_readings')
        .select('*').eq('plant_id', plantId)
        .gte('reading_datetime', start.toISOString())
        .order('reading_datetime', { ascending: false });
      if (error) {
        // Table or optional columns missing — degrade gracefully without a toast.
        // Run the migration in Supabase Dashboard to restore full functionality.
        console.warn('[op-well-recent] well_readings query failed:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: !!plantId,
    staleTime: 0,
    refetchInterval: 30_000, // poll every 30 s — mirrors op-loc-recent so both sections stay live
  });

  const { latestByWell, todayByWell, avgByWell } = useMemo(() => {
    const latest: Record<string, any> = {};
    const today: Record<string, any[]> = {};
    const avgs: Record<string, number | null> = {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const tenDaysAgo = new Date(); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const readingsByWell: Record<string, any[]> = {};
    recentReadings?.forEach((r: any) => {
      if (!latest[r.well_id]) latest[r.well_id] = r;
      if (new Date(r.reading_datetime) >= startOfDay) (today[r.well_id] ||= []).push(r);
      // Collect last-10-day readings for Q=V/t average
      if (new Date(r.reading_datetime) >= tenDaysAgo)
        (readingsByWell[r.well_id] ||= []).push(r);
    });
    // Q = V / t — average flow rate (m³/hr) over the last 10 days
    for (const [wId, readings] of Object.entries(readingsByWell)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(a.reading_datetime).getTime() - new Date(b.reading_datetime).getTime(),
      );
      const flowRates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const vol = sorted[i].current_reading - sorted[i - 1].current_reading;
        const hrs = (new Date(sorted[i].reading_datetime).getTime() - new Date(sorted[i - 1].reading_datetime).getTime()) / 3_600_000;
        if (vol > 0 && hrs > 0) flowRates.push(vol / hrs);
      }
      avgs[wId] = flowRates.length ? flowRates.reduce((s, n) => s + n, 0) / flowRates.length : null;
    }
    return { latestByWell: latest, todayByWell: today, avgByWell: avgs };
  }, [recentReadings]);

  const { data: blendingData } = useBlendingWells(plantId);
  const blendingSet = useMemo(
    () => new Set((blendingData?.wells ?? []).map((w) => w.well_id)),
    [blendingData],
  );

  // Split wells into shared-group sections and standalone
  const { groupedSections, standaloneWells } = useMemo(() => {
    if (!wells?.length) return { groupedSections: [], standaloneWells: [] };
    const groupMap: Record<string, { group: { id: string; name: string; members: string[] }; wells: any[] }> = {};
    const standalone: any[] = [];
    for (const w of wells as any[]) {
      const info = wellGroupMap[w.id];
      if (info) {
        if (!groupMap[info.groupId]) {
          const grp = sharedGroups.find(g => g.id === info.groupId)!;
          groupMap[info.groupId] = { group: grp, wells: [] };
        }
        groupMap[info.groupId].wells.push(w);
      } else {
        standalone.push(w);
      }
    }
    return { groupedSections: Object.values(groupMap), standaloneWells: standalone };
  }, [wells, wellGroupMap, sharedGroups]);

  const onSaved = () => invalidateDashboard(qc);

  return (
    <div className="space-y-3">
      {/* Plant selector card */}
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
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
          {/* Section header */}
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Droplet className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Active Wells</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">
              {wells?.length ?? 0} total
            </span>
          </div>
          {wells?.length ? (
            (() => {
              // Flatten all wells into a single ordered list for the mobile carousel.
              // Group wells are kept together (group header implicit via sharedPower prop).
              const allWellItems: Array<{
                w: any;
                isInSharedPowerGroup: boolean;
                sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
                previousPower: number | null;
              }> = [];

              groupedSections.forEach(({ group, wells: groupWells }) => {
                groupWells.forEach((w: any, idx: number) => {
                  allWellItems.push({
                    w,
                    isInSharedPowerGroup: true,
                    previousPower: null,
                    sharedPower: idx === groupWells.length - 1 ? {
                      groupName: group.name,
                      primaryWellId: group.members[0],
                      previousPower: latestByWell[group.members[0]]?.power_meter_reading ?? null,
                    } : undefined,
                  });
                });
              });

              standaloneWells.forEach((w: any) => {
                allWellItems.push({
                  w,
                  isInSharedPowerGroup: false,
                  previousPower: latestByWell[w.id]?.power_meter_reading ?? null,
                });
              });

              return (
                <MobileCarousel
                  isMobile={isMobile}
                  items={allWellItems}
                  renderItem={(item: typeof allWellItems[number]) => (
                    <WellRow
                      key={item.w.id}
                      well={item.w} plantId={plantId}
                      previousMeter={latestByWell[item.w.id]?.current_reading ?? null}
                      previousPower={item.previousPower}
                      previousDt={latestByWell[item.w.id]?.reading_datetime ?? null}
                      avgVol={avgByWell[item.w.id] ?? null}
                      todayReadings={todayByWell[item.w.id] ?? []}
                      userId={user?.id}
                      isBlending={blendingSet.has(item.w.id)}
                      onSaved={onSaved}
                      isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                      isInSharedPowerGroup={item.isInSharedPowerGroup}
                      sharedPower={item.sharedPower}
                    />
                  )}
                />
              );
            })()
          ) : (
            <p className="px-4 py-6 text-xs text-muted-foreground text-center">No active wells for this plant</p>
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
          onImported={() => { setImportOpen(false); invalidateDashboard(qc); }}
        />
      )}
    </div>
  );
}

function WellRow({
  well, plantId, previousMeter, previousPower, previousDt, avgVol, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, isInSharedPowerGroup,
  sharedPower,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  previousDt: string | null; avgVol: number | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
}) {
  const isMobile = useIsMobile();

  const [reading, setReading]                   = useState('');
  const lastPrefilledMeter = useRef<string | null>(null);
  const [powerReading, setPowerReading]           = useState('');
  const [tdsReading, setTdsReading]               = useState('');
  const [pressureReading, setPressureReading]     = useState('');
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [saving, setSaving]                     = useState(false);
  const [savingTds, setSavingTds]               = useState(false);
  const [savingPressure, setSavingPressure]     = useState(false);
  const [savingPower, setSavingPower]           = useState(false);
  const [sharedPowerReading, setSharedPowerReading] = useState('');
  const [savingSharedPower, setSavingSharedPower]   = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [customDt, setCustomDt]                 = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // Pre-fill the drum with the latest previous meter reading so the operator
  // starts from the real odometer value and only rolls the changed digits.
  // Race-condition fix: same as LocatorRow — see comment there for full details.
  useEffect(() => {
    if (editingId || previousMeter == null) return;
    const expected = previousMeter.toFixed(2);
    if (reading === '' || reading === lastPrefilledMeter.current) {
      setReading(expected);
      lastPrefilledMeter.current = expected;
    }
  }, [previousMeter, reading, editingId]);

  const cur        = +reading || 0;
  // A reading that exactly matches the pre-filled previous is the baseline, not a new entry.
  const meterChanged = reading !== '' && (previousMeter == null || cur !== previousMeter);
  const dailyVol   = meterChanged && previousMeter != null ? cur - previousMeter : null;
  const belowPrev  = previousMeter != null && cur > 0 && cur < previousMeter;
  // Q = V / t: compare current flow rate against 10-day average flow rate (m³/hr)
  const hoursElapsedWell = previousDt && reading
    ? (new Date(customDt).getTime() - new Date(previousDt).getTime()) / 3_600_000
    : null;
  const wellFlowRate = dailyVol != null && hoursElapsedWell != null && hoursElapsedWell > 0
    ? dailyVol / hoursElapsedWell
    : null;
  const highVol    = avgVol != null && wellFlowRate != null && wellFlowRate > avgVol * ALERTS.avg_multiplier_warn;
  const todayCount = todayReadings.length;
  const lastToday  = todayReadings[0] ?? null;
  const atLimit    = !editingId && todayCount >= WELL_MAX_READINGS_PER_DAY;
  const showDedicatedPower = well.has_power_meter && !isInSharedPowerGroup;

  // ── Alert state for water-meter odometer drum (mobile) ───────────────────
  const wellOdometerAlert: OdometerAlertState =
    !meterChanged ? 'neutral' :
    belowPrev     ? 'warn'    :
    highVol       ? 'warn'    :
    'ok';

  // ── Main water (+ optional dedicated power) save ──
  const save = async () => {
    if (!reading) { toast.error(`${well.name}: enter a meter reading`); return; }
    if (atLimit) { toast.error(`${well.name}: max ${WELL_MAX_READINGS_PER_DAY} readings/day reached`); return; }
    if (belowPrev) toast.warning(`${well.name}: meter below previous — saved anyway`);
    else if (highVol) toast.warning(`${well.name}: flow rate unusually high vs. 10-day average — saved anyway`);

    setSaving(true);
    let gps_lat = null, gps_lng = null;
    try {
      const pos = await getCurrentPosition();
      gps_lat = pos.coords.latitude; gps_lng = pos.coords.longitude;
    } catch (err) { console.warn('[Operations] geolocation unavailable:', err); }

    const payload: any = {
      well_id: well.id, plant_id: plantId,
      current_reading: cur, previous_reading: previousMeter,
      daily_volume: dailyVol != null ? Math.max(0, dailyVol) : null,
      // Include dedicated power if not in shared group
      power_meter_reading: showDedicatedPower && powerReading ? +powerReading : null,
      gps_lat, gps_lng, off_location_flag: false, recorded_by: userId,
      reading_datetime: new Date(customDt).toISOString(),
    };
    // Only include tds_ppm / pressure_psi when non-empty — sending null for a missing
    // DB column causes Supabase to reject the entire row with a schema cache error
    // ("relation 'well_readings' does not exist"). Same fix already applied to
    // solar_meter_reading in the CSV import path.
    if (tdsReading) payload.tds_ppm = +tdsReading;
    if (pressureReading) payload.pressure_psi = +pressureReading;
    const { error } = editingId
      ? await supabase.from('well_readings').update(payload).eq('id', editingId)
      : await supabase.from('well_readings').insert(payload);

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${well.name}: ${editingId ? 'updated' : 'saved'}`);
    setReading(''); setPowerReading(''); setTdsReading(''); setPressureReading('');
    setEditingId(null); onSaved();
  };

  // ── Dedicated power save (standalone — updates today's record or inserts new) ──
  const savePower = async () => {
    if (!powerReading) { toast.error(`${well.name}: enter a power reading`); return; }
    setSavingPower(true);
    const val = +powerReading;
    if (lastToday) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', lastToday.id);
      setSavingPower(false);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: well.id, plant_id: plantId,
        current_reading: previousMeter ?? 0, previous_reading: previousMeter,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingPower(false);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`${well.name}: power saved`);
    setPowerReading(''); onSaved();
  };

  // ── TDS save (updates today's record or inserts new) ──
  const saveTds = async () => {
    if (!tdsReading) { toast.error(`${well.name}: enter a TDS value`); return; }
    setSavingTds(true);
    const val = +tdsReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ tds_ppm: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          tds_ppm: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: TDS saved`);
      setTdsReading(''); onSaved();
    } catch (e: any) {
      toast.error(`TDS save failed: ${e.message}`);
      console.error('saveTds error:', e);
    } finally { setSavingTds(false); }
  };

  // ── Pressure save (updates today's record or inserts new) ──
  const savePressure = async () => {
    if (!pressureReading) { toast.error(`${well.name}: enter a pressure value`); return; }
    setSavingPressure(true);
    const val = +pressureReading;
    try {
      let error: any;
      if (lastToday) {
        ({ error } = await (supabase.from('well_readings') as any).update({ pressure_psi: val }).eq('id', lastToday.id));
      } else {
        ({ error } = await (supabase.from('well_readings') as any).insert({
          well_id: well.id, plant_id: plantId,
          current_reading: previousMeter ?? 0, previous_reading: previousMeter,
          pressure_psi: val, recorded_by: userId,
          reading_datetime: new Date(customDt).toISOString(),
        }));
      }
      if (error) throw new Error(error.message);
      toast.success(`${well.name}: pressure saved`);
      setPressureReading(''); onSaved();
    } catch (e: any) {
      toast.error(`Pressure save failed: ${e.message}`);
      console.error('savePressure error:', e);
    } finally { setSavingPressure(false); }
  };

  // ── Shared group power save — attaches to primaryWellId's record ──
  const saveSharedPower = async () => {
    if (!sharedPower || !sharedPowerReading) { toast.error(`${sharedPower?.groupName ?? 'Group'}: enter a power meter reading`); return; }
    setSavingSharedPower(true);
    const val = +sharedPowerReading;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { data: todayRecs } = await supabase
      .from('well_readings').select('id')
      .eq('well_id', sharedPower.primaryWellId)
      .gte('reading_datetime', startOfDay.toISOString())
      .order('reading_datetime', { ascending: false }).limit(1);
    if (todayRecs?.length) {
      const { error } = await supabase.from('well_readings')
        .update({ power_meter_reading: val }).eq('id', (todayRecs[0] as any).id);
      setSavingSharedPower(false);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('well_readings').insert({
        well_id: sharedPower.primaryWellId, plant_id: plantId,
        current_reading: sharedPower.previousPower ?? 0,
        power_meter_reading: val, recorded_by: userId,
        reading_datetime: new Date(customDt).toISOString(),
      } as any);
      setSavingSharedPower(false);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`${sharedPower.groupName}: power meter saved`);
    setSharedPowerReading(''); onSaved();
  };

  return (
    <div className="border border-border/70 rounded-lg overflow-hidden bg-card" data-testid={`well-row-${well.id}`}>

      {/* ── Header: name + badges left | status + date + actions right ── */}
      <div className="flex items-start justify-between flex-wrap gap-2 px-3 py-2 bg-muted/30 border-b border-border/60">
        {/* Left: name + badges — allow wrap so name is never hidden */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground break-words">{well.name}</span>
          {isBlending && (
            <span className="shrink-0 text-[10px] font-semibold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border border-teal-200/60 dark:border-teal-800/40 px-1.5 py-0.5 rounded-full" data-testid={`blending-badge-${well.id}`}>Blending</span>
          )}
          {well.has_power_meter && isInSharedPowerGroup && (
            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-900/30 border border-amber-200/60 dark:border-amber-800/40 px-1.5 py-0.5 rounded-full">
              <Zap className="h-2.5 w-2.5" />Shared
            </span>
          )}
          {editingId && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.5 rounded">Editing</span>
          )}
        </div>

        {/* Right: count · delta · date · icons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded-full border ${atLimit ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800/50' : 'text-muted-foreground bg-muted border-transparent'}`}>
            {todayCount}/{WELL_MAX_READINGS_PER_DAY}
          </span>
          {dailyVol != null && (
            <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 tabular-nums">Δ{fmtNum(dailyVol)}</span>
          )}
          {/* Date picker — hidden native input behind styled label */}
          <label className="cursor-pointer relative shrink-0">
            <span className="text-[11px] text-muted-foreground bg-background border border-border/70 rounded px-2 py-1 font-mono-num whitespace-nowrap hover:bg-muted/50 transition-colors">
              {new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <input type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" title="Reading date & time" />
          </label>
          {/* Edit today's record */}
          {lastToday && !editingId && (
            <button
              onClick={() => {
                setEditingId(lastToday.id);
                setReading(String(lastToday.current_reading ?? ''));
                setPowerReading(lastToday.power_meter_reading != null ? String(lastToday.power_meter_reading) : '');
                setTdsReading(lastToday.tds_ppm != null ? String(lastToday.tds_ppm) : '');
                setPressureReading(lastToday.pressure_psi != null ? String(lastToday.pressure_psi) : '');
              }}
              title={`Edit last today reading (${fmtNum(lastToday.current_reading)})`}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {editingId && (
            <button onClick={() => { setEditingId(null); setReading(''); setPowerReading(''); setTdsReading(''); setPressureReading(''); }}
              title="Cancel edit"
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {isManagerOrAdmin && (
            <button onClick={() => setShowHistory(true)} title="View reading history"
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <History className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Body: two-column grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2">

        {/* LEFT column: Water Meter + optional Grid/Power Meter */}
        <div className="px-3 py-2 space-y-2 border-b border-border/40 sm:border-b-0">

          {/* Water Meter Reading — odometer drum on mobile, compact input on desktop */}
          {isMobile ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground">Water Meter</p>
              <OdometerRollerInput
                value={reading}
                onChange={setReading}
                alertState={wellOdometerAlert}
                disabled={saving || atLimit}
                testId={`well-meter-input-${well.id}`}
              />
              {/* prev + delta info row */}
              <div className="flex items-center justify-between text-[11px] px-0.5">
                <span className="text-muted-foreground">
                  prev: <span className="font-mono-num text-foreground/80">
                    {previousMeter != null ? fmtNum(previousMeter) : '—'}
                  </span>
                </span>
                {dailyVol != null && (
                  <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                    Δ {fmtNum(dailyVol)} m³
                  </span>
                )}
              </div>
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit}
                className="w-full h-10 text-sm bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
                title="Save water meter reading">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0">Water Meter</p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={reading} onChange={e => setReading(e.target.value)}
                placeholder={previousMeter != null ? `Prev: ${fmtNum(previousMeter)}` : 'Enter reading'}
                className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/30 placeholder:text-muted-foreground/50"
                data-testid={`well-meter-input-${well.id}`}
              />
              <Button
                onClick={save} disabled={saving || !meterChanged || atLimit}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs shadow-sm"
                title="Save water meter reading">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? 'Update' : 'Save'}
              </Button>
            </div>
          )}

          {/* Grid / Dedicated Power Meter — only for wells with a power meter not in a shared group */}
          {showDedicatedPower && (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0 flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5 text-amber-500" />Grid Meter
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={powerReading} onChange={e => setPowerReading(e.target.value)}
                placeholder={previousPower != null ? `Prev: ${fmtNum(previousPower)}` : 'kWh reading'}
                className="h-7 flex-1 min-w-0 text-xs border-amber-200/80 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 focus-visible:ring-amber-400/30 placeholder:text-muted-foreground/50"
                data-testid={`well-power-input-${well.id}`}
              />
              <Button
                onClick={savePower} disabled={savingPower || !powerReading}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs shadow-sm border-0"
                title="Save power meter reading">
                {savingPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}

          {/* Shared Power Meter — shown only on the last well of the group */}
          {sharedPower && (
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground w-24 shrink-0 flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5 text-amber-500" />Shared Power
              </p>
              <Input
                type="number" step="any" inputMode="decimal"
                value={sharedPowerReading} onChange={e => setSharedPowerReading(e.target.value)}
                placeholder={sharedPower.previousPower != null ? `Prev: ${fmtNum(sharedPower.previousPower)}` : 'kWh reading'}
                className="h-7 flex-1 min-w-0 text-xs border-amber-200/80 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10 focus-visible:ring-amber-400/30 placeholder:text-muted-foreground/50"
                data-testid={`shared-power-input-${sharedPower.primaryWellId}`}
              />
              <Button
                onClick={saveSharedPower} disabled={savingSharedPower || !sharedPowerReading}
                size="sm"
                className="h-7 px-2.5 shrink-0 bg-amber-600 hover:bg-amber-700 text-white text-xs shadow-sm border-0"
                title="Save shared power meter reading">
                {savingSharedPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
              </Button>
            </div>
          )}
        </div>

        {/* RIGHT column: TDS + Pressure */}
        <div className="px-3 py-2 space-y-2">

          {/* TDS */}
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">TDS</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={tdsReading} onChange={e => setTdsReading(e.target.value)}
              placeholder="ppm"
              className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/20 placeholder:text-muted-foreground/40"
              data-testid={`well-tds-input-${well.id}`}
            />
            <Button
              onClick={saveTds} disabled={savingTds || !tdsReading}
              size="sm" variant="outline"
              className="h-7 px-2.5 shrink-0 text-xs border-border/70"
              title="Save TDS reading">
              {savingTds ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>

          {/* Pressure */}
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium text-muted-foreground w-16 shrink-0">Pressure</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={pressureReading} onChange={e => setPressureReading(e.target.value)}
              placeholder="psi"
              className="h-7 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-teal-500/20 placeholder:text-muted-foreground/40"
              data-testid={`well-pressure-input-${well.id}`}
            />
            <Button
              onClick={savePressure} disabled={savingPressure || !pressureReading}
              size="sm" variant="outline"
              className="h-7 px-2.5 shrink-0 text-xs border-border/70"
              title="Save pressure reading">
              {savingPressure ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Warning banners ── */}
      {reading && (belowPrev || highVol) && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {belowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Meter reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {highVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Flow rate is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the 10-day average — unusually high.
            </span>
          )}
        </div>
      )}

      {showHistory && (
        <ReadingHistoryDialog
          entityName={well.name}
          module="well"
          entityId={well.id}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

// ─── BLENDING ────────────────────────────────────────────────────────────────

function BlendingForm() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
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

  // Fetch the latest raw_meter_reading per blending well from the DB so the
  // OdometerRollerInput can pre-fill correctly on devices with no localStorage.
  const { data: latestRawData } = useQuery({
    queryKey: ['blending-latest-raw', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data } = await (supabase.from('blending_events' as any) as any)
        .select('well_id, raw_meter_reading, event_date')
        .eq('plant_id', plantId)
        .not('raw_meter_reading', 'is', null)
        .order('event_date', { ascending: false })
        .limit(200);
      // Keep only the most recent row per well
      const seen = new Set<string>();
      return ((data ?? []) as any[]).filter((r: any) => {
        if (seen.has(r.well_id)) return false;
        seen.add(r.well_id);
        return true;
      });
    },
    enabled: !!plantId,
  });

  const latestRawByWell = useMemo(() => {
    const m: Record<string, { reading: number; date: string } | null> = {};
    for (const r of latestRawData ?? [])
      m[r.well_id] = { reading: r.raw_meter_reading, date: r.event_date };
    return m;
  }, [latestRawData]);

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
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
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="h-3.5 w-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-foreground/80 tracking-tight">Blending Wells</span>
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{blendingWells.length} tagged</span>
          </div>
          {blendingWells.length ? (
            <MobileCarousel
              isMobile={isMobile}
              items={blendingWells}
              renderItem={(w: any) => (
                <BlendingRow
                  key={w.id}
                  well={w} plantId={plantId} plantName={plantName}
                  todayVolume={todayByWell[w.id] ?? 0}
                  previousVolume={prevByWell[w.id]?.volume ?? null}
                  previousDate={prevByWell[w.id]?.date ?? null}
                  avgVol={prevByWell[w.id]?.volume ?? null}
                  dbLatestRaw={latestRawByWell[w.id] ?? null}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ['blending-today', plantId] });
                    qc.invalidateQueries({ queryKey: ['blending-latest-raw', plantId] });
                    qc.invalidateQueries({ queryKey: ['blending-volume'] });
                  }}
                  isManagerOrAdmin={isAdmin || isManager || isDataAnalyst}
                />
              )}
            />
          ) : (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              No wells tagged as blending for this plant. Tag a well under <span className="font-medium text-foreground/70">Plants → Wells</span>.
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

// ─── Blending per-well localStorage keys ─────────────────────────────────────
// BUG FIX #2: persist the user's chosen input mode (raw vs direct) across
// re-mounts / tab switches so it doesn't silently reset to 'direct' each time.
// BUG FIX #3: persist the last cumulative meter reading entered in raw mode
// so the Δ calculation and "prev" hint are correct on the next visit.
// The DB only stores the computed daily-volume delta — it has no cumulative
// column — so localStorage is the only reliable source for the previous raw value.
function getBlendingModeKey(wellId: string) { return `blending-mode-${wellId}`; }
function getBlendingRawKey(wellId: string)  { return `blending-raw-${wellId}`; }

function readPersistedMode(wellId: string): 'raw' | 'direct' {
  try {
    const v = localStorage.getItem(getBlendingModeKey(wellId));
    return v === 'raw' ? 'raw' : 'direct';
  } catch { return 'direct'; }
}

function readPersistedRaw(wellId: string): { reading: number; date: string } | null {
  try {
    const v = localStorage.getItem(getBlendingRawKey(wellId));
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function persistMode(wellId: string, mode: 'raw' | 'direct') {
  try { localStorage.setItem(getBlendingModeKey(wellId), mode); } catch {}
}

function persistRaw(wellId: string, reading: number, date: string) {
  try { localStorage.setItem(getBlendingRawKey(wellId), JSON.stringify({ reading, date })); } catch {}
}

function BlendingRow({
  well, plantId, plantName, todayVolume, previousVolume, previousDate, avgVol, dbLatestRaw, onSaved, isManagerOrAdmin,
}: {
  well: any; plantId: string; plantName?: string;
  todayVolume: number; previousVolume: number | null; previousDate: string | null;
  avgVol?: number | null;
  dbLatestRaw?: { reading: number; date: string } | null;
  onSaved: () => void;
  isManagerOrAdmin: boolean;
}) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [volume, setVolume] = useState('');
  const lastPrefilledBlend = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  // BUG FIX #2: initialise from localStorage so the mode survives remounts/navigation.
  const [inputMode, setInputMode] = useState<'raw' | 'direct'>(() => readPersistedMode(well.id));

  // BUG FIX #3: the previous *cumulative* meter reading is not stored in the DB
  // (the DB only keeps the computed daily-volume delta). Read it from localStorage
  // where it was written on the last successful raw-mode save for this well.
  const [prevRawReading, setPrevRawReading] = useState<{ reading: number; date: string } | null>(
    () => readPersistedRaw(well.id),
  );

  // Pre-fill the drum with the last persisted raw reading (raw mode) so the
  // operator starts from the real odometer value and rolls only the changed digits.
  // Priority: localStorage (most recent) → DB latest raw_meter_reading (fallback for
  // new devices / cleared storage) → nothing (first-ever entry).
  // Race-condition fix: same pattern as LocatorRow / WellRow — track last auto-fill
  // in a ref so a poll-driven update to prevRawReading also updates the drum when
  // the user hasn't yet typed anything.
  useEffect(() => {
    if (inputMode !== 'raw') return;
    const src = prevRawReading?.reading ?? dbLatestRaw?.reading ?? null;
    if (src == null) return;
    const expected = src.toFixed(2);
    if (volume === '' || volume === lastPrefilledBlend.current) {
      setVolume(expected);
      lastPrefilledBlend.current = expected;
    }
  }, [prevRawReading, dbLatestRaw, inputMode, volume]);

  // Pre-fill with today's already-logged volume for direct mode.
  useEffect(() => {
    if (volume === '' && todayVolume > 0 && inputMode === 'direct') {
      setVolume(todayVolume.toFixed(2));
    }
  }, [todayVolume, volume, inputMode]);

  // BUG FIX #2: persist the chosen mode and clear the input field.
  const switchMode = (m: 'raw' | 'direct') => {
    setInputMode(m);
    setVolume('');
    persistMode(well.id, m);
  };

  // BUG FIX #3: Δ for raw mode uses the persisted cumulative reading first,
  // then the DB-fetched raw_meter_reading (for cross-device consistency),
  // finally falling back to the API-supplied previousVolume (daily m³ — less accurate
  // for cumulative meters, but better than showing nothing).
  const prevCumulative: number | null =
    prevRawReading?.reading ?? dbLatestRaw?.reading ?? previousVolume ?? null;

  const deltaRaw = inputMode === 'raw' && volume !== ''
    ? prevCumulative != null ? +volume - prevCumulative : null
    : null;

  // BUG FIX #1: Save was permanently disabled in raw mode whenever there was no
  // prior reading (deltaRaw == null) — e.g. first entry ever for this well.
  // Fix: allow saving a baseline reading (storeVol = +volume) when no prev exists.
  // Also guard direct mode against saving 0 m³.
  const isBaselineRaw = inputMode === 'raw' && prevCumulative == null && volume !== '' && +volume > 0;
  const volumeChanged = volume !== '' && (
    inputMode === 'raw'
      ? isBaselineRaw || (deltaRaw != null && deltaRaw > 0)  // allow baseline entry
      : +volume > 0 && +volume !== todayVolume               // guard against saving 0
  );

  // ── Warning flags (mirrors well / locator logic) ───────────────────────────
  // Negative delta: raw mode reading goes below previous cumulative.
  const blendBelowPrev = inputMode === 'raw' && deltaRaw != null && deltaRaw < 0;
  // Above-average: compare current entry volume against avgVol (or previousVolume as
  // fallback reference) scaled by the shared ALERTS multiplier.
  const blendVolToCheck = inputMode === 'raw' ? (deltaRaw ?? null) : (volume !== '' ? +volume : null);
  const avgRef = avgVol ?? previousVolume;
  const blendHighVol = avgRef != null && blendVolToCheck != null
    && blendVolToCheck > avgRef * ALERTS.avg_multiplier_warn;

  const save = async () => {
    const eventDate = customDt.slice(0, 10);

    // BUG FIX #1 cont.: when no previous cumulative reading exists (baseline),
    // store the raw meter reading itself as the daily volume for this first entry.
    const storeVol = inputMode === 'raw'
      ? (deltaRaw != null ? deltaRaw : +volume)   // baseline → store full reading
      : +volume;

    if (!volume || !(storeVol > 0)) {
      // BUG FIX #4a: more descriptive error in raw mode (negative delta case).
      if (inputMode === 'raw' && deltaRaw != null && deltaRaw <= 0) {
        toast.error(`${well.name}: current reading must be greater than the previous (${fmtNum(prevCumulative!)})`);
      } else {
        toast.error(`${well.name}: enter a positive blending volume`);
      }
      return;
    }
    // Warn on suspicious values (same behaviour as locator / well — save proceeds).
    if (blendBelowPrev) toast.warning(`${well.name}: reading below previous — saved anyway`);
    else if (blendHighVol) toast.warning(`${well.name}: blending volume unusually high vs. reference — saved anyway`);
    setSaving(true);
    try {
      const { data: existing } = await (supabase.from('blending_events' as any) as any)
        .select('id').eq('well_id', well.id).eq('event_date', eventDate).limit(1);
      let error: any;
      if (existing?.length) {
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .update({ volume_m3: storeVol, plant_id: plantId, well_name: well.name, plant_name: plantName,
            reading_datetime: new Date(customDt).toISOString(),
            ...(inputMode === 'raw' ? { raw_meter_reading: +volume } : {}) })
          .eq('id', existing[0].id));
      } else {
        ({ error } = await (supabase.from('blending_events' as any) as any)
          .insert({ well_id: well.id, plant_id: plantId, well_name: well.name, plant_name: plantName,
            event_date: eventDate, reading_datetime: new Date(customDt).toISOString(),
            volume_m3: storeVol,
            ...(inputMode === 'raw' ? { raw_meter_reading: +volume } : {}) }));
      }
      if (error) throw error;

      // BUG FIX #3 cont.: persist the cumulative meter reading locally so the
      // next raw-mode save can compute the correct Δ.
      if (inputMode === 'raw') {
        persistRaw(well.id, +volume, eventDate);
        setPrevRawReading({ reading: +volume, date: eventDate });
        // Reset the pre-fill guard so the drum auto-fills with the new "prev"
        // value after setVolume('') clears the input.
        lastPrefilledBlend.current = null;
      }

      toast.success(`${well.name}: blending volume saved (${fmtNum(storeVol)} m³)`);
      setVolume('');

      // BUG FIX #4b: invalidate dashboard so stat cards refresh immediately.
      invalidateDashboard(qc, [well.id]);
      onSaved();
    } catch (e: any) {
      toast.error(`Blending save failed: ${e.message || e}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 space-y-2" data-testid={`blending-row-${well.id}`}>
      {/* Row 1: Well name + badge + history icon (always visible) */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium break-words">{well.name}</span>
            <Badge className="bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100 font-normal text-[10px]">Blending</Badge>
          </div>
        </div>
        {/* History + date always in top-right, never behind name */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isManagerOrAdmin && (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full text-muted-foreground"
              onClick={() => setShowHistory(true)} title="View blending history">
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
          <label className="cursor-pointer relative">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 font-mono-num whitespace-nowrap hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
            <Input type="datetime-local" value={customDt} onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" title="Reading date & time" />
          </label>
        </div>
      </div>

      {/* Row 2: prev / today data — label adapts to mode for clarity */}
      <div className="text-xs text-muted-foreground">
        {inputMode === 'raw' ? (
          <>
            {/* Priority: localStorage → DB raw_meter_reading → daily vol fallback */}
            prev meter: <span className="font-mono-num" title={
              prevRawReading
                ? `Last cumulative reading on ${prevRawReading.date}`
                : dbLatestRaw
                  ? `Last cumulative reading on ${dbLatestRaw.date} (from DB)`
                  : previousDate ? `Last entry on ${previousDate} (daily vol)` : 'No prior reading'
            }>
              {prevCumulative != null ? fmtNum(prevCumulative) : '—'}
            </span>
            {(prevRawReading?.date ?? dbLatestRaw?.date ?? previousDate) && (
              <span className="text-muted-foreground/60 ml-1">({prevRawReading?.date ?? dbLatestRaw?.date ?? previousDate})</span>
            )}
          </>
        ) : (
          <>
            prev: <span className="font-mono-num" title={previousDate ? `last entry on ${previousDate}` : 'no prior blending entry'}>
              {previousVolume == null ? '—' : `${fmtNum(previousVolume)} m³`}
            </span>
            {previousDate && <span className="text-muted-foreground/60 ml-1">({previousDate})</span>}
          </>
        )}
        <span className="mx-1">·</span>
        today: <span className="font-mono-num">{fmtNum(todayVolume)} m³</span> logged
      </div>

      {/* Row 3: Raw/Direct mode toggle */}
      <div className="flex items-center gap-0">
        <button
          onClick={() => switchMode('direct')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-l border transition-colors ${inputMode === 'direct' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}
        >Direct m³</button>
        <button
          onClick={() => switchMode('raw')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-r border-t border-b border-r transition-colors ${inputMode === 'raw' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'}`}
        >Raw Meter</button>
      </div>

      {/* Row 4: Input — drum roller (mobile + raw) or regular input */}
      {isMobile && inputMode === 'raw' ? (
        <div className="space-y-1.5">
          <OdometerRollerInput
            value={volume} onChange={setVolume}
            alertState={!volumeChanged ? 'neutral' : blendBelowPrev ? 'warn' : blendHighVol ? 'warn' : 'ok'}
            disabled={saving}
            testId={`blending-input-${well.id}`}
          />
          <div className="flex items-center justify-between text-[11px] px-0.5">
            <span className="text-muted-foreground">
              prev: <span className="font-mono-num">{prevCumulative != null ? fmtNum(prevCumulative) : '—'}</span>
            </span>
            {deltaRaw != null ? (
              <span className={`font-mono-num font-medium ${deltaRaw >= 0 ? 'text-violet-600' : 'text-destructive'}`}>
                Δ {fmtNum(deltaRaw)} m³
              </span>
            ) : isBaselineRaw ? (
              <span className="font-mono-num font-medium text-violet-500 text-[10px]">baseline entry</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="relative">
          <Droplet className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-violet-600 pointer-events-none" />
          <Input type="number" step="any" inputMode="decimal" value={volume}
            onChange={(e) => setVolume(e.target.value)}
            placeholder={inputMode === 'raw' ? 'Cumulative meter reading' : 'Blending m³'}
            className="h-9 pl-7 w-full border-violet-300 focus-visible:ring-violet-300 bg-violet-50/40 dark:bg-violet-950/20"
            data-testid={`blending-input-${well.id}`} />
          {inputMode === 'raw' && volume !== '' && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {deltaRaw != null ? (
                <>Δ <span className={`font-mono-num font-medium ${deltaRaw >= 0 ? 'text-violet-600' : 'text-destructive'}`}>{fmtNum(deltaRaw)} m³</span> will be saved</>
              ) : isBaselineRaw ? (
                <span className="text-violet-500">First reading — will be saved as baseline</span>
              ) : null}
            </p>
          )}
        </div>
      )}

      {/* Row 5: Save button — full-width on mobile */}
      <Button onClick={save} disabled={saving || !volumeChanged}
        className={isMobile ? 'w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm' : 'h-9 px-4 text-xs w-full bg-teal-700 text-white hover:bg-teal-800'}>
        {saving ? <Loader2 className={isMobile ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} /> : 'Save'}
      </Button>

      {/* Warning banner */}
      {volume !== '' && (blendBelowPrev || blendHighVol) && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {blendBelowPrev && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {blendHighVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Volume is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the reference — unusually high.
            </span>
          )}
        </div>
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
  const isMobile = useIsMobile();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = isAdmin || isManager || isDataAnalyst;

  // Product meters for the selected plant
  // NOTE: uses 'op-product-meters' key (NOT 'product-meters') to avoid colliding with
  // the Plants.tsx cache, which uses a different select projection and placeholderData
  // strategy — a shared key causes stale/incomplete data (blank meter names) to appear.
  const { data: meters, isLoading: metersLoading } = useQuery({
    queryKey: ['op-product-meters', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      let { data, error } = await supabase
        .from('product_meters' as any)
        .select('id, name, status, sort_order, created_at')
        .eq('plant_id', plantId)
        .order('sort_order', { ascending: true });
      if (error?.message?.includes('sort_order')) {
        ({ data, error } = await supabase
          .from('product_meters' as any)
          .select('id, name, status, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true }));
      }
      if (error?.message?.includes('status')) {
        let fallback;
        ({ data: fallback } = await supabase
          .from('product_meters' as any)
          .select('id, name, created_at')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: true }));
        return ((fallback ?? []) as any[]).map((m: any) => ({ ...m, status: 'Active' }));
      }
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

  // 10-day average daily_volume per meter — used for the high-volume warning in ProductMeterRow
  const { data: recentProductReadings } = useQuery({
    queryKey: ['product-readings-10day', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const since = new Date(); since.setDate(since.getDate() - 10);
      const { data } = await supabase
        .from('product_meter_readings' as any)
        .select('meter_id, daily_volume, reading_datetime')
        .eq('plant_id', plantId)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: !!plantId,
  });

  const avgByMeter = useMemo(() => {
    const acc: Record<string, number[]> = {};
    for (const r of recentProductReadings ?? []) {
      if (r.daily_volume != null && r.daily_volume > 0)
        (acc[r.meter_id] ||= []).push(r.daily_volume);
    }
    const result: Record<string, number | null> = {};
    for (const [id, vals] of Object.entries(acc))
      result[id] = vals.reduce((s, n) => s + n, 0) / vals.length;
    return result;
  }, [recentProductReadings]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['op-product-meters', plantId] });
    qc.invalidateQueries({ queryKey: ['product-readings-latest', plantId] });
    // Targeted Dashboard stat-card keys so new readings appear immediately
    qc.invalidateQueries({ queryKey: ['dash-product-meters-today'] });
    qc.invalidateQueries({ queryKey: ['dash-product-meters-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-today'] });
    qc.invalidateQueries({ queryKey: ['dash-loc-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-today'] });
    qc.invalidateQueries({ queryKey: ['dash-wells-yest'] });
    qc.invalidateQueries({ queryKey: ['dash-costs-today'] });
    qc.invalidateQueries({ queryKey: ['dash-summary-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-chem'] });
    qc.invalidateQueries({ queryKey: ['alerts-feed'] });
    // Targeted TrendChart keys so charts refresh immediately
    qc.invalidateQueries({ queryKey: ['trend-loc'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['trend-well'] });
    qc.invalidateQueries({ queryKey: ['trend-power'] });
    qc.invalidateQueries({ queryKey: ['trend-cost'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={setPlantId} />
          </div>
          {canEdit && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
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
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-3.5 w-3.5 text-teal-600" />
                <span className="text-xs font-semibold text-foreground/80 tracking-tight">Product Meters</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground tabular-nums bg-muted px-2 py-0.5 rounded-full">{meters?.length ?? 0} configured</span>
              </div>
            </div>

            {metersLoading ? (
              <div className="px-4 py-5 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meters…
              </div>
            ) : meters?.length ? (
              <MobileCarousel
                isMobile={isMobile}
                items={meters ?? []}
                renderItem={(m: any) => (
                  <ProductMeterRow
                    key={m.id}
                    meter={m}
                    plantId={plantId}
                    latest={latestByMeter[m.id] ?? null}
                    avgVol={avgByMeter[m.id] ?? null}
                    userId={user?.id ?? null}
                    canEdit={canEdit}
                    onSaved={invalidate}
                  />
                )}
              />
            ) : (
              <div className="px-4 py-6 text-xs text-muted-foreground text-center">
                No product meters configured for this plant.{' '}
                {canEdit && <span className="text-foreground/70 font-medium">Go to the plant detail page to add product meters.</span>}
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
                if (r.reading_datetime && isNaN(Date.parse(normalizeDatetime(r.reading_datetime))))
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
                  nameToId[m.name.trim().toLowerCase()] = m.id;
                });
                let count = 0;
                const errors: string[] = [];
                for (const r of rows) {
                  const meterId = nameToId[r.meter_name?.trim().toLowerCase()];
                  if (!meterId) { errors.push(`Meter not found: "${r.meter_name}"`); continue; }
                  const dt = r.reading_datetime ? new Date(normalizeDatetime(r.reading_datetime)).toISOString() : new Date().toISOString();
                  const dtMin = dt.slice(0, 16);

                  // Duplicate check
                  const { data: existing } = await supabase.from('product_meter_readings' as any)
                    .select('id').eq('meter_id', meterId)
                    .gte('reading_datetime', `${dtMin}:00`)
                    .lte('reading_datetime', `${dtMin}:59`).limit(1);

                  if (existing && existing.length > 0) {
                    const decision = await resolveImportDuplicate(`${meterId}|${dtMin}`, `${r.meter_name} @ ${dtMin}`);
                    if (decision === 'skip') continue;
                    const csvCur = +r.current_reading;
                    const csvPrev = r.previous_reading ? +r.previous_reading : null;
                    const rawOvwDelta = csvPrev != null ? csvCur - csvPrev : null;
                    if (rawOvwDelta != null && rawOvwDelta < 0)
                      errors.push(`Meter "${r.meter_name}" @ ${dtMin}: negative delta (${rawOvwDelta.toFixed(2)}) — meter rollback detected. daily_volume stored as 0.`);
                    const csvDailyVol = rawOvwDelta != null ? Math.max(0, rawOvwDelta) : null;
                    const { error } = await supabase.from('product_meter_readings' as any).update({
                      current_reading: csvCur,
                      previous_reading: csvPrev,
                      reading_datetime: dt,
                      recorded_by: user?.id ?? null,
                      daily_volume: csvDailyVol,   // Bug fix: persist computed delta
                    } as any).eq('id', (existing as any[])[0].id);
                    if (error) errors.push(error.message); else count++;
                    continue;
                  }

                  const csvCur2 = +r.current_reading;
                  const csvPrev2 = r.previous_reading ? +r.previous_reading : null;
                  // Fix #11 — negative delta was silently clamped to 0 with no user feedback.
                  // Now we still clamp (a negative daily_volume would corrupt Dashboard sums)
                  // but emit a warning so the user knows a rollback row was detected.
                  const rawDelta2 = csvPrev2 != null ? csvCur2 - csvPrev2 : null;
                  if (rawDelta2 != null && rawDelta2 < 0) {
                    errors.push(`Row for "${r.meter_name}" @ ${dt.slice(0, 10)}: negative delta (${rawDelta2.toFixed(2)}) — likely a meter rollback. daily_volume stored as 0; mark it as a meter replacement if needed.`);
                  }
                  const csvDailyVol2 = rawDelta2 != null ? Math.max(0, rawDelta2) : null;
                  const { error } = await supabase.from('product_meter_readings' as any).insert({
                    meter_id: meterId,
                    plant_id: pid,
                    current_reading: csvCur2,
                    previous_reading: csvPrev2,
                    reading_datetime: dt,
                    recorded_by: user?.id ?? null,
                    daily_volume: csvDailyVol2,   // Bug fix: always persist computed delta
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
    let { error } = await supabase.from('product_meters' as any).insert({
      plant_id: plantId, name: name.trim(), status: 'Active', sort_order: 0,
    } as any);
    if (error?.message?.includes('status')) {
      ({ error } = await supabase.from('product_meters' as any).insert({
        plant_id: plantId, name: name.trim(), sort_order: 0,
      } as any));
    }
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
  meter, plantId, latest, avgVol, userId, canEdit, onSaved,
}: {
  meter: any;
  plantId: string;
  latest: any | null;
  avgVol?: number | null;
  userId: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const [reading, setReading] = useState('');
  const lastPrefilledProduct = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [customDt, setCustomDt] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));

  const previous = latest?.current_reading ?? null;
  const cur = +reading || 0;
  const productionVolume = previous != null && reading ? cur - previous : null;
  const highVol = avgVol != null && productionVolume != null && productionVolume > avgVol * ALERTS.avg_multiplier_warn;

  // Pre-fill the drum with the latest previous reading so the operator
  // starts from the real odometer value and only rolls the changed digits.
  // Race-condition fix: same as LocatorRow / WellRow.
  useEffect(() => {
    if (previous == null) return;
    const expected = previous.toFixed(2);
    if (reading === '' || reading === lastPrefilledProduct.current) {
      setReading(expected);
      lastPrefilledProduct.current = expected;
    }
  }, [previous, reading]);

  const save = async () => {
    if (!reading) { toast.error(`${meter.name}: enter a reading`); return; }
    setSaving(true);
    const dt = new Date(customDt).toISOString();
    // Bug fix: persist daily_volume so Dashboard/TrendChart can sum it directly,
    // mirroring the same fix already applied to locator_readings and well_readings.
    const dailyVol = previous != null ? Math.max(0, cur - previous) : null;
    const { error } = await supabase.from('product_meter_readings' as any).insert({
      meter_id: meter.id,
      plant_id: plantId,
      current_reading: cur,
      previous_reading: previous,
      reading_datetime: dt,
      recorded_by: userId,
      daily_volume: dailyVol,   // Bug fix: always persist computed delta for Dashboard aggregation
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


  return (
    <div className="p-3 space-y-2" data-testid={`product-meter-row-${meter.id}`}>
      {/* Row 1: Name | compact date picker on right */}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1.5 min-w-0 flex-1">
            <Gauge className="h-3.5 w-3.5 text-teal-600 shrink-0" />
            <span className="truncate">{meter.name}</span>
          </div>
          <label className="shrink-0 cursor-pointer relative">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 font-mono-num whitespace-nowrap hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {customDt ? new Date(customDt).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
            <Input type="datetime-local" value={customDt}
              onChange={e => setCustomDt(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              title="Reading date & time" />
          </label>
        </div>
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

      {/* Row 2: reading input + save + history */}
      {isMobile ? (
        <div className="space-y-2">
          <OdometerRollerInput
            value={reading}
            onChange={setReading}
            alertState="neutral"
            disabled={saving}
            testId={`product-meter-input-${meter.id}`}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={save} disabled={saving || !reading}
              className="flex-1 h-11 text-sm bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white shadow-sm"
              data-testid={`product-meter-save-${meter.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
            {canEdit && (
              <Button variant="ghost" size="sm" className="h-11 w-11 p-0 rounded-lg text-muted-foreground shrink-0"
                onClick={() => setShowHistory(true)} title="View history">
                <History className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-0">
            <Gauge className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-600 pointer-events-none" />
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              placeholder="Product Reading"
              className="h-9 pl-7 w-full border-teal-300 focus-visible:ring-teal-300 bg-teal-50/40 dark:bg-teal-950/20"
              data-testid={`product-meter-input-${meter.id}`}
            />
          </div>
          <Button
            onClick={save}
            disabled={saving || !reading}
            size="sm"
            className="h-9 px-3 text-xs shrink-0"
            data-testid={`product-meter-save-${meter.id}`}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          {canEdit && (
            <Button
              variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-full text-muted-foreground shrink-0"
              onClick={() => setShowHistory(true)} title="View history"
            >
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Warning banner — mirrors locator / well / blending style */}
      {productionVolume != null && (productionVolume < 0 || highVol) && (
        <div className="flex flex-col gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-lg">
          <span className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Verify before saving
          </span>
          {productionVolume < 0 && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Reading is below the previous value — possible meter rollback or data entry error.
            </span>
          )}
          {highVol && (
            <span className="text-amber-700 dark:text-amber-400 pl-5">
              Production volume is more than {Math.round(ALERTS.avg_multiplier_warn * 100 - 100)}% above the 10-day average — unusually high.
            </span>
          )}
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
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<{ id: string; datetime: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const WINDOWS = [{ label: '7D', days: 7 }, { label: '14D', days: 14 }, { label: '30D', days: 30 }, { label: '60D', days: 60 }] as const;

  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const queryKey = ['product-meter-history', meter.id, days, appliedFrom, appliedTo];

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      let sinceIso: string;
      let untilIso: string;
      if (days === 'custom') {
        sinceIso = localMidnight(appliedFrom).toISOString();
        const end = localMidnight(appliedTo);
        end.setHours(23, 59, 59, 999);
        untilIso = end.toISOString();
      } else {
        const since = new Date();
        since.setDate(since.getDate() - days);
        sinceIso = since.toISOString();
        untilIso = new Date().toISOString();
      }
      const { data } = await supabase
        .from('product_meter_readings' as any)
        .select('id, current_reading, previous_reading, reading_datetime')
        .eq('meter_id', meter.id)
        .gte('reading_datetime', sinceIso)
        .lte('reading_datetime', untilIso)
        .order('reading_datetime', { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    // Recalculate daily_volume for product_meter_readings.
    // NOTE: daily_volume is a GENERATED ALWAYS AS column — omit from UPDATE payload.
    const existingRow = rows?.find((r: any) => r.id === editRow.id);
    const newCur = +editRow.value;
    const { error } = await supabase.from('product_meter_readings' as any).update({
      current_reading: newCur,
      reading_datetime: new Date(editRow.datetime).toISOString(),
      // daily_volume intentionally omitted — GENERATED ALWAYS AS column;
      // updating it causes "column can only be updated to DEFAULT". DB recomputes it.
    } as any).eq('id', editRow.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Reading updated');
    setEditRow(null);
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries();
  };

  // Fix #8 — window.confirm is blocked in iframes. Use a two-click inline confirm
  // (first click sets pendingDeleteId, second click executes the delete).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const deleteRow = async (id: string) => {
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    setPendingDeleteId(null);
    setDeletingId(id);
    const { error } = await supabase.from('product_meter_readings' as any).delete().eq('id', id);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Reading deleted');
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-teal-600" /> {meter.name} — History
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {WINDOWS.map(({ label, days: d }) => (
              <button key={label} onClick={() => { setDays(d as any); setEditRow(null); }}
                className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}>{label}</button>
            ))}
            <button onClick={() => { setDays('custom'); setEditRow(null); }}
              className={['px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}>Custom</button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={customTo} min={customFrom} max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <Button size="sm" className="h-7 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setEditRow(null); }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {editRow && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-medium">Editing reading</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">Reading</Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value}
                className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditRow(null)} disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
            </div>
          </div>
        )}

        <div className="overflow-auto max-h-[520px] rounded border text-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !rows?.length ? (
            <p className="p-4 text-center text-muted-foreground">
              {days === 'custom'
                ? `No readings from ${appliedFrom} → ${appliedTo}`
                : `No readings in the last ${days} days`}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  <th className="px-3 py-2 font-medium text-right">Reading</th>
                  <th className="px-3 py-2 font-medium text-right">Production (m³)</th>
                  <th className="px-2 py-2 font-medium text-center w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const vol = r.previous_reading != null ? r.current_reading - r.previous_reading : null;
                  const isEditing = editRow?.id === r.id;
                  const isDeleting = deletingId === r.id;
                  return (
                    <tr key={r.id ?? i} className={['border-t', isEditing ? 'bg-teal-50/60 dark:bg-teal-950/20' : 'hover:bg-muted/40'].join(' ')}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm') : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                      <td className="px-3 py-1.5 text-right font-mono-num text-teal-600">
                        {vol != null ? fmtNum(vol) : '—'}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <button title="Edit" disabled={!!editRow || isDeleting}
                            onClick={() => { setPendingDeleteId(null); setEditRow({ id: r.id, datetime: format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"), value: String(r.current_reading) }); }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                            <Pencil className="h-3 w-3" />
                          </button>
                          {pendingDeleteId === r.id ? (
                            <>
                              <button title="Confirm delete" onClick={() => deleteRow(r.id)}
                                className="p-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-semibold leading-none px-1.5">
                                Yes
                              </button>
                              <button title="Cancel" onClick={() => setPendingDeleteId(null)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground text-[10px] leading-none px-1.5">
                                No
                              </button>
                            </>
                          ) : (
                            <button title="Delete" disabled={!!editRow || isDeleting}
                              onClick={() => deleteRow(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {days === 'custom' ? `Showing ${appliedFrom} → ${appliedTo}` : `Showing up to ${days} days`} · {rows?.length ?? 0} records
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ─── MeterNameList ────────────────────────────────────────────────────────────
// Per-meter name chips with inline edit + delete (with confirmation).
// Manager/Admin only — rendered conditionally by the caller.

function MeterNameList({
  count, names, accentColor, defaultPrefix, onSave, onRemoveLast,
}: {
  count: number;
  names: string[];
  accentColor: 'yellow' | 'blue';
  defaultPrefix: string;
  onSave: (names: string[]) => void;
  onRemoveLast: () => void;
}) {
  const isYellow = accentColor === 'yellow';
  const ring   = isYellow ? 'focus-visible:ring-yellow-400' : 'focus-visible:ring-blue-400';
  const border = isYellow ? 'border-yellow-300' : 'border-blue-300';
  const chip   = isYellow
    ? 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/20 dark:border-yellow-800 dark:text-yellow-300'
    : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-300';

  // editingIdx: which chip is in edit mode (-1 = none)
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [editVal, setEditVal]       = useState('');
  // confirmDeleteIdx: which chip is showing delete confirmation
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number>(-1);

  const startEdit = (i: number) => {
    setConfirmDeleteIdx(-1);
    setEditingIdx(i);
    setEditVal(names[i] ?? `${defaultPrefix} ${i + 1}`);
  };

  const commitEdit = () => {
    if (editingIdx < 0) return;
    const trimmed = editVal.trim() || `${defaultPrefix} ${editingIdx + 1}`;
    const next = [...names];
    next[editingIdx] = trimmed;
    onSave(next);
    setEditingIdx(-1);
  };

  const cancelEdit = () => { setEditingIdx(-1); };

  const askDelete = (i: number) => {
    setEditingIdx(-1);
    setConfirmDeleteIdx(i);
  };

  const confirmDelete = (i: number) => {
    // Remove this entry by shifting names down; decrement count via onRemoveLast
    const next = [...names];
    next.splice(i, 1);
    onSave(next);
    onRemoveLast();
    setConfirmDeleteIdx(-1);
  };

  const cancelDelete = () => setConfirmDeleteIdx(-1);

  return (
    <div className="flex gap-1 flex-wrap mt-0.5">
      {Array.from({ length: count }).map((_, i) => {
        const name = names[i] ?? `${defaultPrefix} ${i + 1}`;
        const isEditing  = editingIdx === i;
        const isDeleting = confirmDeleteIdx === i;

        if (isEditing) {
          return (
            <div key={i} className={`flex items-center gap-0.5 rounded border ${border} bg-background px-1 py-0.5`}>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                className={`h-5 w-20 text-[11px] bg-transparent focus:outline-none focus-visible:ring-1 ${ring} rounded px-0.5`}
              />
              <button
                onClick={commitEdit}
                className="text-[9px] font-semibold text-emerald-700 hover:text-emerald-900 px-0.5 leading-none"
                title="Save name"
              >✓</button>
              <button
                onClick={cancelEdit}
                className="text-[9px] text-muted-foreground hover:text-foreground px-0.5 leading-none"
                title="Cancel"
              >✕</button>
            </div>
          );
        }

        if (isDeleting) {
          return (
            <div key={i} className="flex items-center gap-0.5 rounded border border-destructive/40 bg-destructive/5 px-1.5 py-0.5">
              <span className="text-[10px] text-destructive font-medium">Delete "{name}"?</span>
              <button
                onClick={() => confirmDelete(i)}
                className="text-[9px] font-bold text-destructive hover:text-destructive/80 ml-1 px-0.5"
                title="Confirm delete"
              >Yes</button>
              <button
                onClick={cancelDelete}
                className="text-[9px] text-muted-foreground hover:text-foreground px-0.5"
                title="Cancel"
              >No</button>
            </div>
          );
        }

        return (
          <div key={i} className={`flex items-center gap-0.5 rounded border ${chip} px-1.5 py-0.5 text-[11px]`}>
            <span className="leading-none">{name}</span>
            <button
              onClick={() => startEdit(i)}
              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
              title={`Rename "${name}"`}
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={() => askDelete(i)}
              className="opacity-60 hover:opacity-100 hover:text-destructive transition-opacity"
              title={`Remove "${name}"`}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── POWER ───────────────────────────────────────────────────────────────────

function PowerForm() {
  const qc = useQueryClient();
  const { user, isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: plants } = usePlants();
  const [plantId, setPlantId]         = useState('');
  // When showSolar: `reading` = grid meter reading, `solarReading` = solar meter reading
  // When !showSolar: `reading` = combined meter reading
  const [reading, setReading]         = useState('');
  const [solarReading, setSolarReading] = useState('');
  const [dt, setDt]                   = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [powerHistoryOpen, setPowerHistoryOpen] = useState<{ type: 'solar'; idx: number } | { type: 'grid'; idx: number } | null>(null);
  const [importOpen, setImportOpen]   = useState(false);
  // Multiplier: auto-populated from latest saved electric bill; editable by admin only when no bill exists
  const [multiplierInput, setMultiplierInput] = useState('');
  // Per-meter reading inputs: indexed arrays (index 0 = meter 1, etc.)
  const [gridMeterReadings, setGridMeterReadings]   = useState<string[]>(['', '', '', '', '']);
  const [solarMeterReadings, setSolarMeterReadings] = useState<string[]>(['', '', '', '', '']);

  const setGridMeterReading = (idx: number, val: string) =>
    setGridMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });
  const setSolarMeterReading = (idx: number, val: string) =>
    setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = val; return next; });
  // 'raw'    = user enters cumulative kWh meter reading; Δ auto-computed from prev
  // 'direct' = user enters daily kWh directly; stored straight as daily_solar_kwh
  const [solarInputMode, setSolarInputMode] = useState<'raw' | 'direct'>('raw');
  const isMobile = useIsMobile();

  const plant     = useMemo(() => plants?.find((p) => p.id === plantId), [plants, plantId]);
  const showSolar = !!plant?.has_solar;
  const showGrid  = plant?.has_grid !== false;

  // Load meter config from plant_power_config (set in Plant → Power tab)
  const { data: powerConfig, isLoading: configLoading } = useQuery({
    queryKey: ['plant-power-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_power_config' as any) as any)
          .select('solar_meter_count, solar_meter_names, grid_meter_count, grid_meter_names, grid_meter_multipliers')
          .eq('plant_id', plantId).maybeSingle();
        if (!error && data) return data as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`power_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  // Load plant meter config to get default_solar_input_mode (set in Plants → Energy Sources)
  const { data: meterConfig } = useQuery({
    queryKey: ['plant-meter-config', plantId],
    queryFn: async () => {
      if (!plantId) return null;
      try {
        const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config').eq('plant_id', plantId).maybeSingle();
        if (!error && data?.config) return data.config as any;
      } catch { /* table may not exist */ }
      try {
        const raw = localStorage.getItem(`plant_meter_config_${plantId}`);
        if (raw) return JSON.parse(raw);
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!plantId,
  });

  // When plant changes, sync solarInputMode to the plant's configured default
  useEffect(() => {
    const mode = meterConfig?.default_solar_input_mode;
    if (mode === 'direct' || mode === 'raw') setSolarInputMode(mode);
    else setSolarInputMode('raw');
  }, [plantId, meterConfig?.default_solar_input_mode]);

  const solarMeterCount = (powerConfig?.solar_meter_count as number) ?? 1;
  const gridMeterCount  = (powerConfig?.grid_meter_count  as number) ?? 1;
  const solarMeterNames: string[] = powerConfig?.solar_meter_names ?? [];
  const gridMeterNames:  string[] = powerConfig?.grid_meter_names  ?? [];

  const getSolarLabel = (idx: number) => solarMeterNames[idx] ?? (solarMeterCount === 1 ? 'Solar Power Reading' : `Solar Meter ${idx + 1}`);
  const getGridLabel  = (idx: number) => gridMeterNames[idx]  ?? (gridMeterCount  === 1 ? 'Grid Power Reading'  : `Grid Meter ${idx + 1}`);

  // Flat list of all meters for MobileCarousel: grid first, then solar
  const powerMeterItems = useMemo<Array<{ type: 'grid' | 'solar'; idx: number }>>(() => {
    const items: Array<{ type: 'grid' | 'solar'; idx: number }> = [];
    for (let i = 0; i < gridMeterCount; i++) items.push({ type: 'grid', idx: i });
    if (showSolar) for (let i = 0; i < solarMeterCount; i++) items.push({ type: 'solar', idx: i });
    return items;
  }, [gridMeterCount, solarMeterCount, showSolar]);

  // Derive CT multiplier from plant_power_config (Plants → Power tab).
  // This is the single source of truth — billing multiplier is for cost accounting only.
  const configMultiplierArr = powerConfig?.grid_meter_multipliers;

  // Per-meter helper: returns the configured multiplier for a given grid meter index,
  // falling back to 1 when the array is absent or the entry is missing/zero.
  const getGridMeterMult = (idx: number): number =>
    Array.isArray(configMultiplierArr) && +configMultiplierArr[idx] > 0
      ? +configMultiplierArr[idx]
      : 1;

  // configMultiplier (meter-0) kept for backward-compat with save helpers and
  // legacy single-meter paths that still reference effectiveMultiplier.
  const configMultiplier: number | null =
    Array.isArray(configMultiplierArr) && configMultiplierArr.length > 0 && +configMultiplierArr[0] > 0
      ? +configMultiplierArr[0]
      : null;
  // canEditMultiplier: Managers, Data Analysts and Admins can update CT multiplier in config
  const canEditMultiplier = (isAdmin || isManager || isDataAnalyst) && !!plantId && !configLoading;
  // Effective multiplier (meter-0): config value takes priority, else user's local input, else 1.
  // Used as fallback for single-meter plants and legacy display paths.
  const effectiveMultiplier = configMultiplier ?? (+multiplierInput || 1);

  // Save multiplier edit back to plant_power_config so all pages stay in sync
  const saveMultiplierToConfig = async (val: number) => {
    if (!plantId || !(isAdmin || isManager || isDataAnalyst)) return;
    try {
      const existingArr = Array.isArray(configMultiplierArr) ? [...configMultiplierArr] : [];
      existingArr[0] = val;
      await (supabase.from('plant_power_config' as any) as any)
        .upsert(
          { plant_id: plantId, grid_meter_multipliers: existingArr, updated_at: new Date().toISOString() },
          { onConflict: 'plant_id' }
        );
      qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
    } catch { /* non-critical */ }
  };

  // Auto-reset manual input when plant changes.
  // useCallback gives a stable reference so PlantSelector's useEffect does NOT
  // re-fire on every render. An inline arrow here would be a new reference each
  // render → picker calls onChange(selectedPlantId) every cycle → error #300.
  const handlePlantChange = useCallback((v: string) => {
    setPlantId(v);
    setEditingId(null);
    setMultiplierInput('');
    // Clear all meter inputs — the pre-fill useEffects will re-populate from
    // the new plant's prevRow once the history query settles.
    setReading('');
    setSolarReading('');
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
  }, []);

  const { data: history } = useQuery({
    queryKey: ['op-power', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      // First try with all optional columns
      const { data, error } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,grid_meter_readings,daily_consumption_kwh,daily_solar_kwh,daily_grid_kwh,solar_meter_reading,is_meter_replacement,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!error && data) return data;
      // Optional columns not yet in DB — retry with base columns only
      const { data: fallback, error: fallbackErr } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh,daily_consumption_kwh,is_meter_replacement,recorded_by')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      if (!fallbackErr && fallback) return fallback;
      // Last resort: absolute minimum columns
      const { data: minimal } = await supabase
        .from('power_readings')
        .select('id,plant_id,reading_datetime,meter_reading_kwh')
        .eq('plant_id', plantId)
        .order('reading_datetime', { ascending: false })
        .limit(8);
      return minimal ?? [];
    },
    enabled: !!plantId,
    staleTime: 0,
  });

  // The most recent prior reading (skip the one being edited)
  const prevRow    = history?.find((r: any) => r.id !== editingId) ?? null;
  // Combined/grid meter: previous meter_reading_kwh
  const prevGrid   = prevRow?.meter_reading_kwh ?? null;
  // Solar meter: previous solar_meter_reading (if tracked)
  const prevSolar  = prevRow?.solar_meter_reading ?? null;

  // ── Pre-fill grid meter inputs from the most recent previous reading ──────
  // Fires when prevRow identity changes (new row became "latest" after a save
  // or plant change). Uses prevRow?.id as dep to avoid infinite loops — the
  // effect only re-runs when the actual record changes, not on every render.
  useEffect(() => {
    if (!prevRow) return;
    const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
    setGridMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val; // user has already typed something — don't overwrite
        const prevVal = gmrPrev?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
        return prevVal != null ? prevVal.toFixed(2) : val;
      }),
    );
    // Keep the meter-0 alias in sync
    setReading(r => {
      if (r !== '') return r;
      return prevGrid != null ? prevGrid.toFixed(2) : r;
    });
  }, [prevRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-fill solar meter inputs (raw mode only) ────────────────────────────
  useEffect(() => {
    if (!prevRow || solarInputMode !== 'raw') return;
    setSolarMeterReadings(curr =>
      curr.map((val, idx) => {
        if (val !== '') return val;
        if (idx === 0 && prevSolar != null) return prevSolar.toFixed(2);
        return val;
      }),
    );
    setSolarReading(r => {
      if (r !== '') return r;
      return prevSolar != null ? prevSolar.toFixed(2) : r;
    });
  }, [prevRow?.id, solarInputMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delta calculations from meter readings
  const deltaGrid  = prevGrid != null && reading       ? +reading       - prevGrid  : null;
  // Raw mode: delta = current - prev cumulative reading
  // Direct mode: the entered value IS the daily kWh — no subtraction, no prevSolar needed
  const deltaSolar = solarInputMode === 'direct'
    ? (solarReading ? +solarReading : null)
    : (prevSolar != null && solarReading ? +solarReading  - prevSolar : null);
  // For combined (no solar): just use the main meter delta
  const daily      = showSolar ? deltaGrid : (prevGrid != null && reading ? +reading - prevGrid : null);
  // Effective daily kWh = Δ reading × multiplier
  const dailyEffective = daily != null ? daily * effectiveMultiplier : null;

  // Per-meter saving state
  const [savingMeter, setSavingMeter] = useState<string | null>(null);

  // Save a single meter reading independently
  const submitMeter = async (kind: 'solar' | 'grid', idx: number) => {
    if (!plantId) return;
    // Guard: block grid saves when the CT-multiplier config is unavailable.
    //
    // Two failure modes are handled here:
    //   1. configLoading === true  → query is still in-flight; effectiveMultiplier
    //      would use the local-input fallback (or 1) instead of the DB value.
    //   2. configLoading === false but configMultiplierArr is null / empty → the
    //      query settled without a usable multiplier (no plant_power_config row, or
    //      grid_meter_multipliers is null/[]). effectiveMultiplier falls back to
    //      (+multiplierInput || 1) which stores the raw delta instead of (delta × CT).
    //
    // Previously only case 1 was caught, so readings saved when the config had no
    // row would silently store the raw meter delta as daily_grid_kwh, causing the
    // Dashboard chart to display the unscaled value (e.g. 11 kWh) while the history
    // table (which recomputes rawDelta × configMult on-the-fly) showed the correct
    // scaled value (e.g. 12,720 kWh). Now both cases are blocked explicitly.
    if (kind === 'grid') {
      if (configLoading) {
        toast.error('Meter config still loading — please wait a moment before saving.');
        return;
      }
      if (!Array.isArray(configMultiplierArr) || configMultiplierArr.length === 0) {
        toast.error(
          'CT multiplier not configured for this plant. ' +
          'Set it under Plants → Power → CT Multiplier before saving grid readings, ' +
          'or enter it manually in the multiplier field above.',
        );
        return;
      }
    }
    const meterKey = `${kind}-${idx}`;
    const val = kind === 'solar' ? (solarMeterReadings[idx] ?? '') : (gridMeterReadings[idx] ?? '');
    if (!val) { toast.error(`Enter a reading for ${kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx)}`); return; }

    setSavingMeter(meterKey);

    // FIX (multi-meter collision): use a local `rowId` so we can resolve an existing
    // today-row and immediately proceed to save — no second click required.
    // The old pattern (setEditingId + early return) meant meter-2 would switch to
    // edit mode on click-1 and then OVERWRITE meter_reading_kwh on click-2, clobbering
    // whatever meter-1 had saved.  Now we fall through and merge into the existing row.
    let rowId: string | null = editingId;

    if (kind === 'grid' && !rowId) {
      const dup = await findExistingReading({
        table: 'power_readings', entityCol: 'plant_id', entityId: plantId,
        datetime: new Date(dt), windowKind: 'day',
      });
      if (dup) {
        rowId = dup;
        setEditingId(dup);
        // Don't return — fall through and patch only this meter's key in the existing row.
        toast.info(`Today's power reading found — saving ${getGridLabel(idx)} into existing row.`);
      }
    }

    // Compute deltas for the primary meter only.
    // BUG A FIX: removed the `showSolar &&` guard — computedDailyGrid must be
    // computed for grid-only plants too.  Previously it was always null when
    // showSolar === false, so the else-if partial path (below) never wrote
    // daily_grid_kwh and the Plants chart read the raw unscaled delta from
    // daily_consumption_kwh instead of the CT-multiplied effective kWh.
    const computedDailyGrid  = kind === 'grid'  && idx === 0 && deltaGrid  != null ? deltaGrid  * effectiveMultiplier : null;
    // In raw mode: delta is computed from prevSolar vs current solar meter reading
    // In direct mode: the user IS entering the delta — no prev needed, don't use deltaSolar
    const computedDailySolar = kind === 'solar' && idx === 0 && showSolar && solarInputMode === 'raw' && deltaSolar != null ? deltaSolar : null;

    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      recorded_by: user?.id,
    };

    if (kind === 'grid') {
      // ── JSONB merge: read the existing grid_meter_readings so we only patch this
      // meter's key, leaving all other meters' readings intact.
      let mergedGridReadings: Record<string, number> = { [String(idx)]: +val };
      if (rowId) {
        try {
          const { data: existingRow } = await supabase
            .from('power_readings')
            .select('grid_meter_readings')
            .eq('id', rowId)
            .maybeSingle();
          const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
          mergedGridReadings = { ...existing, [String(idx)]: +val };
        } catch { /* non-critical — proceed with single-key payload */ }
      }
      payload.grid_meter_readings = mergedGridReadings;

      // meter_reading_kwh: kept for backward compatibility with dashboards, CSV importer,
      // cost pages, and trend charts that still read this column.
      // Only update it for meter 0; secondary meters live only in grid_meter_readings.
      if (idx === 0) payload.meter_reading_kwh = +val;

      // Compute daily_grid_kwh as the sum of (Δ per meter × per-meter CT multiplier).
      // Previous per-meter readings come from prevRow.grid_meter_readings; for legacy
      // rows that pre-date this migration, fall back to meter_reading_kwh as meter-0.
      const prevMeters: Record<string, number> = (() => {
        const gmr = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
        if (gmr && Object.keys(gmr).length > 0) return gmr;
        return prevGrid != null ? { '0': prevGrid } : {};
      })();

      let totalDailyGrid = 0;
      let allMetersPresent = true;
      for (let mi = 0; mi < gridMeterCount; mi++) {
        const curr = mergedGridReadings[String(mi)];
        const prev = prevMeters[String(mi)];
        if (curr != null && prev != null) {
          const mMult = Array.isArray(configMultiplierArr) && +configMultiplierArr[mi] > 0
            ? +configMultiplierArr[mi]
            : effectiveMultiplier;
          totalDailyGrid += (curr - prev) * mMult;
        } else {
          allMetersPresent = false;
        }
      }
      if (allMetersPresent) {
        payload.daily_grid_kwh       = totalDailyGrid;
        payload.daily_consumption_kwh = totalDailyGrid;
      } else if (idx === 0 && deltaGrid != null) {
        // Partial data: only meter-0 is available — write a partial estimate so the
        // dashboard doesn't show an empty bar until all meters are saved.
        // BUG B FIX: always set daily_grid_kwh here, not just when computedDailyGrid
        // is non-null.  With Bug A fixed, computedDailyGrid is now always non-null
        // when deltaGrid != null, so this path now correctly writes the CT-scaled
        // value for both solar+grid AND grid-only plants.
        const partialKwh = computedDailyGrid ?? deltaGrid * effectiveMultiplier;
        payload.daily_grid_kwh        = partialKwh;
        payload.daily_consumption_kwh = partialKwh;
      }
    }
    if (kind === 'solar') {
      // Only include meter_reading_kwh from grid if the user has actually entered one —
      // writing 0 would corrupt the cumulative grid meter sequence.
      const gridVal = gridMeterReadings[0];
      if (gridVal && +gridVal > 0) payload.meter_reading_kwh = +gridVal;
      if (solarInputMode === 'direct') {
        // Direct daily kWh: store only daily_solar_kwh, do NOT touch solar_meter_reading
        // (writing a raw meter value would corrupt the cumulative sequence)
        payload.daily_solar_kwh = +val;
      } else {
        // Raw cumulative meter: store solar_meter_reading and auto-compute daily_solar_kwh
        payload.solar_meter_reading = +val;
        // Only attach daily_solar_kwh when delta is actually computable (prev exists)
        if (idx === 0 && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
      }
    }

    const runQuery = () => rowId
      ? supabase.from('power_readings').update(payload).eq('id', rowId)
      : supabase.from('power_readings').insert(payload);

    let { error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier') ||
      error.message.includes('grid_meter_readings')
    )) {
      // Column may not exist yet in older DBs — retry without optional columns
      delete payload.daily_solar_kwh;
      delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading;
      delete payload.multiplier;
      delete payload.grid_meter_readings;
      ({ error } = await runQuery());
    }

    setSavingMeter(null);
    if (error) { toast.error(error.message); return; }

    const label = kind === 'solar' ? getSolarLabel(idx) : getGridLabel(idx);
    toast.success(`${label}: reading saved`);

    // Clear only the saved meter's input
    if (kind === 'grid') {
      setGridMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setReading('');
    } else {
      setSolarMeterReadings(prev => { const next = [...prev]; next[idx] = ''; return next; });
      if (idx === 0) setSolarReading('');
    }
    qc.invalidateQueries();
  };

  // Keep legacy submit for cancel/edit flows
  const submit = async () => {
    if (!plantId || !reading) return;
    // Guard: same race-condition protection as submitMeter
    if (configLoading) {
      toast.error('Meter config still loading — please wait a moment before saving.');
      return;
    }
    // BUG A (legacy submit): same fix as submitMeter — remove showSolar guard so
    // grid-only plants correctly persist the CT-scaled daily_grid_kwh.
    const computedDailyGrid  = deltaGrid  != null ? deltaGrid * effectiveMultiplier : null;
    const computedDailySolar = showSolar && deltaSolar != null ? deltaSolar : null;
    const payload: any = {
      plant_id: plantId,
      reading_datetime: new Date(dt).toISOString(),
      meter_reading_kwh: +reading,
      // Keep grid_meter_readings in sync so history delta calculations stay correct.
      // For edit flows we fetch existing secondary-meter data and merge, to avoid
      // clobbering meters 1+ that were saved via the per-meter Save buttons.
      recorded_by: user?.id,
    };
    // Merge grid_meter_readings: preserve secondary meters if editing an existing row.
    if (editingId) {
      try {
        const { data: existingRow } = await supabase
          .from('power_readings')
          .select('grid_meter_readings')
          .eq('id', editingId)
          .maybeSingle();
        const existing = (existingRow?.grid_meter_readings as Record<string, number> | null) ?? {};
        payload.grid_meter_readings = { ...existing, '0': +reading };
      } catch {
        payload.grid_meter_readings = { '0': +reading };
      }
    } else {
      payload.grid_meter_readings = { '0': +reading };
    }
    if (showSolar && solarReading) payload.solar_meter_reading = +solarReading;
    // Write daily_grid_kwh for ALL plants (not just solar+grid) — fixes Plants chart
    // discrepancy where grid-only readings showed raw delta instead of CT-scaled kWh.
    if (computedDailyGrid  != null) payload.daily_grid_kwh  = computedDailyGrid;
    if (showSolar && computedDailySolar != null) payload.daily_solar_kwh = computedDailySolar;
    // Bug 3 fix: always write daily_consumption_kwh so Dashboard kWh total and PV ratio are correct
    if (daily != null) payload.daily_consumption_kwh = daily * effectiveMultiplier;
    const runQuery = () => editingId
      ? supabase.from('power_readings').update(payload).eq('id', editingId)
      : supabase.from('power_readings').insert(payload);
    let { error } = await runQuery();
    if (error && (
      error.message.includes('daily_solar_kwh') ||
      error.message.includes('daily_grid_kwh') ||
      error.message.includes('solar_meter_reading') ||
      error.message.includes('multiplier')
    )) {
      delete payload.daily_solar_kwh; delete payload.daily_grid_kwh;
      delete payload.solar_meter_reading; delete payload.multiplier;
      ({ error } = await runQuery());
    }
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Updated' : 'Power reading saved');
    setReading(''); setSolarReading(''); setEditingId(null);
    setGridMeterReadings(['', '', '', '', '']);
    setSolarMeterReadings(['', '', '', '', '']);
    qc.invalidateQueries();
  };

  const startEdit = (r: any) => {
    setReading(String(r.meter_reading_kwh));
    setSolarReading(r.solar_meter_reading != null ? String(r.solar_meter_reading) : '');
    // Restore per-meter grid readings from grid_meter_readings JSONB.
    // Falls back to meter_reading_kwh for legacy rows that pre-date the migration.
    const gmr = (r.grid_meter_readings as Record<string, number> | null) ?? {};
    setGridMeterReadings(prev => {
      const next = prev.map(() => '');
      next[0] = gmr['0'] != null ? String(gmr['0']) : String(r.meter_reading_kwh);
      for (let i = 1; i < prev.length; i++) {
        if (gmr[String(i)] != null) next[i] = String(gmr[String(i)]);
      }
      return next;
    });
    setSolarMeterReadings(prev => { const next = [...prev]; next[0] = r.solar_meter_reading != null ? String(r.solar_meter_reading) : ''; return next; });
    setDt(format(new Date(r.reading_datetime), "yyyy-MM-dd'T'HH:mm"));
    setEditingId(r.id);
    toast.info('Editing power reading');
  };

  // Build display rows: compute Δ on the fly by pairing consecutive readings
  const displayHistory = useMemo(() => {
    if (!history?.length) return [];
    return history.map((r: any, i: number) => {
      const pred          = history[i + 1] ?? null; // predecessor = row below (older), history is DESC
      // Grid meter Δ — for multi-meter plants, sum deltas across all meters using
      // grid_meter_readings JSONB.  Falls back to single meter_reading_kwh for legacy rows.
      const deltaKwh = (() => {
        const rGmr = r.grid_meter_readings    as Record<string, number> | null | undefined;
        const pGmr = pred?.grid_meter_readings as Record<string, number> | null | undefined;
        if (rGmr && pGmr && Object.keys(rGmr).length > 1) {
          let total = 0;
          for (const k of Object.keys(rGmr)) {
            if (pGmr[k] != null) total += rGmr[k] - pGmr[k];
          }
          return total;
        }
        return pred != null ? r.meter_reading_kwh - pred.meter_reading_kwh : (r.daily_consumption_kwh ?? null);
      })();
      // Solar meter Δ
      const deltaSolarKwh = (pred?.solar_meter_reading != null && r.solar_meter_reading != null)
        ? r.solar_meter_reading - pred.solar_meter_reading
        : (r.daily_solar_kwh ?? null);
      // Grid consumption = grid meter Δ × CT multiplier
      const deltaGridKwh  = showSolar && deltaKwh != null
        ? deltaKwh * effectiveMultiplier
        : (r.daily_grid_kwh != null ? r.daily_grid_kwh : deltaKwh);
      return { ...r, _deltaKwh: deltaKwh, _deltaSolar: deltaSolarKwh, _deltaGrid: deltaGridKwh };
    });
  }, [history, showSolar, effectiveMultiplier]);

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plant</Label>
            <PlantSelector value={plantId} onChange={handlePlantChange} />
          </div>
          {(isAdmin || isManager || isDataAnalyst) && plantId && (
            <Button
              size="sm" variant="outline"
              className="shrink-0 gap-1.5 h-10 border-teal-600/60 text-teal-700 hover:bg-teal-50 hover:border-teal-600 dark:hover:bg-teal-950/30"
              onClick={() => setImportOpen(true)}
              data-testid="import-power-readings-btn"
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          )}
        </div>

        {/* ── Meter config hint ── */}
        {plantId && (
          <p className="text-[11px] text-muted-foreground">
            Meter count &amp; names are configured in <strong className="text-foreground/70">Plants → Power</strong>.
          </p>
        )}

        {/* Meter Reading(s) + Grid Power Multiplier — shown inline with Date & Time */}
        {showSolar ? (
          // ── Solar plant ────────────────────────────────────────────────────────
          <div className="space-y-3">

            {/* Date & Time — CT multipliers are now shown per-meter inline with each grid meter label */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Date &amp; Time</Label>
                <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
                  className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" />
              </div>
            </div>

            {/* ── 2-column layout: Solar (left) | Grid (right) — desktop only ── */}
            {!isMobile && <div className="grid grid-cols-2 gap-4 items-start">

              {/* ── Solar column ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 pb-1 border-b border-yellow-200 dark:border-yellow-800/40">
                  <span className="text-yellow-500 text-sm leading-none">☀</span>
                  <span className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">Solar</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{solarMeterCount} meter{solarMeterCount !== 1 ? 's' : ''}</span>
                </div>
                {Array.from({ length: solarMeterCount }).map((_, idx) => {
                  const meterLabel = getSolarLabel(idx);
                  const val = solarMeterReadings[idx] ?? '';
                  const isFirst = idx === 0;
                  const handleChange = (v: string) => {
                    setSolarMeterReading(idx, v);
                    if (isFirst) setSolarReading(v);
                  };
                  const meterKey = `solar-${idx}`;
                  const isSavingThis = savingMeter === meterKey;
                  // In raw mode the pre-filled baseline equals prevSolar — disable Save until
                  // the operator has actually rolled/typed a different value.
                  const solarPrevVal = idx === 0 ? prevSolar : null;
                  const solarMeterChanged = val !== '' && (
                    solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal
                  );
                  return (
                    <div key={`solar-${idx}`}>
                      <Label className="flex items-center gap-1 text-xs">
                        <span className="text-yellow-400 text-[10px]">☀</span>
                        {meterLabel}
                        {isFirst && editingId && <span className="text-[10px] text-amber-600 ml-1">(editing)</span>}
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <button
                            type="button"
                            title={`View ${meterLabel} history`}
                            onClick={() => setPowerHistoryOpen({ type: 'solar', idx })}
                            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <History className="h-3 w-3" />
                          </button>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="any" value={val}
                          onChange={e => handleChange(e.target.value)}
                          placeholder={solarInputMode === 'direct' ? 'Daily kWh' : 'Solar reading'}
                          className="border-yellow-300 focus-visible:ring-yellow-300"
                          data-testid={`power-solar-input-${idx}`} />
                        <Button size="sm" disabled={isSavingThis || !solarMeterChanged}
                          onClick={() => submitMeter('solar', idx)}
                          className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                          data-testid={`power-solar-save-${idx}`}>
                          {isSavingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      {/* Input mode hint — shown below input to align with grid's prev reading */}
                      {isFirst && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Mode: <span className="font-medium text-yellow-600 dark:text-yellow-400">
                            {solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}
                          </span>
                          <span className="opacity-60 ml-1">(configure in Plants → Energy Sources)</span>
                        </p>
                      )}
                      {/* Hint line: raw mode shows prev + computed Δ; direct mode previews stored value */}
                      {isFirst && solarInputMode === 'raw' && prevSolar != null && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          prev: <span className="font-mono-num">{fmtNum(prevSolar)}</span>
                          {val && deltaSolar != null && (
                            <span className={`font-mono-num font-medium ml-1 ${deltaSolar >= 0 ? 'text-yellow-600' : 'text-destructive'}`}>
                              Δ {fmtNum(deltaSolar)} kWh
                            </span>
                          )}
                          {val && prevSolar != null && deltaSolar == null && (
                            <span className="ml-1 text-muted-foreground/60">(enter value to compute Δ)</span>
                          )}
                        </p>
                      )}
                      {isFirst && solarInputMode === 'raw' && prevSolar == null && val && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          No previous solar reading — Δ will be available after next entry.
                        </p>
                      )}
                      {isFirst && solarInputMode === 'direct' && val && (
                        <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-mono-num mt-0.5">
                          → {fmtNum(+val)} kWh will be saved as daily production
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Total Δ row — only meaningful in raw mode */}
                {solarInputMode === 'raw' && deltaSolar != null && solarMeterCount > 1 && (
                  <div className="rounded border border-yellow-200 bg-yellow-50/60 dark:border-yellow-800/30 dark:bg-yellow-950/10 px-2 py-1 text-[11px] flex items-center gap-1.5 mt-1">
                    <span className="text-yellow-500">☀</span>
                    <span className="text-muted-foreground">Total Δ</span>
                    <span className={`font-mono-num font-semibold ml-auto ${deltaSolar >= 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-destructive'}`}>
                      {fmtNum(deltaSolar)} kWh
                    </span>
                  </div>
                )}
              </div>

              {/* ── Grid column ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 pb-1 border-b border-blue-200 dark:border-blue-800/40">
                  <GridPylonIcon className="h-3 w-3 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Grid</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{gridMeterCount} meter{gridMeterCount !== 1 ? 's' : ''}</span>
                </div>
                {Array.from({ length: gridMeterCount }).map((_, idx) => {
                  const meterLabel = getGridLabel(idx);
                  const val = gridMeterReadings[idx] ?? '';
                  const isFirst = idx === 0;
                  const handleChange = (v: string) => {
                    setGridMeterReading(idx, v);
                    if (isFirst) setReading(v);
                  };
                  const meterKey = `grid-${idx}`;
                  const isSavingThis = savingMeter === meterKey;
                  const mMult = getGridMeterMult(idx);
                  // Pre-fill baseline guard — disable Save when value hasn't changed from previous
                  const gmrPrevSL = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                  const prevMeterValSL = gmrPrevSL?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                  const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
                  return (
                    <div key={`grid-${idx}`}>
                      <Label className="flex items-center gap-1 text-xs">
                        <GridPylonIcon className="h-2.5 w-2.5 text-blue-400" />
                        {meterLabel}
                        <span
                          className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}
                          title={configLoading ? 'Loading CT multiplier from config…' : `CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}
                        >
                          {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                        </span>
                        {isFirst && editingId && <span className="text-[10px] text-amber-600 ml-1">(editing)</span>}
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <button
                            type="button"
                            title={`View ${meterLabel} history`}
                            onClick={() => setPowerHistoryOpen({ type: 'grid', idx })}
                            className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <History className="h-3 w-3" />
                          </button>
                        )}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="any" value={val}
                          onChange={e => handleChange(e.target.value)}
                          placeholder="Grid reading"
                          className="border-blue-300 focus-visible:ring-blue-300"
                          data-testid={`power-meter-input-${idx}`} />
                        <Button
                          size="sm"
                          disabled={isSavingThis || !gridMeterChanged || configLoading}
                          title={configLoading ? 'Loading meter config — please wait' : undefined}
                          onClick={() => submitMeter('grid', idx)}
                          className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                          data-testid={`power-grid-save-${idx}`}
                        >
                          {isSavingThis || configLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      {(() => {
                        // Per-meter prev/delta: look up each meter's own previous reading
                        // from prevRow.grid_meter_readings JSONB; fall back to meter_reading_kwh for meter 0.
                        const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                        const prevMeterVal = gmrPrev?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                        if (prevMeterVal == null) return null;
                        // Suppress delta while showing unchanged pre-filled baseline
                        const perMeterDelta = gridMeterChanged ? +val - prevMeterVal : null;
                        return (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            prev: <span className="font-mono-num">{fmtNum(prevMeterVal)}</span>
                            {perMeterDelta != null && (
                              <span className={`font-mono-num font-medium ml-1 ${perMeterDelta >= 0 ? 'text-blue-600' : 'text-destructive'}`}>
                                Δ {fmtNum(perMeterDelta)}
                              </span>
                            )}
                          </p>
                        );
                      })()}
                    </div>
                  );
                })}
                {/* Grid column total Δ — sums each meter's (Δ × per-meter multiplier) */}
                {gridMeterCount > 1 && (() => {
                  const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                  let totalDelta = 0;
                  let hasAny = false;
                  for (let mi = 0; mi < gridMeterCount; mi++) {
                    const currVal = gridMeterReadings[mi];
                    const prevVal = gmrPrev?.[String(mi)] ?? (mi === 0 ? prevGrid : null);
                    if (currVal && prevVal != null) {
                      totalDelta += (+currVal - prevVal) * getGridMeterMult(mi);
                      hasAny = true;
                    }
                  }
                  if (!hasAny) return null;
                  return (
                    <div className="rounded border border-blue-200 bg-blue-50/60 dark:border-blue-800/30 dark:bg-blue-950/10 px-2 py-1 text-[11px] flex items-center gap-1.5 mt-1">
                      <GridPylonIcon className="h-3 w-3 text-blue-500" />
                      <span className="text-muted-foreground">Total Δ</span>
                      <span className={`font-mono-num font-semibold ml-auto ${totalDelta >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-destructive'}`}>
                        {fmtNum(totalDelta)} kWh
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>}

            {/* ── Mobile: per-meter swipe carousel (grid meters first, then solar) ── */}
            {isMobile && (
              <MobileCarousel
                isMobile={true}
                items={powerMeterItems}
                renderItem={(item: { type: 'grid' | 'solar'; idx: number }) => {
                  /* ── Grid meter card ── */
                  if (item.type === 'grid') {
                    const meterLabel = getGridLabel(item.idx);
                    const val = gridMeterReadings[item.idx] ?? '';
                    const isFirst = item.idx === 0;
                    const handleChange = (v: string) => { setGridMeterReading(item.idx, v); if (isFirst) setReading(v); };
                    const isSavingThis = savingMeter === `grid-${item.idx}`;
                    const mMult = getGridMeterMult(item.idx);
                    const gmrPrevSL = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                    const prevMeterValSL = gmrPrevSL?.[String(item.idx)] ?? (item.idx === 0 ? prevGrid : null);
                    const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
                    const perMeterDelta = gridMeterChanged && prevMeterValSL != null ? +val - prevMeterValSL : null;
                    return (
                      <div key={`grid-card-${item.idx}`} className="px-4 py-3 space-y-2">
                        {/* Header: label + multiplier + history button */}
                        <div className="flex items-center justify-between gap-2">
                          <Label className="flex items-center gap-1.5 text-sm">
                            <GridPylonIcon className="h-3 w-3 text-blue-400" />
                            {meterLabel}
                            <span className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}>
                              {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                            </span>
                            {isFirst && editingId && <span className="text-[10px] text-amber-600">(editing)</span>}
                          </Label>
                          {(isAdmin || isManager || isDataAnalyst) && (
                            <Button variant="ghost" size="sm"
                              className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() => setPowerHistoryOpen({ type: 'grid', idx: item.idx })} title={`View ${meterLabel} history`}>
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        {/* Drum roller */}
                        <OdometerRollerInput
                          value={val} onChange={handleChange}
                          alertState={gridMeterChanged ? (perMeterDelta != null && perMeterDelta < 0 ? 'warn' : 'ok') : 'neutral'}
                          disabled={isSavingThis || configLoading}
                          testId={`power-meter-input-${item.idx}`}
                        />
                        {/* prev / delta */}
                        <div className="flex items-center justify-between text-[11px] px-0.5">
                          <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValSL != null ? fmtNum(prevMeterValSL) : '—'}</span></span>
                          {perMeterDelta != null && (
                            <span className={`font-mono-num font-medium ${perMeterDelta >= 0 ? 'text-blue-600' : 'text-destructive'}`}>Δ {fmtNum(perMeterDelta)} kWh</span>
                          )}
                        </div>
                        {/* Save */}
                        <Button
                          disabled={isSavingThis || !gridMeterChanged || configLoading}
                          title={configLoading ? 'Loading meter config — please wait' : undefined}
                          onClick={() => submitMeter('grid', item.idx)}
                          className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                          data-testid={`power-grid-save-${item.idx}`}
                        >
                          {isSavingThis || configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId && isFirst ? 'Update' : 'Save'}
                        </Button>
                      </div>
                    );
                  }
                  /* ── Solar meter card ── */
                  const meterLabel = getSolarLabel(item.idx);
                  const val = solarMeterReadings[item.idx] ?? '';
                  const isFirst = item.idx === 0;
                  const handleChange = (v: string) => { setSolarMeterReading(item.idx, v); if (isFirst) setSolarReading(v); };
                  const isSavingThis = savingMeter === `solar-${item.idx}`;
                  const solarPrevVal = item.idx === 0 ? prevSolar : null;
                  const solarMeterChanged = val !== '' && (solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal);
                  const solarDeltaThis = solarInputMode === 'raw' && solarMeterChanged && solarPrevVal != null ? +val - solarPrevVal : null;
                  return (
                    <div key={`solar-card-${item.idx}`} className="px-4 py-3 space-y-2">
                      {/* Header: label + mode hint + history button */}
                      <div className="flex items-center justify-between gap-2">
                        <Label className="flex items-center gap-1.5 text-sm">
                          <span className="text-yellow-400">☀</span>
                          {meterLabel}
                          {isFirst && editingId && <span className="text-[10px] text-amber-600">(editing)</span>}
                        </Label>
                        {(isAdmin || isManager || isDataAnalyst) && (
                          <Button variant="ghost" size="sm"
                            className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={() => setPowerHistoryOpen({ type: 'solar', idx: item.idx })} title={`View ${meterLabel} history`}>
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {isFirst && (
                        <p className="text-[10px] text-muted-foreground -mt-1">
                          Mode: <span className="font-medium text-yellow-600 dark:text-yellow-400">{solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}</span>
                          <span className="opacity-60 ml-1">(Plants → Energy Sources)</span>
                        </p>
                      )}
                      {/* Input: drum for raw, regular input for direct */}
                      {solarInputMode === 'raw' ? (
                        <>
                          <OdometerRollerInput
                            value={val} onChange={handleChange}
                            alertState={solarMeterChanged ? (solarDeltaThis != null && solarDeltaThis < 0 ? 'warn' : 'ok') : 'neutral'}
                            disabled={isSavingThis}
                            testId={`power-solar-input-${item.idx}`}
                          />
                          {isFirst && (
                            <div className="flex items-center justify-between text-[11px] px-0.5">
                              <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevSolar != null ? fmtNum(prevSolar) : '—'}</span></span>
                              {solarDeltaThis != null && <span className={`font-mono-num font-medium ${solarDeltaThis >= 0 ? 'text-yellow-600' : 'text-destructive'}`}>Δ {fmtNum(solarDeltaThis)} kWh</span>}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Input type="number" step="any" value={val}
                            onChange={e => handleChange(e.target.value)}
                            placeholder="Daily kWh"
                            className="border-yellow-300 focus-visible:ring-yellow-300"
                            data-testid={`power-solar-input-${item.idx}`} />
                          {isFirst && val && <p className="text-[10px] text-yellow-600 dark:text-yellow-400 font-mono-num">→ {fmtNum(+val)} kWh daily production</p>}
                        </>
                      )}
                      {/* Save */}
                      <Button
                        disabled={isSavingThis || !solarMeterChanged}
                        onClick={() => submitMeter('solar', item.idx)}
                        className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                        data-testid={`power-solar-save-${item.idx}`}
                      >
                        {isSavingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                      </Button>
                    </div>
                  );
                }}
              />
            )}

            {/* Energy Source Breakdown — total Δ solar + total Δ grid */}
            <div className="flex items-center gap-1.5 rounded border bg-muted/20 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground/60 font-medium uppercase tracking-wide shrink-0">Breakdown</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-yellow-500 shrink-0">☀</span>
              <span className={deltaSolar != null ? 'font-mono-num font-medium text-yellow-700 dark:text-yellow-400' : 'text-muted-foreground/50'}>
                {deltaSolar != null ? `${fmtNum(deltaSolar)} kWh` : '—'}
              </span>
              <span className="text-muted-foreground/40 mx-0.5">|</span>
              <GridPylonIcon className="h-3 w-3 text-blue-500 shrink-0" />
              <span className={deltaGrid != null ? 'font-mono-num font-medium text-blue-700 dark:text-blue-400' : 'text-muted-foreground/50'}>
                {deltaGrid != null ? `${fmtNum(deltaGrid * effectiveMultiplier)} kWh` : '—'}
              </span>
              {effectiveMultiplier !== 1 && deltaGrid != null && (
                <span className="text-[10px] text-amber-500 ml-0.5">×{effectiveMultiplier}</span>
              )}
              <span className="text-muted-foreground/30 text-[10px] ml-auto">auto · read-only</span>
            </div>
          </div>
        ) : (
          // Non-solar plant: Date & Time inline, then dynamic grid meter rows (per-meter multipliers shown inline)
          <div className="space-y-3">
            {/* Date & Time */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Date &amp; Time</Label>
                <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
                  className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" />
              </div>
            </div>

            {/* Dynamic grid meter rows — MobileCarousel on mobile, stacked on desktop */}
            <MobileCarousel
              isMobile={isMobile}
              items={Array.from({ length: gridMeterCount }, (_, i) => i)}
              renderItem={(idx: number) => {
                const meterLabel = getGridLabel(idx);
                const val = gridMeterReadings[idx] ?? '';
                const isFirst = idx === 0;
                const handleChange = (v: string) => { setGridMeterReading(idx, v); if (isFirst) setReading(v); };
                const isSavingThis2 = savingMeter === `grid-${idx}`;
                const mMult = getGridMeterMult(idx);
                const gmrPrevNS = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                const prevMeterValNS = gmrPrevNS?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                const gridMeterChangedNS = val !== '' && (prevMeterValNS == null || +val !== prevMeterValNS);
                const perMeterDeltaNS = gridMeterChangedNS && prevMeterValNS != null ? +val - prevMeterValNS : null;
                const perMeterEffectiveNS = perMeterDeltaNS != null ? perMeterDeltaNS * mMult : null;
                return (
                  <div key={`grid-ns-${idx}`} className={isMobile ? 'px-4 py-3 space-y-2' : 'space-y-1'}>
                    {/* Header: label + CT multiplier + history button */}
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-1.5">
                        <GridPylonIcon className="h-3 w-3 text-blue-500" />
                        {meterLabel}
                        <span
                          className={`text-[9px] font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700' : 'text-muted-foreground/40'}`}
                          title={`CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}
                        >
                          ×{mMult}
                        </span>
                        {isFirst && editingId && <span className="text-xs text-highlight ml-1">(editing)</span>}
                      </Label>
                      {(isAdmin || isManager || isDataAnalyst) && (
                        <Button variant="ghost" size="sm"
                          className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={() => setPowerHistoryOpen({ type: 'grid', idx })} title={`View ${meterLabel} history`}>
                          <History className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {isMobile ? (
                      <>
                        <OdometerRollerInput
                          value={val} onChange={handleChange}
                          alertState={gridMeterChangedNS ? (perMeterDeltaNS != null && perMeterDeltaNS < 0 ? 'warn' : 'ok') : 'neutral'}
                          disabled={isSavingThis2}
                          testId={`power-meter-input-${idx}`}
                        />
                        <div className="flex items-center justify-between text-[11px] px-0.5">
                          <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValNS != null ? fmtNum(prevMeterValNS) : '—'}</span>
                            {perMeterDeltaNS != null && <span className={`font-mono-num font-medium ml-1 ${perMeterDeltaNS >= 0 ? 'text-blue-600' : 'text-destructive'}`}>Δ {fmtNum(perMeterDeltaNS)}</span>}
                          </span>
                          {perMeterEffectiveNS != null && mMult !== 1 && (
                            <span className="font-mono-num text-amber-700 dark:text-amber-400">{fmtNum(perMeterEffectiveNS, 2)} kWh eff.</span>
                          )}
                        </div>
                        <Button
                          disabled={isSavingThis2 || !gridMeterChangedNS}
                          onClick={() => submitMeter('grid', idx)}
                          className="w-full h-11 text-sm bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm"
                          data-testid={`power-grid-save-ns-${idx}`}
                        >
                          {isSavingThis2 ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="any" value={val}
                            onChange={e => handleChange(e.target.value)}
                            placeholder="Grid meter reading"
                            className="border-blue-300 focus-visible:ring-blue-300"
                            data-testid={`power-meter-input-${idx}`} />
                          <Button
                            size="sm"
                            disabled={isSavingThis2 || !gridMeterChangedNS}
                            onClick={() => submitMeter('grid', idx)}
                            className="shrink-0 h-9 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                            data-testid={`power-grid-save-ns-${idx}`}
                          >
                            {isSavingThis2 ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                        </div>
                        {prevMeterValNS != null && (() => {
                          const perMeterEffective = perMeterDeltaNS != null ? perMeterDeltaNS * mMult : null;
                          return (
                            <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                              <span>
                                Previous: <span className="font-mono-num">{fmtNum(prevMeterValNS)}</span>
                                {perMeterDeltaNS != null && <> · Δ <span className="font-mono-num">{fmtNum(perMeterDeltaNS)}</span></>}
                              </span>
                              {perMeterEffective != null && mMult !== 1 && (
                                <div className="inline-flex items-center gap-1.5 ml-2 rounded bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800 px-2 py-0.5">
                                  <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                                  <span className="font-mono-num font-medium text-amber-700 dark:text-amber-300">{fmtNum(perMeterEffective, 2)} kWh</span>
                                  <span className="text-amber-600/70 dark:text-amber-400/60">effective (×{mMult})</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              }}
            />
          </div>
        )}

        {editingId && (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => { setEditingId(null); setReading(''); setSolarReading(''); setGridMeterReadings(['', '', '', '', '']); setSolarMeterReadings(['', '', '', '', '']); setSolarInputMode('raw'); }}>Cancel edit</Button>
          </div>
        )}
      </Card>

      {importOpen && (
        <ImportReadingsDialog
          title="Import Power Readings from CSV"
          module="power"
          plantId={plantId}
          userId={user?.id ?? null}
          schemaHint={POWER_SCHEMA}
          templateFilename="power_readings_template.csv"
          templateRow={POWER_TEMPLATE_ROW}
          validateRow={validatePowerRow}
          insertRows={(rows, pid) => insertPowerReadings(rows, pid, user?.id ?? null)}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); qc.invalidateQueries(); }}
        />
      )}
      {powerHistoryOpen && plantId && (
        <ReadingHistoryDialog
          entityName={plants?.find((p: any) => p.id === plantId)?.name ?? 'Plant'}
          module="power"
          entityId={plantId}
          multiplier={effectiveMultiplier}
          gridMeterCount={gridMeterCount}
          gridMeterNames={gridMeterNames}
          gridMultipliers={Array.isArray(configMultiplierArr) ? (configMultiplierArr as any[]).map(Number) : []}
          meterFilter={powerHistoryOpen}
          onClose={() => setPowerHistoryOpen(null)}
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

// Inline edit state for a history row
interface HistoryEditState {
  id: string;
  datetime: string;          // "yyyy-MM-dd'T'HH:mm"
  value: string;             // primary numeric field
  value2?: string;           // secondary (power for well, or solar for power)
  value3?: string;           // tertiary (grid for power)
  value4?: string;           // TDS ppm (well)
  value5?: string;           // pressure psi (well)
  isMeterReplacement?: boolean;
}

function ReadingHistoryDialog({ entityName, module, entityId, plantId, multiplier = 1,
  gridMeterCount: gridMeterCountProp = 1, gridMeterNames = [], gridMultipliers = [], meterFilter, onClose }: {
  entityName: string;
  module: HistoryModule;
  entityId: string;
  plantId?: string;
  /** CT multiplier for meter-0 (fallback when gridMultipliers is absent). Defaults to 1. */
  multiplier?: number;
  /** Number of grid meters configured for this plant. Defaults to 1. */
  gridMeterCount?: number;
  /** Display labels for each grid meter (index-aligned). Falls back to "Grid Meter N". */
  gridMeterNames?: string[];
  /** Per-meter CT multipliers (index-aligned). Falls back to `multiplier` prop. */
  gridMultipliers?: number[];
  /** When set, scopes the power history to a single meter (solar or grid-N). */
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [appliedFrom, setAppliedFrom] = useState(customFrom);
  const [appliedTo, setAppliedTo]     = useState(customTo);
  const [editRow, setEditRow] = useState<HistoryEditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [togglingGridId, setTogglingGridId] = useState<string | null>(null);
  const [togglingSolarId, setTogglingSolarId] = useState<string | null>(null);
  // Fix #8 — replace window.confirm (blocked in iframes) with inline two-click confirm
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  // Helper: parse a YYYY-MM-DD string as LOCAL midnight (avoids UTC timezone shift)
  const localMidnight = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // ── Multi-meter helpers (power module) ─────────────────────────────────────
  const resolvedGridCount = Math.max(1, gridMeterCountProp);
  const getHistGridLabel = (idx: number): string =>
    gridMeterNames[idx] ?? (resolvedGridCount === 1 ? 'Grid Meter' : `Grid Meter ${idx + 1}`);
  const getHistGridMult = (idx: number): number =>
    Array.isArray(gridMultipliers) && +gridMultipliers[idx] > 0
      ? +gridMultipliers[idx]
      : multiplier;

  const queryKey = ['reading-history', module, entityId, days, appliedFrom, appliedTo];

  const { data: rows, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // Use date-only strings (YYYY-MM-DD) for all filters — avoids UTC offset
      // cutting off records that were saved in a different timezone.
      let sinceDate: string;
      let untilNextDay: string; // exclusive upper bound = day after end date
      // Pure local-date arithmetic — avoids UTC offset shifting the date back
      // (e.g. UTC+8 would turn 2026-05-08T00:00:00 local → 2026-05-07T16:00:00Z).
      const _localStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const _addDay = (s: string, n: number) => {
        const [y, m, day] = s.split('-').map(Number);
        return _localStr(new Date(y, m - 1, day + n));
      };
      if (days === 'custom') {
        sinceDate = appliedFrom;
        untilNextDay = _addDay(appliedTo, 1);
      } else {
        sinceDate = _localStr(new Date(Date.now() - days * 86400_000));
        untilNextDay = _addDay(_localStr(new Date()), 1);
      }

      if (module === 'locator') {
        const { data } = await supabase
          .from('locator_readings')
          .select('id, current_reading, previous_reading, reading_datetime, off_location_flag, is_meter_replacement')
          .eq('locator_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return data ?? [];
      }
      if (module === 'well') {
        const { data, error } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, tds_ppm, pressure_psi, reading_datetime, is_meter_replacement')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns tds_ppm / pressure_psi /
        // is_meter_replacement may not exist yet — avoid the PostgREST schema-cache error)
        const { data: fallback } = await supabase
          .from('well_readings')
          .select('id, current_reading, previous_reading, power_meter_reading, reading_datetime')
          .eq('well_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return fallback ?? [];
      }
      if (module === 'power') {
        const { data, error } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, grid_meter_readings, daily_consumption_kwh, daily_solar_kwh, daily_grid_kwh, solar_meter_reading, reading_datetime, is_meter_replacement')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        if (!error) return data ?? [];
        // Fallback: base columns only (optional migration columns missing)
        const { data: fallback } = await supabase
          .from('power_readings')
          .select('id, meter_reading_kwh, daily_consumption_kwh, reading_datetime, is_meter_replacement')
          .eq('plant_id', entityId)
          .gte('reading_datetime', sinceDate)
          .lt('reading_datetime', untilNextDay)
          .order('reading_datetime', { ascending: false });
        return fallback ?? [];
      }
      if (module === 'blending') {
        try {
          let q = (supabase.from('blending_events' as any) as any)
            .select('id, well_id, plant_id, well_name, plant_name, event_date, reading_datetime, volume_m3, noted_at, is_meter_replacement, raw_meter_reading')
            .eq('well_id', entityId)
            .order('event_date', { ascending: false });
          if (days === 'custom') {
            q = q.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
          } else {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (days as number));
            q = q.gte('event_date', cutoff.toISOString().slice(0, 10));
          }
          const { data, error } = await q;
          if (error) {
            // is_meter_replacement may not exist yet — retry without it
            if (error.message?.includes('is_meter_replacement') || error.message?.includes('raw_meter_reading') || error.message?.includes('does not exist')) {
              // Retry with only the guaranteed base columns — neither is_meter_replacement
              // nor raw_meter_reading may exist yet if the migration hasn't been run.
              let q2 = (supabase.from('blending_events' as any) as any)
                .select('id, well_id, plant_id, well_name, plant_name, event_date, volume_m3, noted_at')
                .eq('well_id', entityId)
                .order('event_date', { ascending: false });
              if (days === 'custom') {
                q2 = q2.gte('event_date', customFrom.slice(0, 10)).lte('event_date', customTo.slice(0, 10));
              } else {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - (days as number));
                q2 = q2.gte('event_date', cutoff.toISOString().slice(0, 10));
              }
              const { data: d2, error: e2 } = await q2;
              if (e2) throw e2; // surface unexpected errors rather than silently returning []
              return (d2 ?? []).map((r: any) => ({ ...r, is_meter_replacement: false, raw_meter_reading: null }));
            }
            throw error;
          }
          return (data ?? []).map((r: any) => ({ ...r, is_meter_replacement: !!r.is_meter_replacement }));
        } catch { return []; }
      }
      return [];
    },
    staleTime: 0,
  });

  const startEdit = (r: any) => {
    const dt = r.reading_datetime ?? r.created_at ?? '';
    const dtStr = dt ? format(new Date(dt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
    if (module === 'well') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.current_reading ?? ''), value2: r.power_meter_reading != null ? String(r.power_meter_reading) : '', value4: r.tds_ppm != null ? String(r.tds_ppm) : '', value5: r.pressure_psi != null ? String(r.pressure_psi) : '', isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'locator') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.current_reading ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'power') {
      setEditRow({ id: r.id, datetime: dtStr, value: String(r.meter_reading_kwh ?? ''), value2: r.solar_meter_reading != null ? String(r.solar_meter_reading) : '', value3: r.daily_grid_kwh != null ? String(r.daily_grid_kwh) : '', isMeterReplacement: !!r.is_meter_replacement });
    } else if (module === 'blending') {
      const eventDt = r.event_date ?? r.noted_at ?? '';
      const blendDtStr = eventDt ? format(new Date(eventDt), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm");
      setEditRow({ id: r.id, datetime: blendDtStr, value: String(r.volume_m3 ?? ''), isMeterReplacement: !!r.is_meter_replacement });
    }
  };

  // One-click toggle for shared (non-power) meter replacement
  const toggleMeterReplacement = async (r: any) => {
    setTogglingId(r.id);
    const next = !r.is_meter_replacement;
    let error: any = null;
    if (module === 'well') {
      ({ error } = await (supabase.from('well_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // is_meter_replacement may not exist yet (pending migration) — silently skip toggle
      if (error?.message?.includes('does not exist')) error = null;
    } else if (module === 'locator')
      ({ error } = await (supabase.from('locator_readings') as any).update({ is_meter_replacement: next }).eq('id', r.id));
    else if (module === 'blending') {
      ({ error } = await (supabase.from('blending_events' as any) as any).update({ is_meter_replacement: next }).eq('id', r.id));
      // Column may not exist yet — silently skip (graceful degradation)
      if (error?.message?.includes('does not exist') || error?.message?.includes('is_meter_replacement')) error = null;
    }
    setTogglingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? 'Marked as meter replacement — Δ zeroed' : 'Meter replacement flag removed');
    qc.invalidateQueries({ queryKey });
  };

  // Power-specific: toggle grid meter replacement
  const toggleGridReplacement = async (r: any) => {
    setTogglingGridId(r.id);
    const next = !r.is_grid_replacement;
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_grid_replacement: next }).eq('id', r.id);
    setTogglingGridId(null);
    if (error) {
      // Column may not exist yet — fall back to shared flag
      const { error: e2 } = await (supabase.from('power_readings') as any)
        .update({ is_meter_replacement: next }).eq('id', r.id);
      if (e2) { toast.error(e2.message); return; }
    }
    // When flagging as replacement, reset the CT multiplier in plant_power_config to 1
    // so the operator must explicitly re-enter the new meter's ratio.
    if (next && plantId) {
      try {
        const existingArr = Array.isArray(configMultiplierArr) ? [...configMultiplierArr] : [1];
        existingArr[0] = 1;
        await (supabase.from('plant_power_config' as any) as any)
          .upsert(
            { plant_id: plantId, grid_meter_multipliers: existingArr, updated_at: new Date().toISOString() },
            { onConflict: 'plant_id' }
          );
        qc.invalidateQueries({ queryKey: ['plant-power-config', plantId] });
        toast.success('Grid replacement marked — Δ zeroed · CT multiplier reset to 1. Update it in Plants → Power.');
      } catch {
        toast.success('Grid replacement marked — Δ zeroed');
      }
    } else {
      toast.success(next ? 'Grid replacement marked — Δ zeroed' : 'Grid replacement flag removed');
    }
    qc.invalidateQueries({ queryKey });
  };

  // Power-specific: toggle solar meter replacement
  const toggleSolarReplacement = async (r: any) => {
    setTogglingSolarId(r.id);
    const next = !r.is_solar_replacement;
    const { error } = await (supabase.from('power_readings') as any)
      .update({ is_solar_replacement: next }).eq('id', r.id);
    setTogglingSolarId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? 'Solar replacement marked — Δ zeroed' : 'Solar replacement flag removed');
    qc.invalidateQueries({ queryKey });
  };

  // Row selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (!rows?.length) return;
    setSelectedIds(prev =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r: any) => r.id))
    );
  };

  // Bulk delete
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    // Fix #8: two-click confirm instead of window.confirm (blocked in iframes)
    if (!bulkDeletePending) { setBulkDeletePending(true); return; }
    setBulkDeletePending(false);
    setBulkDeleting(true);
    const ids = [...selectedIds];
    let error: any = null;
    if (module === 'well')
      ({ error } = await supabase.from('well_readings').delete().in('id', ids));
    else if (module === 'locator')
      ({ error } = await supabase.from('locator_readings').delete().in('id', ids));
    else if (module === 'power')
      ({ error } = await supabase.from('power_readings').delete().in('id', ids));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).in('id', ids);
      error = _be ?? (_bc === 0 ? new Error('Bulk delete blocked — check RLS policy on blending_events') : null);
    }
    setBulkDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${ids.length} reading(s) deleted`);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey });
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    qc.invalidateQueries();
  };

  const deleteRow = async (id: string) => {
    // Fix #8: two-click confirm instead of window.confirm (blocked in iframes)
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    setPendingDeleteId(null);
    setDeletingId(id);
    let error: any = null;
    if (module === 'well') ({ error } = await supabase.from('well_readings').delete().eq('id', id));
    else if (module === 'locator') ({ error } = await supabase.from('locator_readings').delete().eq('id', id));
    else if (module === 'power') ({ error } = await supabase.from('power_readings').delete().eq('id', id));
    else if (module === 'blending') {
      const { error: _be, count: _bc } = await (supabase.from('blending_events' as any) as any)
        .delete({ count: 'exact' }).eq('id', id);
      error = _be ?? (_bc === 0 ? new Error('Delete blocked — run the missing RLS policy SQL (see console)') : null);
      if (_bc === 0 && !_be) console.error('blending_events DELETE returned 0 rows. Add policy: CREATE POLICY "auth_delete_blending_events" ON blending_events FOR DELETE USING (auth.uid() IS NOT NULL);');
    }
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Reading deleted');
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    qc.invalidateQueries({ queryKey });
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') qc.invalidateQueries({ queryKey: ['op-loc-recent'] });
    if (module === 'well') qc.invalidateQueries({ queryKey: ['op-well-recent'] });
    qc.invalidateQueries();
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setSaving(true);
    let error: any = null;
    const dtIso = new Date(editRow.datetime).toISOString();

    if (module === 'well') {
      // Recalculate daily_volume so TrendChart/Dashboard totals stay correct after edits.
      // NOTE: daily_volume is a GENERATED ALWAYS AS column — it cannot be set in UPDATE.
      // The DB recomputes it automatically; we keep this comment for historical context.
      const wellRow = rows?.find((r: any) => r.id === editRow.id);
      const wellCur = +editRow.value;
      const wellEditPayload: Record<string, any> = {
        current_reading: wellCur,
        power_meter_reading: editRow.value2 ? +editRow.value2 : null,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
        // daily_volume intentionally omitted — GENERATED ALWAYS AS column in Postgres;
        // updating it directly causes: "column can only be updated to DEFAULT".
        // The DB recomputes it automatically from current_reading - previous_reading.
      };
      // Only include optional columns when non-undefined — sending null for a
      // missing DB column causes the PostgREST "relation does not exist" error.
      if (editRow.value4 !== undefined) wellEditPayload.tds_ppm = editRow.value4 ? +editRow.value4 : null;
      if (editRow.value5 !== undefined) wellEditPayload.pressure_psi = editRow.value5 ? +editRow.value5 : null;
      ({ error } = await (supabase.from('well_readings') as any).update(wellEditPayload).eq('id', editRow.id));
    } else if (module === 'locator') {
      // Recalculate daily_volume so TrendChart/Dashboard always use an up-to-date delta.
      // NOTE: daily_volume is GENERATED ALWAYS AS on locator_readings — cannot be set in UPDATE.
      const locRow = rows?.find((r: any) => r.id === editRow.id);
      const newCur = +editRow.value;
      // daily_volume is a GENERATED ALWAYS AS column on locator_readings — omit from UPDATE.
      // (CSV import already omits it for the same reason; this aligns saveEdit to match.)
      ({ error } = await (supabase.from('locator_readings') as any).update({
        current_reading: newCur,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
        // daily_volume intentionally omitted — DB recomputes it automatically.
      }).eq('id', editRow.id));
    } else if (module === 'power') {
      // Fix #3 — daily_consumption_kwh was never recalculated on edit, so Dashboard
      // totals would drift after any history correction.  Re-derive it the same way
      // the initial insert does: find the predecessor row, compute Δ meter reading,
      // then apply the CT multiplier so PV ratios stay correct.
      const editedDt = new Date(dtIso).toISOString();
      const editedDate = editedDt.slice(0, 10);
      let recomputedConsumption: number | null = null;
      try {
        const { data: pred } = await supabase
          .from('power_readings')
          .select('meter_reading_kwh')
          .eq('plant_id', entityId)
          .lt('reading_datetime', `${editedDate}T00:00:00.000Z`)
          .order('reading_datetime', { ascending: false })
          .limit(1);
        if (pred && pred.length > 0) {
          const delta = +editRow.value - (pred[0] as any).meter_reading_kwh;
          if (delta >= 0) recomputedConsumption = delta * multiplier;
        }
      } catch { /* non-critical: proceed without updating daily_consumption_kwh */ }
      const powerUpdatePayload: Record<string, any> = {
        meter_reading_kwh: +editRow.value,
        solar_meter_reading: editRow.value2 ? +editRow.value2 : null,
        reading_datetime: dtIso,
        is_meter_replacement: !!editRow.isMeterReplacement,
      };
      // Keep grid_meter_readings key-0 in sync with the edited meter_reading_kwh.
      // Fetch the existing JSONB so we don't overwrite secondary meters (idx ≥ 1).
      try {
        const { data: existingPR } = await (supabase.from('power_readings') as any)
          .select('grid_meter_readings').eq('id', editRow.id).maybeSingle();
        const existingGmr = (existingPR?.grid_meter_readings as Record<string, number> | null) ?? {};
        powerUpdatePayload.grid_meter_readings = { ...existingGmr, '0': +editRow.value };
      } catch { /* non-critical: grid_meter_readings column may not exist yet */ }
      if (recomputedConsumption != null) {
        powerUpdatePayload.daily_consumption_kwh = recomputedConsumption;
        // BUG C FIX: daily_grid_kwh was never updated on history edits.
        // Plants.tsx chart reads daily_grid_kwh as its Priority-1 source, so
        // leaving it stale after an edit caused the Operations "Last 7 readings"
        // (dynamic recompute) and the Plants chart (stored column) to diverge.
        powerUpdatePayload.daily_grid_kwh = recomputedConsumption;
      }
      ({ error } = await (supabase.from('power_readings') as any).update(powerUpdatePayload).eq('id', editRow.id));
    }

    if (module === 'blending') {
      const blendPayload: Record<string, any> = {
        volume_m3: +editRow.value,
        event_date: editRow.datetime.slice(0, 10),
        is_meter_replacement: !!editRow.isMeterReplacement,
        // Preserve raw_meter_reading from the original row if available; editor
        // only changes volume_m3 so we copy it forward unchanged.
        ...(rows?.find((r: any) => r.id === editRow.id)?.raw_meter_reading != null
          ? { raw_meter_reading: rows.find((r: any) => r.id === editRow.id).raw_meter_reading }
          : {}),
      };
      const { error: _ue, count: _uc } = await (supabase.from('blending_events' as any) as any)
        .update(blendPayload, { count: 'exact' })
        .eq('id', editRow.id);
      error = _ue ?? (_uc === 0 ? new Error('Update blocked — run the missing RLS policy SQL (see console)') : null);
      if (_uc === 0 && !_ue) console.error('blending_events UPDATE returned 0 rows. Add policy: CREATE POLICY "auth_update_blending_events" ON blending_events FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);');
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Reading updated');
    setEditRow(null);
    qc.invalidateQueries({ queryKey });
    // Also invalidate the parent form queries so "Last 7 readings" refreshes
    if (module === 'power') qc.invalidateQueries({ queryKey: ['op-power', entityId] });
    if (module === 'locator') qc.invalidateQueries({ queryKey: ['op-loc-recent'] });
    if (module === 'well') qc.invalidateQueries({ queryKey: ['op-well-recent'] });
    qc.invalidateQueries();
  };

  const title = module === 'power'
    ? meterFilter
      ? meterFilter.type === 'solar'
        ? `Solar — ${entityName} — History`
        : `${getHistGridLabel(meterFilter.idx)} — ${entityName} — History`
      : `Power — ${entityName}`
    : `${entityName} — History`;
  const canEditDelete = true;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        {/* Window selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
            {HISTORY_WINDOWS.map(({ label, days: d }) => (
              <button
                key={label}
                onClick={() => { setDays(d as any); setEditRow(null); }}
                className={[
                  'px-3 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setDays('custom'); setEditRow(null); }}
              className={[
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                days === 'custom' ? 'bg-teal-700 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              Custom
            </button>
          </div>
          {days === 'custom' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button size="sm" className="h-7 px-3 text-xs bg-teal-700 text-white hover:bg-teal-800"
                onClick={() => { setAppliedFrom(customFrom); setAppliedTo(customTo); setEditRow(null); }}>
                Apply
              </Button>
            </div>
          )}
        </div>

        {/* Inline edit form */}
        {editRow && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <p className="font-medium text-foreground">Editing reading</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11px]">Date &amp; Time</Label>
                <Input type="datetime-local" value={editRow.datetime}
                  onChange={e => setEditRow({ ...editRow, datetime: e.target.value })}
                  className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[11px]">
                  {module === 'well' ? 'Water (unitless)' : module === 'locator' ? 'Reading' : module === 'blending' ? 'Volume (m³)' : 'Grid Power Reading (kWh)'}
                </Label>
                <Input type="number" step="any" value={editRow.value}
                  onChange={e => setEditRow({ ...editRow, value: e.target.value })}
                  className="h-8 text-xs" />
              </div>
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">Power Meter (kWh)</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">TDS (ppm)</Label>
                  <Input type="number" step="any" value={editRow.value4 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value4: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'well' && (
                <div>
                  <Label className="text-[11px]">Pressure (psi)</Label>
                  <Input type="number" step="any" value={editRow.value5 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value5: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
              {module === 'power' && (
                <div>
                  <Label className="text-[11px]">Solar Power Reading (kWh)</Label>
                  <Input type="number" step="any" value={editRow.value2 ?? ''}
                    onChange={e => setEditRow({ ...editRow, value2: e.target.value })}
                    className="h-8 text-xs" placeholder="optional" />
                </div>
              )}
            </div>
            {module !== 'power' && (
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={!!editRow.isMeterReplacement}
                  onChange={e => setEditRow({ ...editRow, isMeterReplacement: e.target.checked })}
                  className="h-3.5 w-3.5 accent-orange-500"
                />
                <span className="text-[11px] text-muted-foreground">Meter replacement / PMS (zeroes Δ)</span>
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={saving || !editRow.value}
                className="bg-teal-700 text-white hover:bg-teal-800 h-7 text-xs px-3">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save changes'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditRow(null)} disabled={saving} className="h-7 text-xs px-3">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Bulk delete toolbar — shown when rows are selected */}
        {canEditDelete && selectedIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <span className="text-xs font-medium text-destructive flex-1">
              {selectedIds.size} row{selectedIds.size > 1 ? 's' : ''} selected
            </span>
            {bulkDeletePending ? (
              <>
                <span className="text-xs text-destructive font-medium">Delete {selectedIds.size} reading(s)?</span>
                <Button size="sm" variant="destructive" className="h-7 px-3 text-xs gap-1" onClick={bulkDelete} disabled={bulkDeleting}>
                  {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes, delete'}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                  onClick={() => setBulkDeletePending(false)}>Cancel</Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 px-3 text-xs gap-1.5"
                onClick={bulkDelete}
                disabled={bulkDeleting}
              >
                <X className="h-3 w-3" />
                Delete selected
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
              onClick={() => { setSelectedIds(new Set()); setBulkDeletePending(false); }}>
              Clear
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto max-h-[520px] rounded border text-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !rows?.length ? (
            <p className="p-4 text-center text-muted-foreground">
              {days === 'custom'
                ? `No readings from ${appliedFrom} → ${appliedTo}`
                : `No readings in the last ${days} days`}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {canEditDelete && (
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                        checked={!!rows?.length && selectedIds.size === rows.length}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 font-medium">Date & Time</th>
                  {module === 'locator' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium">Flags</th>
                  </>}
                  {module === 'well' && <>
                    <th className="px-3 py-2 font-medium text-right">Water</th>
                    <th className="px-3 py-2 font-medium text-right">Δ</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                    <th className="px-3 py-2 font-medium text-right">Power (kWh)</th>
                    <th className="px-3 py-2 font-medium text-right">TDS (ppm)</th>
                    <th className="px-3 py-2 font-medium text-right">Pressure (psi)</th>
                  </>}
                  {module === 'blending' && <>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Volume (m³)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {module === 'power' && <>
                    <th className="px-3 py-2 font-medium">Meter</th>
                    <th className="px-3 py-2 font-medium text-right">Reading</th>
                    <th className="px-3 py-2 font-medium text-right">Δ (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center text-slate-500">×</th>
                    <th className="px-3 py-2 font-medium text-right text-blue-700 dark:text-blue-400">Power (kWh)</th>
                    <th className="px-2 py-2 font-medium text-center">Repl.</th>
                  </>}
                  {canEditDelete && <th className="px-2 py-2 font-medium text-center w-16">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => {
                  const dt = r.reading_datetime ?? r.event_date ?? r.noted_at ?? '';
                  // Blending stores event_date as a date-only string (YYYY-MM-DD).
                  // Parsing it with `new Date(str)` treats it as UTC midnight, which
                  // shifts the displayed time by the local UTC offset (e.g. +08:00 → 08:00).
                  // Use local-midnight construction + date-only format to avoid this.
                  let dateStr: string;
                  if (module === 'blending') {
                    if (r.reading_datetime) {
                      dateStr = format(new Date(r.reading_datetime), 'MMM d, yyyy HH:mm');
                    } else if (r.event_date) {
                      const [ey, em, ed] = r.event_date.split('-').map(Number);
                      dateStr = format(new Date(ey, em - 1, ed), 'MMM d, yyyy');
                    } else {
                      dateStr = '—';
                    }
                  } else {
                    dateStr = dt ? format(new Date(dt), 'MMM d, yyyy HH:mm') : '—';
                  }
                  const isEditing = editRow?.id === r.id;
                  const isDeleting = deletingId === r.id;
                  const isToggling = togglingId === r.id;
                  const isMeterReplacement = !!r.is_meter_replacement;
                  // rows sorted descending → rows[i+1] is the immediately preceding reading in time
                  const predecessor: any = rows[i + 1] ?? null;

                  const isGridRepl      = !!(r.is_grid_replacement  ?? r.is_meter_replacement);
                  const isSolarRepl     = !!(r.is_solar_replacement ?? false);
                  const isTogglingGrid  = togglingGridId  === r.id;
                  const isTogglingSolar = togglingSolarId === r.id;

                  // Shared "Repl." toggle cell — rendered for well / locator
                  const replCell = (
                    <td className="px-2 py-1.5 text-center">
                      <button
                        title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                        disabled={isDeleting || isToggling}
                        onClick={() => toggleMeterReplacement(r)}
                        className={[
                          'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                          'disabled:opacity-40 disabled:cursor-not-allowed',
                          isMeterReplacement
                            ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                            : 'border-input bg-background hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20',
                        ].join(' ')}
                      >
                        {isToggling
                          ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          : isMeterReplacement ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                        }
                      </button>
                    </td>
                  );

                  // ── Power module: card-style rows (date header + one sub-row per meter) ──
                  if (module === 'power') {
                    const gmr     = r.grid_meter_readings     as Record<string, number> | null | undefined;
                    const prevGmr = predecessor?.grid_meter_readings as Record<string, number> | null | undefined;
                    const hasSolar = r.solar_meter_reading != null || (r.daily_solar_kwh != null && +r.daily_solar_kwh > 0);
                    // colspan for the date cell: Date + all 6 data columns
                    const dateCols = 7;
                    const actionsCell = canEditDelete ? (
                      <td className="px-2 py-1 text-center align-top" rowSpan={resolvedGridCount + (hasSolar ? 1 : 0) + 1}>
                        <div className="flex items-center justify-center gap-0.5 pt-0.5">
                          <button
                            title="Edit"
                            disabled={!!editRow || isDeleting}
                            onClick={() => startEdit(r)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {pendingDeleteId === r.id ? (
                            <>
                              <button title="Confirm delete" onClick={() => deleteRow(r.id)}
                                className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-semibold leading-none">
                                Yes
                              </button>
                              <button title="Cancel" onClick={() => setPendingDeleteId(null)}
                                className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-[10px] leading-none">
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              title="Delete"
                              disabled={!!editRow || isDeleting}
                              onClick={() => deleteRow(r.id)}
                              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            >
                              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            </button>
                          )}
                        </div>
                      </td>
                    ) : null;

                    // ── meterFilter: flat single-row-per-record rendering ────────────────
                    if (meterFilter) {
                      const isSolar = meterFilter.type === 'solar';
                      const gridIdx = !isSolar ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
                      const mMult   = isSolar ? 1 : getHistGridMult(gridIdx);
                      const curr    = isSolar
                        ? r.solar_meter_reading
                        : (gmr?.[String(gridIdx)] ?? (gridIdx === 0 ? r.meter_reading_kwh : null));
                      const prevVal = isSolar
                        ? predecessor?.solar_meter_reading
                        : (prevGmr?.[String(gridIdx)] ?? (gridIdx === 0 ? predecessor?.meter_reading_kwh : null));
                      const rawDelta   = curr != null && prevVal != null ? curr - prevVal : null;
                      const isRepl     = isSolar ? isSolarRepl : isGridRepl;
                      const effective  = isRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;
                      return (
                        <tr key={r.id ?? i}
                          className={[
                            'border-t',
                            isEditing  ? 'bg-teal-50/60 dark:bg-teal-950/20'
                            : isRepl   ? 'bg-orange-50/40 dark:bg-orange-950/10'
                            : 'hover:bg-muted/40',
                          ].join(' ')}
                        >
                          {canEditDelete && (
                            <td className="px-2 py-1.5 w-8">
                              <input type="checkbox" className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                                checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              {dateStr}
                              {isRepl && (
                                <span className={`text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none ${isSolar ? 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30' : 'text-orange-600 bg-orange-100 dark:bg-orange-900/30'}`}>
                                  repl.
                                </span>
                              )}
                            </span>
                          </td>
                          {/* Meter column placeholder (hidden in filtered view) */}
                          <td />
                          {/* Reading */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-[11px]">
                            <span className={isSolar ? 'text-yellow-600' : 'text-blue-600'}>
                              {curr != null ? fmtNum(curr) : '—'}
                            </span>
                          </td>
                          {/* Δ raw */}
                          <td className="px-3 py-1.5 text-right font-mono-num text-[11px]">
                            {isRepl
                              ? <span className="text-orange-500 font-medium">0</span>
                              : rawDelta != null ? fmtNum(rawDelta) : '—'
                            }
                          </td>
                          {/* × multiplier */}
                          <td className="px-2 py-1.5 text-center font-mono-num text-slate-500 text-[10px]">
                            {mMult !== 1 ? `×${mMult}` : '×1'}
                          </td>
                          {/* Effective kWh */}
                          <td className={['px-3 py-1.5 text-right font-mono-num font-medium text-[11px]',
                            effective != null && effective < 0 ? 'text-destructive' : isSolar ? 'text-yellow-700 dark:text-yellow-400' : 'text-blue-700 dark:text-blue-400',
                          ].join(' ')}>
                            {effective != null ? fmtNum(effective) : '—'}
                          </td>
                          {/* Repl. toggle */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              title={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
                              disabled={isDeleting || isTogglingGrid || isTogglingSolar}
                              onClick={() => isSolar ? toggleSolarReplacement(r) : toggleGridReplacement(r)}
                              className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                'disabled:opacity-40 disabled:cursor-not-allowed',
                                isRepl
                                  ? (isSolar ? 'bg-yellow-500 border-yellow-500' : 'bg-blue-500 border-blue-500') + ' text-white'
                                  : 'border-input bg-background hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20',
                              ].join(' ')}
                            >
                              {(isTogglingGrid || isTogglingSolar) ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : isRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null}
                            </button>
                          </td>
                          {canEditDelete && (
                            <td className="px-2 py-1 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <button title="Edit" disabled={!!editRow || isDeleting}
                                  onClick={() => startEdit(r)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                                  <Pencil className="h-3 w-3" />
                                </button>
                                {pendingDeleteId === r.id ? (
                                  <>
                                    <button title="Confirm delete" onClick={() => deleteRow(r.id)}
                                      className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-semibold leading-none">Yes</button>
                                    <button title="Cancel" onClick={() => setPendingDeleteId(null)}
                                      className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-[10px] leading-none">No</button>
                                  </>
                                ) : (
                                  <button title="Delete" disabled={!!editRow || isDeleting}
                                    onClick={() => deleteRow(r.id)}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                                    {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    }

                    return (
                      <React.Fragment key={r.id ?? i}>
                        {/* ── Date header row ── */}
                        <tr className={[
                          'border-t',
                          isEditing ? 'bg-teal-50/60 dark:bg-teal-950/20'
                          : isGridRepl ? 'bg-orange-50/40 dark:bg-orange-950/10'
                          : 'bg-muted/20',
                        ].join(' ')}>
                          {canEditDelete && (
                            <td className="px-2 py-1 w-8">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleSelect(r.id)}
                              />
                            </td>
                          )}
                          <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground font-medium" colSpan={dateCols}>
                            <span className="flex items-center gap-1.5">
                              {dateStr}
                              {isGridRepl && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded leading-none">
                                  grid repl.
                                </span>
                              )}
                              {isSolarRepl && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 rounded leading-none">
                                  solar repl.
                                </span>
                              )}
                            </span>
                          </td>
                          {/* actions rowspan anchor — spans all sub-rows */}
                          {actionsCell}
                        </tr>

                        {/* ── One sub-row per grid meter ── */}
                        {Array.from({ length: resolvedGridCount }).map((_, mi) => {
                          const mLabel = getHistGridLabel(mi);
                          const mMult  = getHistGridMult(mi);
                          const curr   = gmr?.[String(mi)]     ?? (mi === 0 ? r.meter_reading_kwh     : null);
                          const prev   = prevGmr?.[String(mi)] ?? (mi === 0 ? predecessor?.meter_reading_kwh : null);
                          const rawDelta    = (curr != null && prev != null) ? curr - prev : null;
                          const effective   = isGridRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;
                          return (
                            <tr key={`g${mi}`} className="hover:bg-muted/30">
                              {canEditDelete && <td />}
                              {/* Meter label */}
                              <td className="px-3 py-1 pl-6">
                                <span className="flex items-center gap-1 text-[11px]">
                                  <GridPylonIcon className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                                  <span className="text-muted-foreground truncate">{mLabel}</span>
                                </span>
                              </td>
                              {/* Reading */}
                              <td className="px-3 py-1 text-right font-mono-num text-blue-600 text-[11px]">
                                {curr != null ? fmtNum(curr) : '—'}
                              </td>
                              {/* Δ raw */}
                              <td className="px-3 py-1 text-right font-mono-num text-[11px]">
                                {isGridRepl
                                  ? <span className="text-orange-500 font-medium">0</span>
                                  : rawDelta != null ? fmtNum(rawDelta) : '—'
                                }
                              </td>
                              {/* × multiplier */}
                              <td className="px-2 py-1 text-center font-mono-num text-slate-500 text-[10px]">
                                {mMult !== 1 ? `×${mMult}` : '×1'}
                              </td>
                              {/* Effective kWh */}
                              <td className={[
                                'px-3 py-1 text-right font-mono-num font-medium text-[11px]',
                                effective != null && effective < 0 ? 'text-destructive' : 'text-blue-700 dark:text-blue-400',
                              ].join(' ')}>
                                {effective != null ? fmtNum(effective) : '—'}
                              </td>
                              {/* Grid Repl. toggle — only on first meter; shared flag applies to all */}
                              <td className="px-2 py-1 text-center">
                                {mi === 0 && (
                                  <button
                                    title={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                                    disabled={isDeleting || isTogglingGrid}
                                    onClick={() => toggleGridReplacement(r)}
                                    className={[
                                      'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                      'disabled:opacity-40 disabled:cursor-not-allowed',
                                      isGridRepl
                                        ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                                        : 'border-input bg-background hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20',
                                    ].join(' ')}
                                  >
                                    {isTogglingGrid
                                      ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                      : isGridRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                                    }
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* ── Solar sub-row (only when plant has solar data) ── */}
                        {hasSolar && (
                          <tr className="hover:bg-muted/30">
                            {canEditDelete && <td />}
                            {/* Meter label */}
                            <td className="px-3 py-1 pl-6">
                              <span className="flex items-center gap-1 text-[11px]">
                                <span className="text-yellow-500 text-xs leading-none">☀</span>
                                <span className="text-muted-foreground">Solar</span>
                              </span>
                            </td>
                            {/* Reading */}
                            <td className="px-3 py-1 text-right font-mono-num text-yellow-600 text-[11px]">
                              {r.solar_meter_reading != null ? fmtNum(r.solar_meter_reading) : '—'}
                            </td>
                            {/* Δ Solar */}
                            <td className="px-3 py-1 text-right font-mono-num text-[11px]">
                              {isSolarRepl
                                ? <span className="text-orange-500 font-medium">0</span>
                                : (predecessor?.solar_meter_reading != null && r.solar_meter_reading != null)
                                  ? <span className="text-yellow-600">{fmtNum(r.solar_meter_reading - predecessor.solar_meter_reading)}</span>
                                  : r.daily_solar_kwh != null && +r.daily_solar_kwh > 0
                                    ? <span className="text-yellow-600">{fmtNum(+r.daily_solar_kwh)}</span>
                                    : '—'
                              }
                            </td>
                            {/* × — n/a for solar */}
                            <td />
                            {/* Effective — n/a for solar (no multiplier) */}
                            <td />
                            {/* Solar Repl. toggle */}
                            <td className="px-2 py-1 text-center">
                              <button
                                title={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
                                disabled={isDeleting || isTogglingSolar}
                                onClick={() => toggleSolarReplacement(r)}
                                className={[
                                  'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                                  'disabled:opacity-40 disabled:cursor-not-allowed',
                                  isSolarRepl
                                    ? 'bg-yellow-500 border-yellow-500 text-white hover:bg-yellow-600'
                                    : 'border-input bg-background hover:border-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/20',
                                ].join(' ')}
                              >
                                {isTogglingSolar
                                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                  : isSolarRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                                }
                              </button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  }

                  // ── Non-power modules: original single-tr rendering ──
                  return (
                    <tr
                      key={r.id ?? i}
                      className={[
                        'border-t',
                        isEditing      ? 'bg-teal-50/60 dark:bg-teal-950/20'
                        : isMeterReplacement ? 'bg-orange-50/40 dark:bg-orange-950/10'
                        : 'hover:bg-muted/40',
                      ].join(' ')}
                    >
                      {canEditDelete && (
                        <td className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-teal-700 cursor-pointer"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                          />
                        </td>
                      )}
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {dateStr}
                          {isMeterReplacement && (
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded leading-none">
                              repl.
                            </span>
                          )}
                        </span>
                      </td>

                      {module === 'locator' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-orange-500 font-medium">0</span>
                            : predecessor != null ? fmtNum(r.current_reading - predecessor.current_reading) : '—'
                          }
                        </td>
                        {replCell}
                        <td className="px-3 py-1.5">
                          {r.off_location_flag && <span className="text-amber-600 font-medium">off-loc</span>}
                        </td>
                      </>}

                      {module === 'well' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.current_reading)}</td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {isMeterReplacement
                            ? <span className="text-orange-500 font-medium">0</span>
                            : predecessor != null ? fmtNum(r.current_reading - predecessor.current_reading) : '—'
                          }
                        </td>
                        {replCell}
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.power_meter_reading != null ? fmtNum(r.power_meter_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.tds_ppm != null ? fmtNum(r.tds_ppm) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">
                          {r.pressure_psi != null ? fmtNum(r.pressure_psi) : '—'}
                        </td>
                      </>}

                      {module === 'blending' && <>
                        <td className="px-3 py-1.5 text-right font-mono-num text-muted-foreground">
                          {r.raw_meter_reading != null ? fmtNum(r.raw_meter_reading) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono-num">{fmtNum(r.volume_m3 ?? 0)}</td>
                        {replCell}
                      </>}

                      {canEditDelete && (
                        <td className="px-2 py-1 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              title="Edit"
                              disabled={!!editRow || isDeleting}
                              onClick={() => startEdit(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            {pendingDeleteId === r.id ? (
                              <>
                                <button title="Confirm delete" onClick={() => deleteRow(r.id)}
                                  className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-[10px] font-semibold leading-none">
                                  Yes
                                </button>
                                <button title="Cancel" onClick={() => setPendingDeleteId(null)}
                                  className="px-1.5 py-0.5 rounded hover:bg-muted text-muted-foreground text-[10px] leading-none">
                                  No
                                </button>
                              </>
                            ) : (
                              <button
                                title="Delete"
                                disabled={!!editRow || isDeleting}
                                onClick={() => deleteRow(r.id)}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40"
                              >
                                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          {days === 'custom'
            ? `Showing ${appliedFrom} → ${appliedTo}`
            : `Showing up to ${days} days of history`
          } · {rows?.length ?? 0} records
        </p>
      </DialogContent>
    </Dialog>
  );
}
