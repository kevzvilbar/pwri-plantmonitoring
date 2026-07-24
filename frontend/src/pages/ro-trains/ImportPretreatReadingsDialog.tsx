/**
 * ro-trains/ImportPretreatReadingsDialog.tsx
 *
 * CSV import dialog for Pre-Treatment Readings.
 * Mirrors ImportROReadingsDialog but targets ro_pretreatment_readings via the
 * flat-wide CSV format defined in pretreat-csv.ts.
 *
 * Includes provenance logging (Piece 2) and optional trainId/dateRange scoping
 * for gap-fill use from TrainLogModal (Piece 3).
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, FileText, AlertCircle, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { downloadCSV } from '@/lib/csv';

import {
  parsePretreatCSVText, validatePretreatRow,
  PRETREAT_SCHEMA, PRETREAT_TEMPLATE_ROW,
} from './pretreat-csv';
import { insertPretreatReadings, type PretreatConflictMode } from './submitPretreatReadings';
import { logReadingEdit } from './helpers';

interface ImportPretreatReadingsDialogProps {
  plantId: string;
  userId: string | null;
  /**
   * When set (called from TrainLogModal), all rows are attributed to this
   * train and the per-row train_number lookup is bypassed.
   */
  trainId?: string;
  /** Display label for the pre-scoped train (e.g. "Train 2 · RO2"). */
  trainLabel?: string;
  /**
   * When set (gap-scoped mode), rows outside this window are rejected
   * before any write attempt.
   */
  dateRange?: { start: string; end: string };
  onClose: () => void;
  onImported: () => void;
}

export function ImportPretreatReadingsDialog({
  plantId,
  userId,
  trainId,
  trainLabel,
  dateRange,
  onClose,
  onImported,
}: ImportPretreatReadingsDialogProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile]                   = useState<File | null>(null);
  const [rows, setRows]                   = useState<Record<string, string>[]>([]);
  const [errors, setErrors]               = useState<string[]>([]);
  const [busy, setBusy]                   = useState(false);
  const [done, setDone]                   = useState(false);
  const [imported, setImported]           = useState(0);
  const [skippedCount, setSkippedCount]   = useState(0);
  const [importErrors, setImportErrors]   = useState<string[]>([]);

  type ConflictState = 'none' | 'pending';
  const [conflictState, setConflictState] = useState<ConflictState>('none');

  const isScoped = !!trainId;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setDone(false); setErrors([]); setRows([]); setImportErrors([]);
    setConflictState('none');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parsePretreatCSVText(ev.target?.result as string);
      const errs: string[] = [];
      parsed.forEach((r, i) => {
        const rowErrors = validatePretreatRow(r, i + 2);
        errs.push(
          ...rowErrors.filter((err) =>
            isScoped ? !err.includes('train_number') : true,
          ),
        );
      });
      setRows(parsed);
      setErrors(errs);
    };
    reader.readAsText(f);
  };

  const runImport = async (targetRows: Record<string, string>[], mode: PretreatConflictMode) => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    setBusy(true);
    const { count, skipped, errors: insertErrs, affectedTrainIds } = await insertPretreatReadings(
      targetRows, plantId, userId,
      {
        conflictMode:    mode,
        trainIdOverride: trainId,
        dateRange,
      },
    );
    setBusy(false);
    setImported(prev => prev + count);
    setSkippedCount(skipped);
    setImportErrors(insertErrs);

    // Provenance log — best-effort, never blocks the primary write
    if (count > 0) {
      logReadingEdit({
        table_name:    'ro_pretreatment_readings',
        record_id:     null,
        plant_id:      plantId,
        train_id:      trainId ?? (affectedTrainIds[0] ?? null),
        action:        'import',
        actor_user_id: userId,
        actor_label:   null,
        changes: {
          source:        'csv_import',
          filename:      file?.name ?? 'unknown.csv',
          row_count:     count,
          conflict_mode: mode,
          ...(trainId   ? { train_id_override: trainId }  : {}),
          ...(dateRange ? { gap_window:        dateRange } : {}),
        },
      });
    }

    if (skipped > 0 && mode === 'skip') {
      setConflictState('pending');
      setDone(true);
    } else {
      setConflictState('none');
      setDone(true);
      if (insertErrs.length) toast.error(`${count} imported, ${insertErrs.length} failed`);
      else if (count === 0 && skipped === 0) toast.info('No rows imported.');
      else toast.success(`${count} pre-treatment reading(s) imported${skipped > 0 ? `, ${skipped} skipped` : ''}`);
      if (count > 0) onImported();
    }
  };

  const doImport       = () => runImport(rows, 'skip');
  const doOverwriteAll = () => { setDone(false); setImported(0); runImport(rows, 'overwrite'); };
  const doSkipAll      = () => { setConflictState('none'); toast.info(`${skippedCount} duplicate(s) skipped.`); };

  const canSubmit = !busy && !!file && rows.length > 0 && errors.length === 0
    && conflictState === 'none' && !done;

  // Preview columns: show a condensed subset to avoid an extremely wide table
  const PREVIEW_COLS = [
    'train_number', 'reading_datetime', 'hpp_target_psi',
    'afm1_in_psi', 'afm1_out_psi',
    'booster1_hz', 'bag_filters_changed', 'remarks',
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Pre-Treatment Readings from CSV
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Scoped-train badge */}
          {isScoped && (
            <div className="rounded-md border border-teal-300 dark:border-teal-700 bg-teal-50/70 dark:bg-teal-950/30 p-3 flex items-start gap-2">
              <Lock className="h-3.5 w-3.5 text-teal-700 dark:text-teal-300 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-teal-800 dark:text-teal-200">
                  Scoped to {trainLabel ?? 'this train'}
                </p>
                <p className="text-[11px] text-teal-700 dark:text-teal-400 leading-relaxed">
                  All rows will be written to this train regardless of the{' '}
                  <code className="text-[10px] bg-muted px-1 rounded">train_number</code> column in your CSV.
                </p>
              </div>
            </div>
          )}

          {/* Date-range constraint */}
          {dateRange && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" /> Gap window — rows outside this range will be skipped
              </p>
              <p className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                {dateRange.start} → {dateRange.end}
              </p>
            </div>
          )}

          {/* Shape note — pretreatment-specific */}
          <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-1">
            <p className="text-xs font-semibold text-blue-800 dark:text-blue-200">Wide flat format</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-400 leading-relaxed">
              The template uses numbered columns (afm1_in_psi, afm2_in_psi…) up to the maximum.
              Leave columns blank for units your train doesn't have — they will be omitted automatically.
              Backwash datetimes (<code className="text-[10px] bg-muted px-1 rounded">afm1_bw_start</code>,{' '}
              <code className="text-[10px] bg-muted px-1 rounded">afm1_bw_end</code>) are optional.
            </p>
          </div>

          {/* Template download */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Button
              size="sm" variant="outline" className="shrink-0 gap-1.5"
              onClick={() => downloadCSV('pretreat_readings_template.csv', [PRETREAT_TEMPLATE_ROW])}
            >
              <Download className="h-3.5 w-3.5" /> Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>

          {/* Schema hint */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Expected columns:
            </p>
            <p className="text-[11px] font-mono text-foreground leading-relaxed break-all">{PRETREAT_SCHEMA}</p>
            <p className="text-[10px] text-muted-foreground">
              Columns marked <strong>*</strong> are required. Existing readings at the same minute are skipped.
            </p>
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Select CSV file <span className="text-destructive">*</span></Label>
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800 border-teal-700"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" /> Choose File
              </Button>
              <span className="text-xs text-muted-foreground">{file?.name ?? 'No file chosen'}</span>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
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

          {/* Condensed row preview (show only key columns to avoid overflow) */}
          {rows.length > 0 && errors.length === 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground font-medium">
                Preview — key columns (first {Math.min(rows.length, 5)} of {rows.length} rows):
              </p>
              <div className="overflow-x-auto rounded-md border text-[10px]">
                <table className="min-w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      {PREVIEW_COLS.filter((c) => rows[0] && c in rows[0]).map((h) => (
                        <th key={h} className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {PREVIEW_COLS.filter((c) => rows[0] && c in rows[0]).map((col, j) => (
                          <td key={j} className="px-2 py-1 whitespace-nowrap text-foreground max-w-[100px] truncate">{r[col] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Showing {PREVIEW_COLS.length} of {Object.keys(rows[0] ?? {}).length} columns — download the template to see all columns.
              </p>
            </div>
          )}

          {/* Conflict resolution UI */}
          {done && conflictState === 'pending' && skippedCount > 0 && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {skippedCount} duplicate{skippedCount !== 1 ? 's' : ''} found
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                    {imported > 0 && <>{imported} new row{imported !== 1 ? 's' : ''} imported. </>}
                    These readings already exist. What would you like to do?
                  </p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline"
                  className="text-xs border-amber-400 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                  disabled={busy} onClick={doSkipAll}>
                  Skip All
                </Button>
                {!dateRange && (
                  <Button size="sm"
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={busy} onClick={doOverwriteAll}>
                    {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Overwrite All
                  </Button>
                )}
              </div>
              {dateRange && (
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  Overwrite is disabled for a gap-window import — a duplicate found inside an
                  accepted window means the window doesn't match reality. Skip these and review
                  the conflicting readings directly before resolving.
                </p>
              )}
            </div>
          )}

          {/* Result */}
          {done && conflictState === 'none' && (
            <div className="space-y-2">
              <p className={`text-xs font-medium flex items-center gap-1.5 ${importErrors.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                <span className={`h-2 w-2 rounded-full inline-block ${importErrors.length > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                {imported} pre-treatment record(s) imported
                {skippedCount > 0 ? `, ${skippedCount} skipped` : ''}
                {importErrors.length > 0 ? `, ${importErrors.length} failed` : ''}.
              </p>
              {importErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 max-h-40 overflow-y-auto">
                  <p className="text-[11px] font-semibold text-destructive mb-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Issues (first {Math.min(importErrors.length, 20)}):
                  </p>
                  <ul className="text-[10px] text-destructive list-disc ml-3 space-y-0.5">
                    {importErrors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          {conflictState !== 'pending' && (
            <Button
              onClick={doImport}
              disabled={!canSubmit}
              className="bg-teal-700 text-white hover:bg-teal-800"
            >
              {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
