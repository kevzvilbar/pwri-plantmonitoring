import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import { Upload, Download, FileText, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { parseCSVText, triggerTemplateDownload, logBillingImport, clearBillingDupDecisions, clearBillingBulkDupDecision, setBillingDupPromptHandler, resolveBillingDupPrompt, setBillingBulkDupDecision } from './importHelpers';

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

export function ImportReadingsDialog({
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
    setBillingDupPromptHandler((label, isDateOnly) => setDupConfirm({ label, isDateOnly }));
    return () => { setBillingDupPromptHandler(null); };
  }, []);

  const handleDupDecision = (decision: 'overwrite' | 'skip', applyToAll = false) => {
    if (applyToAll) setBillingBulkDupDecision(decision);
    setDupConfirm(null);
    resolveBillingDupPrompt(decision);
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
              onClick={() => triggerTemplateDownload(templateFilename, Object.keys(templateRow), templateRow)}
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
              Columns marked <strong>*</strong> are required.{' '}
              <code>billing_month</code> accepts <code>YYYY-MM-DD</code> or <code>M/D/YYYY</code> — always stored as first of month.
            </p>
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label htmlFor="costs-select-csv-file" className="text-xs">
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
            id="costs-select-csv-file"/>
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
            <p className="text-xs text-accent font-medium flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent inline-block" />
              {imported} record(s) imported. Audit log written.
            </p>
          )}

          {done && importErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {imported} imported · {importErrors.length} failed
              </p>
              <ul className="text-2xs text-destructive list-disc ml-4 space-y-0.5 max-h-32 overflow-y-auto">
                {importErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* Intra-file duplicate notice */}
          {dupResolved && !done && (
            <div className="rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Duplicate billing months within the file were removed — only the first occurrence is kept. Click <strong>Import Rows</strong> to proceed.</span>
            </div>
          )}

          {/* DB-level duplicate confirmation */}
          {dupConfirm && (
            <div className="rounded-md border border-warn bg-warn-soft p-3 space-y-2">
              <p className="text-xs font-semibold text-warn flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Duplicate detected
              </p>
              <p className="text-xs text-warn">
                A bill for <strong>"{dupConfirm.label}"</strong> already exists{' '}
                {dupConfirm.isDateOnly ? 'for this billing month' : 'at this date'}.
                Overwrite it, or skip this row?
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs" onClick={() => handleDupDecision('overwrite')}>Overwrite</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip')}>Skip</Button>
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs" onClick={() => handleDupDecision('overwrite', true)} title="Overwrite this and all remaining duplicates">Overwrite All</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip', true)} title="Skip this and all remaining duplicates">Skip All</Button>
              </div>
            </div>
          )}
        </div>
    </ResponsiveDialog>
  );
}
