import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle,
  Droplet, Activity, Filter, Loader2, Download, RefreshCcw, Sparkles,
} from 'lucide-react';
import AIImportPanel from '@/components/AIImportPanel';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types (mirror backend response)
// ---------------------------------------------------------------------------
type StatusCode =
  | 'valid' | 'blend' | 'blend_shutdown' | 'defective'
  | 'shutoff' | 'no_operation' | 'no_reading' | 'new_meter'
  | 'standby' | 'tripped' | 'unknown';

type ParsedRow = {
  date: string | null;
  initial: number | null;
  final: number | null;
  volume: number | null;
  status: StatusCode;
  status_raw: string | null;
  include_in_totals: boolean;
  is_downtime: boolean;
  flags: string[];
  warnings: string[];
  row_index: number;
  block_index: number;
};

type ParsedSheet = {
  sheet_name: string;
  suggested_well_name: string;
  rows: ParsedRow[];
  summary: {
    total_rows: number;
    by_status: Record<string, number>;
    valid_rows: number;
    defective_rows: number;
    downtime_rows: number;
    flagged_rows: number;
    sum_volume_valid: number;
    sum_volume_all_included: number;
    date_range: [string | null, string | null];
  };
  warnings: string[];
};

type ParseResult = {
  sheets: ParsedSheet[];
  file_summary: {
    sheet_count: number;
    total_rows: number;
    total_defective: number;
    total_downtime: number;
    total_flagged: number;
  };
};

type MappingChoice =
  | { kind: 'existing'; wellId: string }
  | { kind: 'create'; name: string }
  | { kind: 'skip' };

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const STATUS_META: Record<StatusCode, { label: string; tone: string; dot: string }> = {
  valid:          { label: 'Valid',          tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  blend:          { label: 'Blend',          tone: 'bg-sky-50 text-sky-700 border-sky-200',             dot: 'bg-sky-500' },
  blend_shutdown: { label: 'Blend/Shutdown', tone: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-500' },
  new_meter:      { label: 'New Meter',      tone: 'bg-violet-50 text-violet-700 border-violet-200',    dot: 'bg-violet-500' },
  defective:      { label: 'Defective',      tone: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500' },
  shutoff:        { label: 'Shut-Off',       tone: 'bg-slate-100 text-slate-700 border-slate-300',      dot: 'bg-slate-500' },
  no_operation:   { label: 'No Operation',   tone: 'bg-slate-100 text-slate-700 border-slate-300',      dot: 'bg-slate-500' },
  no_reading:     { label: 'No Reading',     tone: 'bg-zinc-100 text-zinc-700 border-zinc-300',         dot: 'bg-zinc-500' },
  standby:        { label: 'Standby',        tone: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'bg-blue-500' },
  tripped:        { label: 'Tripped-Off',    tone: 'bg-orange-50 text-orange-700 border-orange-200',    dot: 'bg-orange-500' },
  unknown:        { label: 'Unknown',        tone: 'bg-yellow-50 text-yellow-700 border-yellow-200',    dot: 'bg-yellow-500' },
};

function StatusChip({ code }: { code: StatusCode }) {
  const m = STATUS_META[code];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium', m.tone)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Import() {
  const { user } = useAuth();
  const { data: plants } = usePlants();

  const [mode, setMode] = useState<'ai' | 'wellmeter'>('ai');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [plantId, setPlantId] = useState<string>('');
  const [mapping, setMapping] = useState<Record<string, MappingChoice>>({});
  const [includeDefective, setIncludeDefective] = useState(false);
  const [includeDowntimeAsZero, setIncludeDowntimeAsZero] = useState(true);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'valid' | 'downtime' | 'defective' | 'flagged'>('all');
  const [commitOpen, setCommitOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState(0);
  const [commitLog, setCommitLog] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Wells for the selected plant
  const { data: wells } = useQuery({
    queryKey: ['import-wells', plantId],
    queryFn: async () => {
      if (!plantId) return [];
      const { data, error } = await supabase
        .from('wells').select('id,name,plant_id').eq('plant_id', plantId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!plantId,
  });

  const onChooseFile = useCallback((f: File | null) => {
    setFile(f);
    setResult(null);
    setMapping({});
    setActiveSheet('');
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onChooseFile(f);
  }, [onChooseFile]);

  const runParse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const base = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';
      const res = await fetch(`${base}/api/import/parse-wellmeter`, { method: 'POST', body: fd });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const json: ParseResult = await res.json();
      setResult(json);
      if (json.sheets[0]) setActiveSheet(json.sheets[0].sheet_name);
      // Auto-init mapping: try to match by suggested name
      toast.success(`Parsed ${json.sheets.length} sheet(s), ${json.file_summary.total_rows} rows`);
    } catch (e: any) {
      toast.error(`Parse failed: ${e.message || e}`);
    } finally {
      setParsing(false);
    }
  }, [file]);

  // When plant or wells change, auto-match mapping by name
  const autoMap = useCallback(() => {
    if (!result || !wells) return;
    const next: Record<string, MappingChoice> = {};
    for (const s of result.sheets) {
      const hit = wells.find(
        (w) => w.name.trim().toLowerCase() === s.suggested_well_name.trim().toLowerCase(),
      );
      next[s.sheet_name] = hit
        ? { kind: 'existing', wellId: hit.id }
        : { kind: 'create', name: s.suggested_well_name };
    }
    setMapping(next);
  }, [result, wells]);

  const activeSheetData = useMemo(
    () => result?.sheets.find((s) => s.sheet_name === activeSheet) ?? null,
    [result, activeSheet],
  );

  const filteredRows = useMemo(() => {
    if (!activeSheetData) return [];
    const rows = activeSheetData.rows;
    switch (filter) {
      case 'valid':     return rows.filter((r) => r.include_in_totals && !r.is_downtime && r.flags.length === 0);
      case 'downtime':  return rows.filter((r) => r.is_downtime);
      case 'defective': return rows.filter((r) => r.status === 'defective');
      case 'flagged':   return rows.filter((r) => r.flags.length > 0);
      default:          return rows;
    }
  }, [activeSheetData, filter]);

  // ---------------- Commit to Supabase ----------------
  const runCommit = useCallback(async () => {
    if (!result || !plantId) return;
    setCommitting(true);
    setCommitProgress(0);
    setCommitLog([]);
    const log = (m: string) => setCommitLog((l) => [...l, m]);

    try {
      // 1. Create wells that are marked "create"
      const wellIdBySheet: Record<string, string> = {};
      const existingMap: Record<string, string> = {};
      (wells ?? []).forEach((w) => { existingMap[w.name.trim().toLowerCase()] = w.id; });

      for (const s of result.sheets) {
        const m = mapping[s.sheet_name];
        if (!m || m.kind === 'skip') continue;
        if (m.kind === 'existing') {
          wellIdBySheet[s.sheet_name] = m.wellId;
        } else {
          // create
          const lower = m.name.trim().toLowerCase();
          if (existingMap[lower]) {
            wellIdBySheet[s.sheet_name] = existingMap[lower];
            log(`Using existing well "${m.name}"`);
          } else {
            const { data, error } = await supabase.from('wells').insert({
              plant_id: plantId,
              name: m.name,
              status: 'Active',
              has_power_meter: false,
            }).select('id').single();
            if (error) throw new Error(`Create well "${m.name}": ${error.message}`);
            wellIdBySheet[s.sheet_name] = data.id;
            existingMap[lower] = data.id;
            log(`Created well "${m.name}"`);
          }
        }
      }

      // 2. Build rows to insert
      type InsertRow = {
        plant_id: string;
        well_id: string;
        reading_datetime: string;
        previous_reading: number | null;
        current_reading: number | null;
        daily_volume: number | null;
        off_location_flag: boolean;
        recorded_by: string | null;
      };
      const toInsert: InsertRow[] = [];

      for (const s of result.sheets) {
        const wid = wellIdBySheet[s.sheet_name];
        if (!wid) continue;
        for (const r of s.rows) {
          if (!r.date) continue;
          if (r.status === 'defective' && !includeDefective) continue;
          // Determine daily_volume — downtime should be 0 when user opts in
          let vol = r.volume;
          if (r.is_downtime && includeDowntimeAsZero) vol = 0;

          toInsert.push({
            plant_id: plantId,
            well_id: wid,
            reading_datetime: new Date(r.date + 'T00:00:00').toISOString(),
            previous_reading: r.initial,
            current_reading: r.final,
            daily_volume: vol,
            off_location_flag: r.is_downtime || r.status === 'defective' || r.flags.length > 0,
            recorded_by: user?.id ?? null,
          });
        }
      }

      log(`Prepared ${toInsert.length} rows for insert…`);

      // 3. Insert in batches of 500
      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += batchSize) {
        const batch = toInsert.slice(i, i + batchSize);
        const { error } = await supabase.from('well_readings').insert(batch);
        if (error) throw new Error(`Batch ${i / batchSize + 1}: ${error.message}`);
        inserted += batch.length;
        setCommitProgress(Math.round((inserted / toInsert.length) * 100));
        log(`Inserted ${inserted}/${toInsert.length}`);
      }

      toast.success(`Imported ${inserted} readings`);
      log('✅ Import complete');
    } catch (e: any) {
      toast.error(`Import failed: ${e.message || e}`);
      log(`❌ ${e.message || e}`);
    } finally {
      setCommitting(false);
    }
  }, [result, plantId, wells, mapping, includeDefective, includeDowntimeAsZero, user]);

  // ---------------- Export cleaned CSV ----------------
  const downloadCleanedCsv = useCallback(() => {
    if (!result) return;
    const rows: string[] = ['sheet,well,date,initial,final,volume,status,raw_status,include,is_downtime,flags,warnings'];
    for (const s of result.sheets) {
      for (const r of s.rows) {
        rows.push([
          csv(s.sheet_name), csv(s.suggested_well_name),
          r.date ?? '', r.initial ?? '', r.final ?? '', r.volume ?? '',
          r.status, csv(r.status_raw ?? ''),
          r.include_in_totals, r.is_downtime,
          csv(r.flags.join('|')), csv(r.warnings.join(' | ')),
        ].join(','));
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-cleaned-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Smart Import</h1>
        <p className="text-xs text-muted-foreground">
          Upload plant data — AI Universal handles any layout (xlsx/csv/docx/txt), Wellmeter Parser is the dedicated legacy flow for tri-block well-meter sheets.
        </p>
      </div>

      {/* Mode toggle */}
      <div
        className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs"
        role="tablist"
        aria-label="Import mode"
      >
        <button
          role="tab"
          aria-selected={mode === 'ai'}
          onClick={() => setMode('ai')}
          className={cn(
            'px-3 py-1 rounded-sm flex items-center gap-1.5 transition-colors',
            mode === 'ai' ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200 font-medium' : 'text-muted-foreground hover:text-foreground',
          )}
          data-testid="import-mode-ai"
        >
          <Sparkles className="h-3 w-3" /> AI Universal
        </button>
        <button
          role="tab"
          aria-selected={mode === 'wellmeter'}
          onClick={() => setMode('wellmeter')}
          className={cn(
            'px-3 py-1 rounded-sm flex items-center gap-1.5 transition-colors',
            mode === 'wellmeter' ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
          )}
          data-testid="import-mode-wellmeter"
        >
          <Droplet className="h-3 w-3" /> Wellmeter Parser <span className="text-[10px] opacity-70">(legacy)</span>
        </button>
      </div>

      {mode === 'ai' && (
        <AIImportPanel
          externalFile={file}
          onFileChange={onChooseFile}
          onHandoffWellmeter={(f) => {
            onChooseFile(f);
            setMode('wellmeter');
          }}
        />
      )}
      {mode === 'wellmeter' && (
        <>
          {/* --- Step 1: Upload --- */}
      <Card className="p-4">
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
            file ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/40',
          )}
        >
          <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm">
            {file ? <span className="font-medium">{file.name}</span> : 'Drag & Drop A Meter File Here'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx, .xlsm, .txt, .doc, .docx</p>
          <div className="mt-2 flex gap-2 justify-center flex-wrap">
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} data-testid="import-browse-btn">
              <Upload className="h-3.5 w-3.5 mr-1" /> Browse
            </Button>
            <Button size="sm" onClick={runParse} disabled={!file || parsing} data-testid="import-parse-btn">
              {parsing ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Parsing…</> : 'Parse File'}
            </Button>
            {file && (
              <Button size="sm" variant="ghost" onClick={() => onChooseFile(null)}>Clear</Button>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,.txt,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain"
            className="hidden"
            onChange={(e) => onChooseFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </Card>

      {/* --- Step 2: Summary + Settings --- */}
      {result && (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold">File Summary</h2>
                <p className="text-xs text-muted-foreground">
                  {result.file_summary.sheet_count} sheet(s) · {result.file_summary.total_rows} rows parsed
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={downloadCleanedCsv}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Cleaned CSV
                </Button>
                <Button
                  size="sm"
                  disabled={!plantId || Object.keys(mapping).length === 0}
                  onClick={() => setCommitOpen(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Commit to Supabase
                </Button>
              </div>
            </div>

            <div className="grid gap-2 mt-3 grid-cols-2 sm:grid-cols-4">
              <SummaryTile icon={Activity} label="Rows parsed" value={fmt(result.file_summary.total_rows)} />
              <SummaryTile icon={XCircle}  label="Defective"    value={fmt(result.file_summary.total_defective)} tone="text-rose-600" />
              <SummaryTile icon={AlertTriangle} label="Downtime"     value={fmt(result.file_summary.total_downtime)} tone="text-amber-600" />
              <SummaryTile icon={AlertTriangle} label="Flagged"      value={fmt(result.file_summary.total_flagged)} tone="text-yellow-600" />
            </div>

            {/* Plant & per-sheet well mapping */}
            <div className="grid gap-3 mt-4 lg:grid-cols-[260px_1fr]">
              <div>
                <Label className="text-xs">Target plant</Label>
                <Select value={plantId} onValueChange={setPlantId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a plant…" /></SelectTrigger>
                  <SelectContent>
                    {(plants ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" variant="outline" className="mt-2 w-full"
                  disabled={!plantId} onClick={autoMap}
                >
                  <RefreshCcw className="h-3.5 w-3.5 mr-1" /> Auto-match wells
                </Button>
                <div className="mt-3 p-2 rounded-md border bg-muted/30 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Include defective rows</Label>
                    <Switch checked={includeDefective} onCheckedChange={setIncludeDefective} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Downtime → volume = 0</Label>
                    <Switch checked={includeDowntimeAsZero} onCheckedChange={setIncludeDowntimeAsZero} />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs">Per-sheet mapping ({result.sheets.length} sheets)</Label>
                <div className="mt-1 rounded-md border divide-y max-h-64 overflow-auto">
                  {result.sheets.map((s) => {
                    const m = mapping[s.sheet_name];
                    return (
                      <div key={s.sheet_name} className="flex items-center gap-2 p-2">
                        <Droplet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{s.sheet_name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {s.summary.total_rows} rows · vol {fmt(s.summary.sum_volume_valid)}
                          </div>
                        </div>
                        <Select
                          value={m ? (m.kind === 'existing' ? m.wellId : m.kind) : ''}
                          onValueChange={(v) => {
                            if (v === 'skip') setMapping((mm) => ({ ...mm, [s.sheet_name]: { kind: 'skip' } }));
                            else if (v === 'create') setMapping((mm) => ({ ...mm, [s.sheet_name]: { kind: 'create', name: s.suggested_well_name } }));
                            else setMapping((mm) => ({ ...mm, [s.sheet_name]: { kind: 'existing', wellId: v } }));
                          }}
                          disabled={!plantId}
                        >
                          <SelectTrigger className="w-[180px] h-8 text-xs">
                            <SelectValue placeholder="Select well…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="create">+ Create &quot;{s.suggested_well_name}&quot;</SelectItem>
                            <SelectItem value="skip">Skip this sheet</SelectItem>
                            {(wells ?? []).map((w) => (
                              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {m?.kind === 'create' && (
                          <Input
                            className="h-8 w-28 text-xs"
                            value={m.name}
                            onChange={(e) => setMapping((mm) => ({ ...mm, [s.sheet_name]: { kind: 'create', name: e.target.value } }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* --- Step 3: Preview by sheet --- */}
          <Card className="p-3">
            <Tabs value={activeSheet} onValueChange={setActiveSheet}>
              <div className="flex items-center gap-2 flex-wrap">
                <TabsList className="flex flex-wrap h-auto">
                  {result.sheets.map((s) => (
                    <TabsTrigger key={s.sheet_name} value={s.sheet_name} className="text-xs">
                      {s.suggested_well_name}
                      {s.summary.defective_rows > 0 && (
                        <span className="ml-1.5 text-[10px] px-1 rounded bg-rose-100 text-rose-700">{s.summary.defective_rows}</span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="flex items-center gap-1 ml-auto">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  {(['all', 'valid', 'downtime', 'defective', 'flagged'] as const).map((f) => (
                    <Button
                      key={f} size="sm"
                      variant={filter === f ? 'default' : 'outline'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setFilter(f)}
                    >{f}</Button>
                  ))}
                </div>
              </div>

              {result.sheets.map((s) => (
                <TabsContent key={s.sheet_name} value={s.sheet_name} className="mt-3">
                  <div className="flex flex-wrap gap-2 mb-2">
                    {Object.entries(s.summary.by_status).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="font-normal">
                        <StatusChip code={k as StatusCode} />
                        <span className="ml-1.5 tabular-nums">{v}</span>
                      </Badge>
                    ))}
                    <Badge variant="outline" className="font-normal">
                      Date range: <span className="ml-1 tabular-nums">{s.summary.date_range[0] ?? '—'} → {s.summary.date_range[1] ?? '—'}</span>
                    </Badge>
                    <Badge variant="outline" className="font-normal">
                      Volume (valid): <span className="ml-1 tabular-nums font-mono-num">{fmt(s.summary.sum_volume_valid)}</span>
                    </Badge>
                  </div>
                  <PreviewTable rows={filter === 'all' && activeSheet === s.sheet_name ? s.rows : filteredRows} />
                </TabsContent>
              ))}
            </Tabs>
          </Card>
        </>
      )}

      {/* --- Commit dialog --- */}
      <Dialog open={commitOpen} onOpenChange={(o) => !committing && setCommitOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Commit to Supabase</DialogTitle></DialogHeader>
          <div className="text-sm space-y-2">
            <p>
              Insert parsed readings into <code>well_readings</code> for plant{' '}
              <b>{(plants ?? []).find((p) => p.id === plantId)?.name ?? '—'}</b>.
            </p>
            <p className="text-xs text-muted-foreground">
              Downtime rows are inserted with <code>off_location_flag = true</code>
              {includeDowntimeAsZero ? ' and volume forced to 0' : ''}.
              Defective rows are {includeDefective ? 'included' : 'skipped'}.
            </p>
            {committing && (
              <div>
                <Progress value={commitProgress} className="h-2 mt-2" />
                <div className="mt-2 max-h-32 overflow-auto text-[11px] font-mono-num">
                  {commitLog.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={committing} onClick={() => setCommitOpen(false)}>Cancel</Button>
            <Button disabled={committing} onClick={runCommit}>
              {committing ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Importing…</> : 'Start import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <Card className="p-2.5">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', tone ?? 'text-muted-foreground')} />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className={cn('mt-1 font-mono-num text-lg', tone)}>{value}</div>
    </Card>
  );
}

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50 backdrop-blur">
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1.5 w-24">Date</th>
              <th className="px-2 py-1.5 text-right w-20">Initial</th>
              <th className="px-2 py-1.5 text-right w-20">Final</th>
              <th className="px-2 py-1.5 text-right w-20">Volume</th>
              <th className="px-2 py-1.5">Status</th>
              <th className="px-2 py-1.5">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">No rows match this filter.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  'border-t',
                  !r.include_in_totals && 'bg-rose-50/40',
                  r.is_downtime && 'bg-slate-50/60',
                  r.flags.length > 0 && 'bg-yellow-50/60',
                )}
              >
                <td className="px-2 py-1 font-mono-num">{r.date ?? '—'}</td>
                <td className="px-2 py-1 text-right font-mono-num">{fmt(r.initial)}</td>
                <td className="px-2 py-1 text-right font-mono-num">{fmt(r.final)}</td>
                <td className={cn(
                  'px-2 py-1 text-right font-mono-num',
                  r.include_in_totals && !r.is_downtime ? 'text-emerald-700' : 'text-muted-foreground',
                )}>{fmt(r.volume)}</td>
                <td className="px-2 py-1"><StatusChip code={r.status} /></td>
                <td className="px-2 py-1 text-[11px] text-muted-foreground">
                  {r.status_raw && <span className="italic">{r.status_raw}</span>}
                  {r.warnings.length > 0 && (
                    <span className="block text-yellow-700">⚠ {r.warnings.join(' · ')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function csv(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
