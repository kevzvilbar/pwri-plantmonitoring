import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
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
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';
import { ResponsiveDialog, ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

export function parseCSVLine(line: string): string[] {
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

export function parseCSVText(text: string): Record<string, string>[] {
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

export function triggerTemplateDownload(filename: string, headers: string[], exampleRows: Record<string, string> | Record<string, string>[]) {
  downloadCSV(filename, Array.isArray(exampleRows) ? exampleRows : [exampleRows]);
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
export function normalizeDatetime(raw: string): string {
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

// ─── Intra-file duplicate detection ─────────────────────────────────────────
// Power readings are one-per-day-per-meter: key = plant|meter|YYYY-MM-DD, so
// two rows on the same date but different times are still caught as dups.
// All other modules: key = entityName|YYYY-MM-DDTHH:mm so rows with the
// same datetime but a DIFFERENT well/locator/blending name are NOT deduped.
//
// FIX (multi-meter CSV import): the power key used to be just plant|date,
// with no meter_name component. A multi-meter plant's CSV — one row per
// meter, same plant_name, same reading_datetime, different meter_name — all
// collapsed onto that one key, so rows for meter 2 and meter 3 were flagged
// as "duplicate rows within the file" and silently dropped right here,
// before insertRows ever saw them. Doesn't matter how correctly meter_name
// is filled in, or how correct the resolution logic downstream is — the
// rows never arrive. Including meter_name in the key fixes it: rows only
// collide now if they'd actually target the same meter.
//
// FIX: call normalizeDatetime() before slicing so non-standard formats like
// "2026-06-25T8:00" (single-digit hour, common in Excel exports) are fixed
// to "2026-06-25T08:00" first. Without this, two rows meant to be the same
// moment could fail to collide (or vice versa) purely due to formatting.
//
// BUG FIX (timezone day-rollback): slices the key straight from the
// normalized "YYYY-MM-DDTHH:mm" string, not from `new Date(...).toISOString()`
// — that conversion to UTC first would shift any Manila (UTC+8) reading
// between 12:00–7:59 AM local onto the *previous* calendar day, colliding
// genuinely different rows (or missing a real duplicate).
export function computeIntraFileDuplicateIndices(rows: Record<string, string>[], module: string): number[] {
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
    } else {
      const dtNorm = normalizeDatetime(dtRaw);
      dtKey = isPowerModule ? dtNorm.slice(0, 10) : dtNorm.slice(0, 16);
    }
    // All modules: key = "entityName|dtKey" — different names are allowed at the same datetime.
    // Power uses plant_name as its entity name (from the CSV column), PLUS
    // meter_name, so distinct meters on the same plant+date don't collide.
    const powerName = isPowerModule ? (r.plant_name || '').trim().toLowerCase() : '';
    const powerMeter = isPowerModule ? (r.meter_name || '').trim().toLowerCase() : '';
    const key = isPowerModule ? `${powerName}|${powerMeter}|${dtKey}` : `${entityName}|${dtKey}`;
    if (seenKeys.has(key)) intraDups.push(i);
    else seenKeys.set(key, i);
  });
  return intraDups;
}

// ─── Duplicate check helper for CSV imports ──────────────────────────────────
// Uses a per-import-session cache so we only ask once per unique key.
// The actual prompt is driven by React state (see ImportReadingsDialog) via a
// Promise resolver — avoids window.confirm which is blocked in iframes.
const _dupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();
export function clearDupDecisions() { _dupDecisions.clear(); }

// Set by ImportReadingsDialog before each import run; resolved by the in-dialog confirm UI.
let _dupPromptResolver: ((decision: 'overwrite' | 'skip') => void) | null = null;
let _dupShowPrompt: ((label: string, isDateOnly: boolean) => void) | null = null;
// When the user chooses "Overwrite All" or "Skip All", this is set so subsequent
// duplicates are resolved immediately without prompting again.
let _bulkDupDecision: 'overwrite' | 'skip' | null = null;
export function clearBulkDupDecision() { _bulkDupDecision = null; }

export async function resolveImportDuplicate(key: string, label: string, isDateOnly = false): Promise<'overwrite' | 'skip'> {
  if (_dupDecisions.has(key)) return _dupDecisions.get(key)!;
  if (_bulkDupDecision) {
    _dupDecisions.set(key, _bulkDupDecision);
    return _bulkDupDecision;
  }
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _dupPromptResolver = resolve;
    _dupShowPrompt?.(label, isDateOnly);
  });
  _dupDecisions.set(key, decision);
  return decision;
}

interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;           // shown in the dialog
  templateFilename: string;
  templateRow: Record<string, string>;
  templateRows?: Record<string, string>[]; // optional multi-row example (e.g. one row per meter); falls back to [templateRow]
  helpText?: React.ReactNode;   // optional extra line shown under the standard column-format note
  validateRow: (r: Record<string, string>, i: number) => string[];
  insertRows: (rows: Record<string, string>[], plantId: string) => Promise<{ count: number; errors: string[] }>;
  onClose: () => void;
  onImported: () => void;
}

export function ImportReadingsDialog({
  title, module, plantId, userId,
  schemaHint, templateFilename, templateRow, templateRows, helpText,
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
    try {
      clearDupDecisions();
      clearBulkDupDecision();
      const ts = new Date().toISOString();

      // ── Duplicate detection ──────────────────────────────────────────────────
      const intraDups = computeIntraFileDuplicateIndices(rows, module);

      // If intra-file duplicates exist, warn and block
      if (intraDups.length > 0 && !dupResolved) {
        // Keep only first occurrence of each key, then let user confirm by clicking Import again
        const uniqueRows = rows.filter((_r, i) => !intraDups.includes(i));
        setRows(uniqueRows);
        setDupResolved(true);
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
    } catch (err) {
      // Safety net: if any unexpected error escapes (e.g. a future RangeError from
      // a new date field), surface it as a toast rather than leaving the spinner
      // frozen forever with no feedback.
      console.error('[import] unexpected error during import:', err);
      toast.error('Import failed unexpectedly — see the browser console for details.');
    } finally {
      // Guaranteed to run regardless of early return, normal exit, or thrown error —
      // this is the single source of truth for clearing the busy state.
      setBusy(false);
    }
  };

  const canSubmit = !busy && !!file && rows.length > 0 && errors.length === 0;

  return (
    <>
    <ResponsiveDialog
      open
      onOpenChange={(o) => { if (!o && !busy) onClose(); }}
      title={(
        <span className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {title}
        </span>
      )}
      className="max-w-lg"
      footer={(
        <div className="flex gap-2 justify-end w-full">
          <Button variant="outline" onClick={onClose} disabled={!!dupConfirm}>Cancel</Button>
          <Button
            onClick={doImport}
            disabled={!canSubmit}
            className="bg-primary text-white hover:bg-primary/90"
            data-testid="confirm-import-btn"
          >
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
          </Button>
        </div>
      )}
    >
        <div className="space-y-4 pb-4">

          {/* Download template */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => triggerTemplateDownload(templateFilename, Object.keys(templateRow), templateRows ?? templateRow)}
            >
              <Download className="h-3.5 w-3.5" />
              Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>

          {/* Schema reference */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Expected columns:
            </p>
            <p className="text-xs font-mono text-foreground leading-relaxed break-all">{schemaHint}</p>
            <p className="text-2xs text-muted-foreground">
              Columns marked <strong>*</strong> are required. <code>reading_datetime</code> accepts
              ISO 8601 format (e.g. <code>2024-06-15T08:30</code>) or <code>YYYY-MM-DD HH:mm</code>.
              Leave blank to default to the import timestamp.
            </p>
            {helpText && (
              <p className="text-2xs text-muted-foreground">{helpText}</p>
            )}
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label htmlFor="readingimportdialog-select-csv-file" className="text-xs">
              Select CSV file <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-primary text-white hover:bg-primary/90 border-primary"
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
            id="readingimportdialog-select-csv-file"/>
          </div>

          {/* Validation feedback */}
          {file && rows.length > 0 && (
            <div className={`rounded-md border p-3 space-y-2 ${
              errors.length > 0
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-accent bg-accent-soft'
            }`}>
              <p className="text-xs font-medium flex items-center gap-1.5">
                {errors.length === 0
                  ? <><span className="h-2 w-2 rounded-full bg-accent inline-block" />{rows.length} row(s) in "{file.name}" — schema valid</>
                  : <><AlertTriangle className="h-3.5 w-3.5 text-destructive" />{rows.length} row(s) — {errors.length} error(s)</>
                }
              </p>
              {errors.length > 0 && (
                <ul className="text-2xs text-destructive list-disc ml-4 space-y-0.5 max-h-28 overflow-y-auto">
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
              <p className="text-xs text-muted-foreground font-medium">
                Preview (first {Math.min(rows.length, 5)} of {rows.length} rows):
              </p>
              <div className="overflow-x-auto rounded-md border text-2xs">
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
              <p className={`text-xs font-medium flex items-center gap-1.5 ${importErrors.length > 0 ? 'text-warn' : 'text-accent'}`}>
                <span className={`h-2 w-2 rounded-full inline-block ${importErrors.length > 0 ? 'bg-warn' : 'bg-accent'}`} />
                {imported} record(s) imported{importErrors.length > 0 ? `, ${importErrors.length} failed` : ''}. Audit log written.
              </p>
              {importErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-destructive mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Import errors (first {Math.min(importErrors.length, 20)} of {importErrors.length}):
                  </p>
                  <ul className="text-2xs text-destructive list-disc ml-3 space-y-0.5">
                    {importErrors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Intra-file duplicate notice (shown after dedup, before re-import) */}
          {dupResolved && !done && (
            <div className="rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Duplicate rows within the file were removed — only the first occurrence of each date is kept. Click <strong>Import Rows</strong> to proceed.</span>
            </div>
          )}

        </div>
    </ResponsiveDialog>

    {/* DB-level duplicate confirmation (replaces window.confirm). A second,
        independent dialog stacked on top of the import dialog above — must
        stay explicit-choice-only (no Escape, no outside click, no swipe),
        same guarantee AlertDialog gave it on desktop. */}
    <ResponsiveAlertDialog
      open={!!dupConfirm}
      onOpenChange={() => { /* explicit-choice only — see handleDupDecision */ }}
      preventEscapeClose
      title={(
        <span className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-warn" /> Duplicate detected
        </span>
      )}
      description={(
        <>
          A reading for "{dupConfirm?.label}" already exists{' '}
          {dupConfirm?.isDateOnly ? 'on this date' : 'at this date & time'}.
          Overwrite it, or skip this row?
        </>
      )}
      footer={(
        <div className="flex gap-2 flex-wrap justify-end w-full">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => handleDupDecision('skip', true)}
            title="Skip this and all remaining duplicates"
          >
            Skip All
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
            className="h-7 text-xs bg-primary text-white hover:bg-primary/90"
            onClick={() => handleDupDecision('overwrite', true)}
            title="Overwrite this and all remaining duplicates"
          >
            Overwrite All
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-primary text-white hover:bg-primary/90"
            onClick={() => handleDupDecision('overwrite')}
          >
            Overwrite
          </Button>
        </div>
      )}
    >
      {null}
    </ResponsiveAlertDialog>
    </>
  );
}

// ─── Per-module CSV configs ──────────────────────────────────────────────────

// Locator readings:
// locator_name*, current_reading*, reading_datetime, previous_reading, input_mode, daily_volume
// input_mode: "raw" (default — cumulative meter reading) | "direct" (daily m³ entered directly)
// When input_mode=direct, supply daily_volume instead of current_reading; current_reading can be blank.
