import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
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
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';

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

export function triggerTemplateDownload(filename: string, headers: string[], exampleRow: Record<string, string>) {
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

export function ImportReadingsDialog({
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
