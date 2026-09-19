import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle,
  Droplet, Zap, FlaskConical, Gauge, Waves, Thermometer,
  ChevronRight, Download, RefreshCw, X, Info, CircleDot, Menu,
  MapPin, Activity, Building2, ShieldAlert, Layers,
  Check, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { usePermission } from '@/hooks/usePermission';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  IMPORT_CONFIGS, CONFIG_MAP, CATEGORY_GROUPS,
  parseCSV, autoMapHeaders, remapRow, validateRow, downloadTemplate,
  type ImportType, type ImportTypeConfig, type ParsedRow,
} from './smart-import/registry';
import { ImportTypeCard } from './smart-import/ImportTypeCard';
import { SidebarContent } from './smart-import/SidebarContent';
import { DropZone } from './smart-import/DropZone';
import { ColumnReference } from './smart-import/ColumnReference';
import { PreviewTable } from './smart-import/PreviewTable';

export default function SmartImportPanel() {
  const navigate = useNavigate();
  const canView = usePermission('smart_import', 'view');
  const { data: plants } = usePlants();

  const [selected, setSelected] = useState<ImportType>('locator_readings');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plantId, setPlantId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [skipInvalid, setSkipInvalid] = useState(true);

  const [filterMode, setFilterMode] = useState<'all' | 'valid' | 'errors'>('all');

  const config = CONFIG_MAP[selected];

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setStatus('parsing');
    setParsedRows([]);
    setImportLog([]);
    setFilterMode('all');

    try {
      const text = await f.text();
      const { headers, rows } = parseCSV(text);

      if (!headers.length) {
        toast.error('Could not parse CSV — check format');
        setStatus('error');
        return;
      }

      const map = autoMapHeaders(headers, config.columns);
      setHeaderMap(map);

      const remapped = rows.map(r => remapRow(r, map));
      const parsed = remapped.map((row, i) => validateRow(row, config, i));
      setParsedRows(parsed);
      setStatus('preview');
    } catch {
      toast.error('Failed to read file');
      setStatus('error');
    }
  }, [config]);

  const handleClear = useCallback(() => {
    setFile(null);
    setParsedRows([]);
    setHeaderMap({});
    setStatus('idle');
    setImportProgress(0);
    setImportLog([]);
    setFilterMode('all');
  }, []);

  const handleSelectType = useCallback((t: ImportType) => {
    setSelected(t);
    setSidebarOpen(false);
    handleClear();
  }, [handleClear]);

  const runImport = useCallback(async () => {
    if (!plantId) { toast.error('Select a plant first'); return; }
    const rows = skipInvalid ? parsedRows.filter(r => r.valid) : parsedRows;
    if (!rows.length) { toast.error('No valid rows to import'); return; }

    setStatus('importing');
    setImportProgress(0);
    setImportLog([]);
    const log: string[] = [];

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;

    const entityNameToId: Record<string, string> = {};
    if (config.entityTable && config.entityNameKey && config.entityIdKey) {
      const { data: entities, error: entErr } = await (supabase
        .from(config.entityTable as any) as any)
        .select('id, name')
        .eq('plant_id', plantId);

      if (entErr) {
        toast.error(friendlyError(entErr));
        setStatus('error');
        return;
      }
      (entities ?? []).forEach((e: any) => {
        entityNameToId[e.name.trim().toLowerCase()] = e.id;
      });
    }

    let done = 0;
    const batchSize = 50;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const insertBatch: Record<string, unknown>[] = [];
      const batchErrors: string[] = [];

      for (const r of batch) {
        const obj: Record<string, unknown> = {
          plant_id: plantId,
          recorded_by: userId,
          ...(config.extraInsertFields ?? {}),
        };

        if (config.entityTable && config.entityNameKey && config.entityIdKey) {
          const rawName = r.data[config.entityNameKey]?.trim() ?? '';
          const entityId = entityNameToId[rawName.toLowerCase()];
          if (!entityId) {
            batchErrors.push(`Row ${r.rowIndex + 1}: ${config.entityNameKey?.replace(/_/g, ' ')} "${rawName}" not found in plant — skipped`);
            continue;
          }
          obj[config.entityIdKey] = entityId;
        }

        for (const col of config.columns) {
          if (col.key === config.entityNameKey) continue;
          if (config.skipColumns?.includes(col.key)) continue;
          const raw = r.data[col.key] ?? '';
          if (!raw) continue;
          if (col.type === 'number') {
            const n = parseFloat(raw);
            if (!isNaN(n)) obj[col.key] = n;
          } else {
            obj[col.key] = raw;
          }
        }

        if (config.id === 'locator_readings') {
          const isDirect = (r.data['input_mode'] ?? '').toLowerCase() === 'direct';
          if (isDirect) {
            const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : 0;
            obj['current_reading'] = prev;
            obj['previous_reading'] = prev || null;
          }
        }

        if (config.computeDailyVolume) {
          const cur = parseFloat(r.data['current_reading'] ?? '');
          const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : null;
          if (!isNaN(cur)) {
            const delta = prev != null && !isNaN(prev) ? Math.max(0, cur - prev) : null;
            if (delta != null) obj['daily_volume'] = delta;
          }
        }

        if (config.id === 'well_readings' && !r.data['solar_meter_reading']?.trim()) {
          delete obj['solar_meter_reading'];
        }

        insertBatch.push(obj);
      }

      batchErrors.forEach(e => log.push(`⚠ ${e}`));

      if (insertBatch.length > 0) {
        const { error } = await (supabase.from(config.table as any) as any).insert(insertBatch);
        done += insertBatch.length;
        setImportProgress(Math.round((done / rows.length) * 100));

        if (error) {
          log.push(`❌ Batch ${Math.ceil(i / batchSize) + 1}: ${error.message}`);
        } else {
          log.push(`✓ Rows ${i + 1}–${Math.min(i + batchSize, rows.length)} inserted (${insertBatch.length})`);
        }
      }
      setImportLog([...log]);
    }

    setStatus('done');
    const errCount = log.filter(l => l.startsWith('❌')).length;
    const warnCount = log.filter(l => l.startsWith('⚠')).length;
    if (errCount === 0 && warnCount === 0) {
      toast.success(`${rows.length} row(s) imported to ${config.label}`);
    } else if (errCount > 0) {
      toast.info(`Import done — ${errCount} batch error(s)`);
    } else {
      toast.info(`Import done — ${warnCount} row(s) skipped (entity not found)`);
    }
  }, [plantId, parsedRows, skipInvalid, config]);

  if (!canView) {
    return (
      <Card className="p-6 text-center space-y-2" data-testid="import-access-denied">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Smart Import is available to Manager, Data Analyst, and Admin.
        </p>
        <button onClick={() => navigate('/')} className="text-sm text-accent hover:underline">
          Back to dashboard
        </button>
      </Card>
    );
  }

  const validCount = parsedRows.filter(r => r.valid).length;
  const invalidCount = parsedRows.length - validCount;
  const selectedPlantName = plants?.find(p => p.id === plantId)?.name ?? 'Select Target Facility';

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Smart Multi-Import Studio</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Intelligent multi-format CSV batch loader with entity auto-resolution and pre-flight validation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background" onClick={() => downloadTemplate(config, plantId, plants)}>
            <Download className="h-3.5 w-3.5 text-primary" />
            <span>Download Template (.csv)</span>
          </Button>
          <button className="lg:hidden flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/40 transition-colors shrink-0" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-3.5 w-3.5" />
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-sm shrink-0', config.accent)}>
              <config.icon className={cn('h-2.5 w-2.5', config.color)} />
            </span>
            <span className="truncate max-w-[100px]">{config.label}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 rounded-xl bg-muted/30 border border-border/60 text-xs">
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-3xs shrink-0">1</span>
          <span className="font-semibold truncate">Select Schema</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-1">
          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full font-bold text-3xs shrink-0', plantId ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>2</span>
          <span className="font-semibold truncate">Pick Plant Facility</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-1">
          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full font-bold text-3xs shrink-0', file ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>3</span>
          <span className="font-semibold truncate">Upload & Validate</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-1">
          <span className={cn('flex h-5 w-5 items-center justify-center rounded-full font-bold text-3xs shrink-0', status === 'done' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>4</span>
          <span className="font-semibold truncate">Sync to Database</span>
        </div>
      </div>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 flex flex-col w-72 max-w-[85vw] h-full bg-background border-r shadow-xl animate-in slide-in-from-left-4 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Import Type</span>
              <button onClick={() => setSidebarOpen(false)} aria-label="Close" className="rounded p-1 hover:bg-muted transition-colors">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <SidebarContent selected={selected} onSelect={handleSelectType} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 items-start">
        <Card className="p-3 hidden lg:block sticky top-20 border-border/70">
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground/60 px-0.5 mb-2">
            Import Schema Type
          </p>
          <SidebarContent selected={selected} onSelect={handleSelectType} />
        </Card>

        <div className="space-y-3 min-w-0">
          <Card className="p-4 space-y-3.5 border-border/70">
            <div className="flex items-center gap-3">
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', config.accent)}>
                <config.icon className={cn('h-4 w-4', config.color)} />
              </span>
              <div>
                <h2 className="text-sm font-semibold">{config.label}</h2>
                <p className="text-xs text-muted-foreground">{config.description}</p>
              </div>
              <Badge variant="outline" className="ml-auto text-2xs px-2 py-0.5 h-5 font-semibold text-muted-foreground shrink-0">
                {config.category}
              </Badge>
            </div>

            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label htmlFor="smartimportpanel-target-plant" className="text-xs font-semibold">
                  Target Plant Facility <span className="text-danger">*</span>
                </Label>
                <Select value={plantId} onValueChange={setPlantId}>
                  <SelectTrigger className="h-8 text-xs font-medium" id="smartimportpanel-target-plant">
                    <SelectValue placeholder="Select facility for entity resolution…" />
                  </SelectTrigger>
                  <SelectContent>
                    {plants?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pb-1 shrink-0">
                <button
                  role="switch"
                  aria-checked={skipInvalid}
                  aria-label="Skip invalid"
                  onClick={() => setSkipInvalid(v => !v)}
                  className={cn(
                    'relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    skipInvalid ? 'bg-primary' : 'bg-input',
                  )}
                >
                  <span className={cn(
                    'pointer-events-none block h-3 w-3 rounded-full bg-white shadow ring-0 transition-transform',
                    skipInvalid ? 'translate-x-4' : 'translate-x-0',
                  )} />
                </button>
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Skip invalid rows</span>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="smartimport-csv-file" className="text-xs font-semibold">CSV File Upload</Label>
              <DropZone file={file} onFile={handleFile} onClear={handleClear} id="smartimport-csv-file" />
              {status === 'parsing' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground pt-1">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" /> Validating and auto-mapping headers…
                </div>
              )}
            </div>
          </Card>

          <ColumnReference config={config} plantId={plantId} plants={plants} />

          {status === 'preview' && parsedRows.length > 0 && (
            <Card className="p-4 space-y-3.5 border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold">Data Preview & Validation</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setFilterMode('all')} className={cn('text-3xs px-2 py-0.5 rounded-full border font-semibold transition-colors', filterMode === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 text-muted-foreground')}>
                      All ({parsedRows.length})
                    </button>
                    <button onClick={() => setFilterMode('valid')} className={cn('text-3xs px-2 py-0.5 rounded-full border font-semibold transition-colors', filterMode === 'valid' ? 'bg-accent text-accent-foreground border-accent' : 'bg-muted/40 text-muted-foreground')}>
                      Valid ({validCount})
                    </button>
                    {invalidCount > 0 && (
                      <button onClick={() => setFilterMode('errors')} className={cn('text-3xs px-2 py-0.5 rounded-full border font-semibold transition-colors', filterMode === 'errors' ? 'bg-danger text-danger-foreground border-danger' : 'bg-muted/40 text-danger border-danger/40')}>
                        Errors ({invalidCount})
                      </button>
                    )}
                  </div>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} parsed
                </span>
              </div>

              {invalidCount > 0 && skipInvalid && (
                <div className="flex items-start gap-2 rounded-md bg-warn-soft border border-warn px-3 py-2 text-xs text-warn font-medium">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {invalidCount} row(s) contain validation errors and will be omitted from database sync.
                </div>
              )}

              <PreviewTable rows={parsedRows} config={config} filterMode={filterMode} />

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleClear}>Cancel</Button>
                <Button size="sm" onClick={runImport} disabled={!plantId || (skipInvalid ? validCount === 0 : parsedRows.length === 0)} className="font-semibold gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Sync {skipInvalid ? validCount : parsedRows.length} row{(skipInvalid ? validCount : parsedRows.length) !== 1 ? 's' : ''} to Database
                </Button>
              </div>
            </Card>
          )}

          {(status === 'importing' || status === 'done') && (
            <Card className="p-4 space-y-3 border-border/70">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {status === 'importing' ? 'Syncing to Database…' : 'Database Sync Complete'}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums font-semibold">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-1.5" />
              <div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2.5 space-y-1">
                {importLog.map((line, i) => (
                  <p key={i} className={cn('text-xs font-mono', line.startsWith('❌') ? 'text-danger font-semibold' : line.startsWith('⚠') ? 'text-warn' : 'text-muted-foreground')}>
                    {line}
                  </p>
                ))}
              </div>
              {status === 'done' && (
                <div className="flex justify-end pt-1">
                  <Button variant="outline" size="sm" onClick={handleClear} className="font-semibold">
                    Import Another File
                  </Button>
                </div>
              )}
            </Card>
          )}

          {status === 'error' && (
            <Card className="p-4 border-danger/40">
              <div className="flex items-center gap-2 text-danger">
                <XCircle className="h-4 w-4" />
                <span className="text-sm font-semibold">Parse failed — check file format</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Make sure it&apos;s a valid CSV with the expected headers.{' '}
                <button onClick={() => downloadTemplate(config, plantId, plants)} className="text-primary underline underline-offset-2 font-semibold">
                  Download a template
                </button>{' '}
                to inspect the expected structure.
              </p>
              <Button variant="outline" size="sm" className="mt-3 font-semibold" onClick={handleClear}>Try again</Button>
            </Card>
          )}

          {status === 'idle' && (
            <div className="flex items-start gap-2.5 rounded-lg border bg-muted/20 px-3.5 py-3 text-xs text-muted-foreground border-border/70">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <span>
                Pick an import type, select a plant facility, then drop a CSV that matches the columns above.{' '}
                <button onClick={() => downloadTemplate(config, plantId, plants)} className="text-primary underline underline-offset-2 font-semibold">
                  Download a pre-filled template
                </button>{' '}
                for <span className="font-semibold text-foreground">{config.label}</span>.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
