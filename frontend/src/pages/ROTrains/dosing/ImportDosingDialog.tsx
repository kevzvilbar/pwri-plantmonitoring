import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Upload, Download, FileText, AlertCircle, Loader2 } from 'lucide-react';

import { validateDosingRow } from './validateDosingRow';

// ─── Chemical Dosing CSV Import ──────────────────────────────────────────────
const DOSING_CSV_SCHEMA =
  'plant_name*, log_datetime (YYYY-MM-DDTHH:mm), chlorine_kg, smbs_kg, anti_scalant_l, ' +
  'soda_ash_kg, free_chlorine_reagent_pcs, remarks';

const DOSING_TEMPLATE_ROW: Record<string, string> = {
  plant_name: 'Umapad',
  log_datetime: '2024-06-15T08:30',
  chlorine_kg: '1.5',
  smbs_kg: '',
  anti_scalant_l: '2.0',
  soda_ash_kg: '',
  free_chlorine_reagent_pcs: '2',
  remarks: '',
};
// Module-level resolver hooks (same pattern as Operations.tsx)
let _dosingDupPromptResolver: ((decision: 'overwrite' | 'skip') => void) | null = null;
let _dosingDupShowPrompt: ((label: string) => void) | null = null;
let _dosingBulkDecision: 'overwrite' | 'skip' | null = null;
const _dosingDupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();

async function resolveDosingDuplicate(key: string, label: string): Promise<'overwrite' | 'skip'> {
  if (_dosingDupDecisions.has(key)) return _dosingDupDecisions.get(key)!;
  if (_dosingBulkDecision) { _dosingDupDecisions.set(key, _dosingBulkDecision); return _dosingBulkDecision; }
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _dosingDupPromptResolver = resolve;
    _dosingDupShowPrompt?.(label);
  });
  _dosingDupDecisions.set(key, decision);
  return decision;
}

export function ImportDosingDialog({
  plantId,
  userId,
  onClose,
  onImported,
}: {
  plantId: string;
  userId: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile]           = useState<File | null>(null);
  const [rows, setRows]           = useState<Record<string, string>[]>([]);
  const [errors, setErrors]       = useState<string[]>([]);
  const [busy, setBusy]           = useState(false);
  const [done, setDone]           = useState(false);
  const [imported, setImported]   = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [dupConfirm, setDupConfirm] = useState<string | null>(null);
  const [dupResolved, setDupResolved] = useState(false);

  const { data: plants } = usePlants();

  useEffect(() => {
    _dosingDupShowPrompt = (label) => setDupConfirm(label);
    return () => { _dosingDupShowPrompt = null; _dosingDupPromptResolver = null; };
  }, []);

  const handleDupDecision = (decision: 'overwrite' | 'skip', applyAll = false) => {
    if (applyAll) _dosingBulkDecision = decision;
    setDupConfirm(null);
    _dosingDupPromptResolver?.(decision);
    _dosingDupPromptResolver = null;
  };

  const parseFile = (text: string) => {
    const clean = text.replace(/^\uFEFF/, '').trim();
    const lines = clean.split(/\r?\n/);
    if (lines.length < 2) return [];
    const parseL = (line: string): string[] => {
      const fields: string[] = []; let i = 0; const len = line.length;
      while (i < len) {
        if (line[i] === '"') {
          i++; let val = '';
          while (i < len) {
            if (line[i] === '"' && line[i+1] === '"') { val += '"'; i += 2; }
            else if (line[i] === '"') { i++; break; }
            else { val += line[i++]; }
          }
          fields.push(val.trim());
          if (i < len && line[i] === ',') i++;
        } else {
          const start = i;
          while (i < len && line[i] !== ',') i++;
          fields.push(line.slice(start, i).trim());
          if (i < len && line[i] === ',') i++;
        }
      }
      if (len > 0 && line[len-1] === ',') fields.push('');
      return fields;
    };
    const headers = parseL(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseL(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setDone(false); setErrors([]); setRows([]); setDupResolved(false); setImportErrors([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseFile(ev.target?.result as string);
      const errs: string[] = [];
      parsed.forEach((r, i) => errs.push(...validateDosingRow(r, i + 2)));
      setRows(parsed); setErrors(errs);
    };
    reader.readAsText(f);
  };

  const doImport = async () => {
    if (!file || rows.length === 0 || errors.length > 0) return;
    setBusy(true);
    _dosingDupDecisions.clear(); _dosingBulkDecision = null;

    // Intra-file duplicate detection by plant+datetime
    const seenKeys = new Map<string, number>();
    const intraDups: number[] = [];
    rows.forEach((r, i) => {
      const key = `${r.plant_name?.trim().toLowerCase()}|${r.log_datetime?.trim()}`;
      if (seenKeys.has(key)) intraDups.push(i);
      else seenKeys.set(key, i);
    });
    if (intraDups.length > 0 && !dupResolved) {
      setRows(rows.filter((_, i) => !intraDups.includes(i)));
      setDupResolved(true); setBusy(false); return;
    }

    let count = 0; const errs: string[] = [];
    for (const r of rows) {
      // Resolve plant_name → plant_id
      const plant = plants?.find(p => p.name.toLowerCase() === r.plant_name?.trim().toLowerCase());
      if (!plant) { errs.push(`Plant not found: "${r.plant_name}"`); continue; }
      const pid = plant.id;

      const dt = r.log_datetime?.trim()
        ? new Date(r.log_datetime.replace(' ', 'T')).toISOString()
        : new Date().toISOString();
      const dtMin = dt.slice(0, 16);

      // Duplicate check
      const { data: existing } = await supabase
        .from('chemical_dosing_logs')
        .select('id')
        .eq('plant_id', pid)
        .gte('log_datetime', `${dtMin}:00`)
        .lte('log_datetime', `${dtMin}:59`)
        .limit(1);
      const existingId = existing?.[0]?.id ?? null;

      if (existingId) {
        const key = `${pid}|${dtMin}`;
        const decision = await resolveDosingDuplicate(key, `${r.plant_name} @ ${r.log_datetime}`);
        if (decision === 'skip') continue;
      }

      const num = (k: string) => r[k]?.trim() ? +r[k] : 0;
      const payload: Record<string, any> = {
        plant_id: pid,
        log_datetime: dt,
        chlorine_kg: num('chlorine_kg'),
        smbs_kg: num('smbs_kg'),
        anti_scalant_l: num('anti_scalant_l'),
        soda_ash_kg: num('soda_ash_kg'),
        free_chlorine_reagent_pcs: num('free_chlorine_reagent_pcs'),
        recorded_by: userId,
      };
      if (r.remarks?.trim()) payload.remarks = r.remarks.trim();

      let opError: any;
      if (existingId) {
        const { error } = await supabase.from('chemical_dosing_logs').update(payload as any).eq('id', existingId);
        opError = error;
      } else {
        const { error } = await supabase.from('chemical_dosing_logs').insert(payload as any);
        opError = error;
      }
      if (opError) errs.push(opError.message); else count++;
    }

    setBusy(false); setImported(count); setDone(true); setImportErrors(errs);
    if (errs.length) toast.error(`${count} imported, ${errs.length} failed`);
    else if (count === 0) toast.info('No rows imported — all duplicates were skipped.');
    else { toast.success(`${count} dosing record(s) imported`); onImported(); }
  };

  const canSubmit = !busy && !!file && rows.length > 0 && errors.length === 0;

  return (
    <Dialog open onOpenChange={o => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" /> Import Chemical Dosing
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Download template */}
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5"
              onClick={() => {
                const headers = Object.keys(DOSING_TEMPLATE_ROW);
                const row = Object.values(DOSING_TEMPLATE_ROW);
                const csv = [headers.join(','), row.join(',')].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = 'chemical_dosing_template.csv'; a.click();
              }}>
              <Download className="h-3.5 w-3.5" /> Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>

          {/* Schema hint */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Expected columns:
            </p>
            <p className="text-xs font-mono text-foreground leading-relaxed break-all">{DOSING_CSV_SCHEMA}</p>
            <p className="text-2xs text-muted-foreground">
              Columns marked <strong>*</strong> are required. <code>log_datetime</code> accepts
              ISO 8601 (e.g. <code>2024-06-15T08:30</code>) or <code>YYYY-MM-DD HH:mm</code>.
              CIP-only chemicals (SLS, HCl, Caustic Soda) are <strong>not</strong> included — log those in the CIP tab.
            </p>
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">Select CSV file <span className="text-destructive">*</span></Label>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline"
                className="gap-1.5 bg-primary text-white hover:bg-primary/90 border-primary"
                onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Choose File
              </Button>
              <span className="text-xs text-muted-foreground">{file?.name ?? 'No file chosen'}</span>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
          </div>

          {/* Validation feedback */}
          {file && rows.length > 0 && (
            <div className={`rounded-md border p-3 space-y-2 ${
              errors.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-accent bg-accent-soft'
            }`}>
              <p className="text-xs font-medium flex items-center gap-1.5">
                {errors.length === 0
                  ? <><span className="h-2 w-2 rounded-full bg-accent inline-block" />{rows.length} row(s) — schema valid</>
                  : <><AlertCircle className="h-3.5 w-3.5 text-destructive" />{rows.length} row(s) — {errors.length} error(s)</>
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
                    <tr>{Object.keys(rows[0]).map(h => <th key={h} className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {Object.values(r).map((v, j) => <td key={j} className="px-2 py-1 whitespace-nowrap text-foreground max-w-[120px] truncate">{v || '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {done && (
            <p className={`text-xs font-medium flex items-center gap-1.5 ${importErrors.length > 0 ? 'text-warn' : 'text-accent'}`}>
              <span className={`h-2 w-2 rounded-full inline-block ${importErrors.length > 0 ? 'bg-warn' : 'bg-accent'}`} />
              {imported} record(s) imported{importErrors.length > 0 ? `, ${importErrors.length} failed` : ''}.
            </p>
          )}

          {/* Intra-file dup notice */}
          {dupResolved && !done && (
            <div className="rounded-md border border-warn bg-warn-soft p-3 text-xs text-warn flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>Duplicate rows within the file were removed. Click <strong>Import Rows</strong> to proceed.</span>
            </div>
          )}

          {/* DB-level dup confirm */}
          {dupConfirm && (
            <div className="rounded-md border border-warn bg-warn-soft p-3 space-y-2">
              <p className="text-xs font-semibold text-warn flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Duplicate detected
              </p>
              <p className="text-xs text-warn">
                A dosing record for <strong>"{dupConfirm}"</strong> already exists at this date & time.
                Overwrite it, or skip this row?
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="bg-primary text-white hover:bg-primary/90 h-7 text-xs" onClick={() => handleDupDecision('overwrite')}>Overwrite</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip')}>Skip</Button>
                <Button size="sm" className="bg-primary text-white hover:bg-primary/90 h-7 text-xs" onClick={() => handleDupDecision('overwrite', true)}>Overwrite All</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleDupDecision('skip', true)}>Skip All</Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!dupConfirm}>Cancel</Button>
          <Button onClick={doImport} disabled={!canSubmit} className="bg-primary text-white hover:bg-primary/90">
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Import Rows{rows.length > 0 ? ` (${rows.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
