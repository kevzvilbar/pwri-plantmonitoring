import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, Lock, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  parseCSVText,
  triggerTemplateDownload,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  setBulkDupDecision,
  resolveDupPrompt,
  setDupShowPrompt,
  clearDupShowPrompt,
  logReadingImport,
} from '@/components/ReadingImportDialog/utils';
import { DupConfirmDialog } from '@/components/ReadingImportDialog/DuplicateConfirmDialog';
import type { CsvImportDialogProps, CsvColumnDef } from './types';

export function CsvImportDialog({
  title,
  module = 'general',
  plantId,
  userId,
  schemaHint,
  columns,
  templateFilename,
  templateRow,
  templateRows,
  helpText,
  parseCSV = parseCSVText,
  validateRow,
  insertRows,
  scopedMeta,
  conflictMode = 'prompt',
  showPreviewTable = false,
  onClose,
  onImported,
}: CsvImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [imported, setImported] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [dupConfirm, setDupConfirm] = useState<{ label: string; isDateOnly: boolean } | null>(null);
  const [conflictChoice, setConflictChoice] = useState<'overwrite' | 'skip'>('skip');

  useEffect(() => {
    if (conflictMode === 'prompt') {
      setDupShowPrompt((label, isDateOnly) => setDupConfirm({ label, isDateOnly }));
      return () => { clearDupShowPrompt(); };
    }
    return undefined;
  }, [conflictMode]);

  const handleDupDecision = (decision: 'overwrite' | 'skip', applyToAll = false) => {
    if (applyToAll) {
      setBulkDupDecision(decision);
    }
    setDupConfirm(null);
    resolveDupPrompt(decision);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setDone(false);
    setErrors([]);
    setRows([]);
    setImportErrors([]);
    setSkippedCount(0);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target?.result as string);
        const errs: string[] = [];
        if (validateRow) {
          parsed.forEach((r, i) => {
            const rErrs = validateRow(r, i + 2);
            errs.push(...rErrs);
          });
        }
        setRows(parsed);
        setErrors(errs);
      } catch (err: any) {
        setErrors([`CSV parse error: ${err?.message || 'Invalid format'}`]);
      }
    };
    reader.readAsText(f);
  };

  const executeImport = async (targetMode: 'overwrite' | 'skip' = conflictChoice) => {
    if (!plantId) {
      toast.error('Select a plant first');
      return;
    }
    if (!file || rows.length === 0 || errors.length > 0) return;

    setBusy(true);
    clearDupDecisions();
    clearBulkDupDecision();

    // Check intra-file duplicates if module is applicable
    let validRows = rows;
    if (module && module !== 'general') {
      const intraDups = computeIntraFileDuplicateIndices(rows, module);
      if (intraDups.length > 0) {
        validRows = rows.filter((_, i) => !intraDups.includes(i));
      }
    }

    try {
      const result = await insertRows(validRows, plantId, {
        conflictMode: targetMode,
        scopedMeta,
      });

      const count = result.count ?? 0;
      const skipped = result.skipped ?? 0;
      const errs = result.errors ?? [];

      setImported(count);
      setSkippedCount(skipped);
      setImportErrors(errs);
      setDone(true);

      await logReadingImport({
        user_id: userId ?? null,
        plant_id: plantId,
        module,
        file_name: file.name,
        row_count: validRows.length,
        schema_valid: errs.length === 0,
        schema_errors: errs,
        timestamp: new Date().toISOString(),
      });

      if (errs.length === 0) {
        const msg = skipped > 0
          ? `Imported ${count} row(s) (${skipped} skipped)`
          : `Successfully imported ${count} row(s)`;
        toast.success(msg);
        onImported();
      } else {
        toast.warning(`Imported ${count} row(s) with ${errs.length} issue(s)`);
      }
    } catch (err: any) {
      setImportErrors([err?.message || 'Import operation failed']);
    } finally {
      setBusy(false);
    }
  };

  const sampleRow = templateRow || (templateRows && templateRows[0]) || {};
  const headerKeys = columns
    ? columns.map((c) => (typeof c === 'string' ? c : c.key))
    : Object.keys(sampleRow);

  const displaySchemaHint = schemaHint || (
    columns
      ? columns
          .map((c) => {
            if (typeof c === 'string') return c;
            return `${c.label || c.key}${c.required ? '*' : ''}`;
          })
          .join(', ')
      : headerKeys.join(', ')
  );

  const canSubmit = !busy && !done && file !== null && rows.length > 0 && errors.length === 0;

  return (
    <>
      <ResponsiveDialog
        open
        onOpenChange={(o) => {
          if (!o && !busy) onClose();
        }}
        title={(
          <span className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {title}
          </span>
        )}
        className="max-w-xl"
        footer={(
          <div className="flex gap-2 justify-end w-full">
            <Button variant="outline" onClick={onClose} disabled={!!dupConfirm || busy}>
              {done ? 'Close' : 'Cancel'}
            </Button>
            {!done && (
              <Button
                onClick={() => executeImport()}
                disabled={!canSubmit}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="confirm-import-btn"
              >
                {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
              </Button>
            )}
          </div>
        )}
      >
        <div className="space-y-4 pb-4">
          {/* Scoped train/date notice */}
          {scopedMeta?.trainLabel && (
            <div className="flex items-center gap-2 rounded-md bg-accent-soft/70 border border-accent/40 p-2.5 text-xs text-foreground">
              <Lock className="h-3.5 w-3.5 text-accent shrink-0" />
              <span>
                Scoped to <strong>{scopedMeta.trainLabel}</strong>
                {scopedMeta.dateRange && (
                  <> ({scopedMeta.dateRange.start.slice(0, 10)} to {scopedMeta.dateRange.end.slice(0, 10)})</>
                )}
              </span>
            </div>
          )}

          {/* Download template */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => triggerTemplateDownload(templateFilename, headerKeys, templateRows ?? sampleRow)}
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
            <p className="text-xs font-mono text-foreground leading-relaxed break-all">
              {displaySchemaHint}
            </p>
            <p className="text-2xs text-muted-foreground">
              Columns marked <strong>*</strong> are required. Dates accept ISO 8601 or <code>YYYY-MM-DD HH:mm</code>.
            </p>
            {helpText && (
              <div className="text-2xs text-muted-foreground pt-1">{helpText}</div>
            )}
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label htmlFor="csv-import-file-input" className="text-xs font-medium">
              Select CSV file <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Upload className="h-3.5 w-3.5" />
                Choose File
              </Button>
              <span className="text-xs text-muted-foreground">{file?.name ?? 'No file chosen'}</span>
            </div>
            <input
              ref={fileRef}
              id="csv-import-file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="hidden"
              data-testid="import-file-input"
            />
          </div>

          {/* Validation feedback */}
          {file && rows.length > 0 && !done && (
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

          {/* Preview Table */}
          {showPreviewTable && rows.length > 0 && !done && (
            <div className="border rounded-md max-h-48 overflow-auto text-xs">
              <table className="w-full border-collapse">
                <thead className="bg-muted/60 sticky top-0 border-b">
                  <tr>
                    {headerKeys.map((h) => (
                      <th key={h} className="p-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      {headerKeys.map((h) => (
                        <td key={h} className="p-1.5 whitespace-nowrap text-muted-foreground">
                          {r[h] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 10 && (
                <p className="p-1.5 text-2xs text-center text-muted-foreground bg-muted/20">
                  Showing 10 of {rows.length} rows
                </p>
              )}
            </div>
          )}

          {/* Import complete summary */}
          {done && (
            <div className="rounded-md border border-accent bg-accent-soft/70 p-3 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5 text-accent">
                <CheckCircle2 className="h-4 w-4" /> Import Complete
              </p>
              <p className="text-xs text-foreground">
                Successfully processed <strong>{imported}</strong> row(s).
                {skippedCount > 0 && <span> ({skippedCount} duplicate(s) skipped).</span>}
              </p>
              {importErrors.length > 0 && (
                <ul className="text-2xs text-destructive list-disc ml-4 space-y-0.5">
                  {importErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      </ResponsiveDialog>

      {/* Duplicate resolution prompt */}
      {dupConfirm && (
        <DupConfirmDialog
          open={!!dupConfirm}
          label={dupConfirm.label}
          isDateOnly={dupConfirm.isDateOnly}
          onDecision={handleDupDecision}
        />
      )}
    </>
  );
}
