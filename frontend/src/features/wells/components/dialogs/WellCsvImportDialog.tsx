import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { parseCsv, downloadTemplate, CsvPreviewTable } from '@/features/plants/shared';

export const WELL_CSV_HEADERS = [
  'name', 'diameter', 'drilling_depth_m',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'has_power_meter',
  'electric_meter_brand', 'electric_meter_size', 'electric_meter_serial', 'electric_meter_installed_date',
];

export function WellCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setRows(parseCsv(ev.target?.result as string));
      setErrors([]);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    const errs: string[] = [];
    rows.forEach((r, i) => { if (!r.name?.trim()) errs.push(`Row ${i + 1}: name is required`); });
    if (errs.length) { setErrors(errs); return; }
    setBusy(true);
    const payload = rows.map(r => {
      const hasPower = r.has_power_meter?.toLowerCase() === 'true';
      const row: any = {
        plant_id: plantId,
        name: r.name.trim(),
        diameter: r.diameter || null,
        drilling_depth_m: r.drilling_depth_m ? +r.drilling_depth_m : null,
        meter_brand: r.meter_brand || null,
        meter_size: r.meter_size ? +r.meter_size : null,
        meter_serial: r.meter_serial || null,
        meter_installed_date: r.meter_installed_date || null,
        has_power_meter: hasPower,
        status: 'Active',
      };
      if (hasPower) {
        row.electric_meter_brand = r.electric_meter_brand || null;
        row.electric_meter_size = r.electric_meter_size || null;
        row.electric_meter_serial = r.electric_meter_serial || null;
        row.electric_meter_installed_date = r.electric_meter_installed_date || null;
      }
      return row;
    });
    const { error } = await supabase.from('wells').insert(payload as any);
    setBusy(false);
    if (error) { setErrors([error.message]); return; }
    toast.success(`${rows.length} well(s) imported`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Wells from CSV</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadTemplate('wells_template.csv', WELL_CSV_HEADERS)}>
              <FileDown className="h-3 w-3 mr-1" />Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Fill in the template then upload below</span>
          </div>
          <div className="rounded-md bg-muted/40 border p-2">
            <p className="text-xs font-medium mb-1">Expected columns:</p>
            <p className="text-xs text-muted-foreground font-mono">{WELL_CSV_HEADERS.join(', ')}</p>
            <p className="text-xs text-muted-foreground mt-1"><strong>name</strong> required. <strong>has_power_meter</strong>: true/false. Electric meter fields only needed if has_power_meter is true. Numeric: drilling_depth_m, meter_size.</p>
          </div>
          <div>
            <p className="text-xs font-medium">Select CSV file</p>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer group">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary group-hover:bg-primary/90 text-primary-foreground text-xs font-semibold px-4 py-1.5 transition-colors select-none">
                  <Upload className="h-3.5 w-3.5" />
                  Choose File
                </span>
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                {rows.length > 0
                  ? <span className="text-xs text-primary font-medium">{rows.length} row(s) ready</span>
                  : <span className="text-xs text-muted-foreground">No file chosen</span>}
              </label>
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{rows.length} row(s) parsed</p>
              <CsvPreviewTable rows={rows} headers={WELL_CSV_HEADERS} />
            </>
          )}
          {errors.length > 0 && (
            <div className="rounded bg-destructive/10 border border-destructive/30 p-2 space-y-0.5">
              {errors.map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || !rows.length}>
            {busy ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importing…</> : `Import ${rows.length || ''} Rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
