import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';
import { ResponsiveDialog, ResponsiveAlertDialog } from '@/components/ui/responsive-dialog';
import {
  parseCSVText,
  triggerTemplateDownload,
  normalizeDatetime,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  setBulkDupDecision,
  resolveDupPrompt,
  resolveImportDuplicate,
  setDupShowPrompt,
  clearDupShowPrompt,
  logReadingImport,
} from '@/components/ReadingImportDialog/utils';
import { DupConfirmDialog } from '@/components/ReadingImportDialog/DuplicateConfirmDialog';

interface ImportDialogProps {
  title: string;
  module: string;
  plantId: string;
  userId: string | null;
  schemaHint: string;
  templateFilename: string;
  templateRow: Record<string, string>;
  templateRows?: Record<string, string>[];
  helpText?: React.ReactNode;
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
  const [dupRows, setDupRows] = useState<Record<string, string>[]>([]);
  const [dupResolved, setDupResolved] = useState(false);
  const [dupConfirm, setDupConfirm] = useState<{ label: string; isDateOnly: boolean } | null>(null);

  useEffect(() => {
    setDupShowPrompt((label, isDateOnly) => setDupConfirm({ label, isDateOnly }));
    return () => { clearDupShowPrompt(); };
  }, []);

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

      const intraDups = computeIntraFileDuplicateIndices(rows, module);

      if (intraDups.length > 0 && !dupResolved) {
        const uniqueRows = rows.filter((_r, i) => !intraDups.includes(i));
        setRows(uniqueRows);
        setDupResolved(true);
        return;
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
      if (count > 0) onImported();
    } catch (err) {
      console.error('[import] unexpected error during import:', err);
      toast.error('Import failed unexpectedly — see the browser console for details.');
    } finally {
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
            className="bg-primary text-primary-foreground hover:bg-primary/90"
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
                className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
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

    <DupConfirmDialog
      open={!!dupConfirm}
      label={dupConfirm?.label ?? ''}
      isDateOnly={dupConfirm?.isDateOnly ?? false}
      onDecision={handleDupDecision}
    />
    </>
  );
}

// Re-export utilities for backward compatibility
export {
  parseCSVLine,
  parseCSVText,
  triggerTemplateDownload,
  normalizeDatetime,
  computeIntraFileDuplicateIndices,
  clearDupDecisions,
  clearBulkDupDecision,
  resolveImportDuplicate,
  logReadingImport,
} from '@/components/ReadingImportDialog/utils';
