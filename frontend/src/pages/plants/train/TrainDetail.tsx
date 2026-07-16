import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';


import { PLANT_CHEMICALS } from '../shared';

export function EditTrainDialog({
  train,
  plant,
  onClose,
}: {
  train: any;
  plant: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();

  // Plant-wide type defaults
  const plantMediaType: 'AFM' | 'MMF' = plant.filter_media_type ?? 'AFM';
  const plantFilterType: 'Cartridge Filter' | 'Bag Filter' = plant.filter_housing_type ?? 'Cartridge Filter';

  const [form, setForm] = useState({
    name: train.name ?? '',
    num_afm: String(train.num_afm ?? 0),
    num_booster_pumps: String(train.num_booster_pumps ?? 0),
    num_hp_pumps: String(train.num_hp_pumps ?? 0),
    num_cartridge_filters: String(train.num_cartridge_filters ?? 0),
    num_controllers: String(train.num_controllers ?? 0),
    num_filter_housings: String(train.num_filter_housings ?? 0),
    // Per-train overrides (fallback to plant-wide)
    filter_media_type: train.filter_media_type ?? plantMediaType,
    filter_housing_type: train.filter_housing_type ?? plantFilterType,
    // Source well — drives "PER WELL SOURCE" labels on the Dashboard
    well_id: train.well_id ?? '',
  });
  const [saving, setSaving] = useState(false);

  // Wells for this plant — populates the source-well dropdown
  const { data: plantWells = [] } = useQuery({
    queryKey: ['plant-wells-for-train-edit', train.plant_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('wells')
        .select('id, name')
        .eq('plant_id', train.plant_id)
        .order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });

  const num = (v: string) => (v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0));

  const save = async () => {
    setSaving(true);
    const payload: any = {
      name: form.name.trim() || null,
      num_afm: num(form.num_afm),
      num_booster_pumps: num(form.num_booster_pumps),
      num_hp_pumps: num(form.num_hp_pumps),
      num_cartridge_filters: num(form.num_cartridge_filters),
      num_controllers: num(form.num_controllers),
      num_filter_housings: num(form.num_filter_housings),
      filter_media_type: form.filter_media_type,
      filter_housing_type: form.filter_housing_type,
      well_id: form.well_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('ro_trains').update(payload).eq('id', train.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Train ${train.train_number} updated`);
    qc.invalidateQueries({ queryKey: ['ro-trains', train.plant_id] });
    onClose();
  };

  const mediaType = form.filter_media_type as 'AFM' | 'MMF';
  const filterHousingType = form.filter_housing_type as 'Cartridge Filter' | 'Bag Filter';
  const usingPlantMedia = mediaType === plantMediaType;
  const usingPlantFilter = filterHousingType === plantFilterType;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Train {train.train_number}{train.name ? ` · ${train.name}` : ''}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Train name */}
          <div>
            <Label className="text-xs">Train label / name (optional)</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. North Wing"
              disabled={!isManager}
              data-testid="train-name-input"
            />
          </div>

          {/* Source well link */}
          <div>
            <Label className="text-xs">Source well <span className="text-muted-foreground font-normal">(used for "Per Well Source" labels on Dashboard)</span></Label>
            <Select
              value={form.well_id || '__none__'}
              onValueChange={(v) => setForm({ ...form, well_id: v === '__none__' ? '' : v })}
              disabled={!isManager}
            >
              <SelectTrigger data-testid="train-well-select">
                <SelectValue placeholder="— not linked —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— not linked —</SelectItem>
                {plantWells.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Component counts ── */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Component Counts</div>

            {/* Media filters row */}
            <div>
              <Label className="text-xs">
                {mediaType} units{' '}
                <span className="text-muted-foreground font-normal">(media filter)</span>
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_afm: String(Math.max(0, num(form.num_afm) - 1)) })}
                  data-testid="dec-afm"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_afm}
                  onChange={(e) => setForm({ ...form, num_afm: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-afm-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_afm: String(num(form.num_afm) + 1) })}
                  data-testid="inc-afm"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Pre-filter housing — label & visibility driven by plant-wide filter type */}
            <div>
              <Label className="text-xs">
                {/* Bag Filter → "Filter Housing" (single merged field)
                    Cartridge Filter → "Cartridge Housing" (separate field below) */}
                {filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'}{' '}
                <span className="text-muted-foreground font-normal">(pre-filter)</span>
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_cartridge_filters: String(Math.max(0, num(form.num_cartridge_filters) - 1)) })}
                  data-testid="dec-cf"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_cartridge_filters}
                  onChange={(e) => setForm({ ...form, num_cartridge_filters: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-cf-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_cartridge_filters: String(num(form.num_cartridge_filters) + 1) })}
                  data-testid="inc-cf"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Booster pumps */}
            <div>
              <Label className="text-xs">Booster Pumps</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_booster_pumps: String(Math.max(0, num(form.num_booster_pumps) - 1)) })}
                  data-testid="dec-bp"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_booster_pumps}
                  onChange={(e) => setForm({ ...form, num_booster_pumps: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-bp-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_booster_pumps: String(num(form.num_booster_pumps) + 1) })}
                  data-testid="inc-bp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* HP pumps */}
            <div>
              <Label className="text-xs">High-Pressure Pumps (HPP)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_hp_pumps: String(Math.max(0, num(form.num_hp_pumps) - 1)) })}
                  data-testid="dec-hpp"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_hp_pumps}
                  onChange={(e) => setForm({ ...form, num_hp_pumps: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-hpp-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_hp_pumps: String(num(form.num_hp_pumps) + 1) })}
                  data-testid="inc-hpp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Controllers */}
            <div>
              <Label className="text-xs">Controllers</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_controllers: String(Math.max(0, num(form.num_controllers) - 1)) })}
                  data-testid="dec-ctrl"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_controllers}
                  onChange={(e) => setForm({ ...form, num_controllers: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-ctrl-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_controllers: String(num(form.num_controllers) + 1) })}
                  data-testid="inc-ctrl"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Filter Housings — hidden for Bag Filter plants (merged into Cartridge Housing above) */}
            {filterHousingType !== 'Bag Filter' && (
            <div>
              <Label className="text-xs">Filter Housings</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_filter_housings: String(Math.max(0, num(form.num_filter_housings) - 1)) })}
                  data-testid="dec-fh"
                >
                  −
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={form.num_filter_housings}
                  onChange={(e) => setForm({ ...form, num_filter_housings: e.target.value })}
                  className="text-center font-mono-num"
                  data-testid="num-fh-input"
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setForm({ ...form, num_filter_housings: String(num(form.num_filter_housings) + 1) })}
                  data-testid="inc-fh"
                >
                  +
                </Button>
              </div>
            </div>
            )}
          </div>

          {/* ── Per-train type overrides ── */}
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Component Types{' '}
              <span className="normal-case font-normal text-muted-foreground">(overrides plant-wide setting for this train)</span>
            </div>

            {/* Media filter type */}
            <div>
              <Label className="text-xs mb-1.5 block">
                Media Filter Type
                {usingPlantMedia && (
                  <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                    ✓ Matches plant default
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                {(['AFM', 'MMF'] as const).map((opt) => (
                  <Button
                    key={opt}
                    size="sm"
                    variant={mediaType === opt ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, filter_media_type: opt })}
                    data-testid={`train-media-${opt}`}
                    className="flex-1"
                  >
                    <span
                      aria-hidden
                      className={`mr-1.5 h-2 w-2 rounded-full border ${mediaType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                    />
                    {opt}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">AFM = Active Filter Media · MMF = Multi-Media Filter</p>
            </div>

            {/* Pre-filter housing type */}
            <div>
              <Label className="text-xs mb-1.5 block">
                Pre-filter Housing Type
                {usingPlantFilter && (
                  <span className="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                    ✓ Matches plant default
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => (
                  <Button
                    key={opt}
                    size="sm"
                    variant={filterHousingType === opt ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, filter_housing_type: opt })}
                    data-testid={`train-filter-${opt.replace(' ', '-')}`}
                    className="flex-1"
                  >
                    <span
                      aria-hidden
                      className={`mr-1.5 h-2 w-2 rounded-full border ${filterHousingType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
                    />
                    {opt}
                  </Button>
                ))}
              </div>
            </div>

            {(!usingPlantMedia || !usingPlantFilter) && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                ⚠ This train differs from the plant default. It will display its own type labels.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {isManager ? 'Cancel' : 'Close'}
          </Button>
          {isManager && (
            <Button onClick={save} disabled={saving} data-testid="save-train-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Save Train
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Train History Chart ─────────────────────────────────────────────────────
// Queries ro_train_readings for daily production volume and renders a bar chart.

export function TrainHistoryChart({ trainId, trainLabel }: { trainId: string; trainLabel: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<{ date: string; volume: number }[]>({
    queryKey: ['train-history', trainId, range],
    queryFn: async () => {
      const days = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await supabase
        .from('ro_train_readings')
        .select('reading_datetime, permeate_flow, product_flow, net_production')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });

      // Aggregate per day — use permeate_flow or product_flow or net_production
      const byDate = new Map<string, number>();
      for (const r of data ?? []) {
        const date = (r as any).reading_datetime?.slice(0, 10) ?? '';
        if (!date) continue;
        const vol = +((r as any).net_production ?? (r as any).permeate_flow ?? (r as any).product_flow ?? 0);
        byDate.set(date, (byDate.get(date) ?? 0) + vol);
      }
      return Array.from(byDate.entries()).map(([date, volume]) => ({ date, volume: +volume.toFixed(2) })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const blob = new Blob([['date,volume_m3', ...rows.map(r => `${r.date},${r.volume}`)].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${trainLabel.replace(/\s+/g,'_')}_history.csv`; a.click(); URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const total = rows.reduce((s, r) => s + r.volume, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">Production History</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV} title="Export CSV">
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-[10px] uppercase">Days</div>
            <div className="font-mono font-semibold text-base">{rows.length}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-[10px] uppercase">Total m³</div>
            <div className="font-mono font-semibold text-base">{fmtNum(total)}</div>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No readings in this period</p>
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(16, 400 / rows.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={38} tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(v)} />
              <Tooltip formatter={(v: any) => [`${fmtNum(v)} m³`, 'Volume']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="volume" fill="hsl(174, 72%, 40%)" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── TrainMetricChart ────────────────────────────────────────────────────────
// Renders a bar chart for one or two numeric columns from ro_train_readings.
// Used for per-component drill-downs: AFM/MMF, Booster Pump, HPP, etc.

export type TrainMetricDef = {
  key: string;
  label: string;
  unit: string;
  color?: string;
};

export function TrainMetricChart({
  trainId,
  trainLabel,
  title,
  metrics,
}: {
  trainId: string;
  trainLabel: string;
  title: string;
  metrics: TrainMetricDef[];
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const cols = ['reading_datetime', ...metrics.map(m => m.key)].join(',');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['train-metric', trainId, metrics.map(m => m.key).join('-'), range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select(cols)
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];
      // Aggregate per day — average readings for that day
      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, { date, _count: 0 });
        const e = byDate.get(date)!;
        e._count++;
        for (const m of metrics) {
          if (r[m.key] != null) e[m.key] = (e[m.key] ?? 0) + +r[m.key];
        }
      }
      return Array.from(byDate.values()).map(e => {
        const out: any = { date: e.date };
        for (const m of metrics) {
          if (e[m.key] != null) out[m.key] = +(e[m.key] / e._count).toFixed(2);
        }
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data to export'); return; }
    const csvCols = ['date', ...metrics.map(m => m.key)];
    const header  = csvCols.join(',');
    const lines   = rows.map(r => csvCols.map(c => r[c] ?? '').join(','));
    const blob    = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `${trainLabel.replace(/\s+/g, '_')}_${metrics[0].key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const PALETTE = ['hsl(174,72%,40%)', 'hsl(216,72%,46%)', 'hsl(38,84%,52%)'];

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => {
          const m = metrics.find(x => x.key === p.dataKey);
          return (
            <p key={p.dataKey} style={{ color: p.fill }}>
              {m?.label ?? p.dataKey}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span> {m?.unit}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      {rows.length > 0 && (() => {
        const firstMetric = metrics[0];
        const vals = rows.map(r => r[firstMetric.key]).filter((v): v is number => v != null);
        const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const max  = vals.length ? Math.max(...vals) : 0;
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Avg</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(avg)}<span className="text-[10px] font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Peak</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(max)}<span className="text-[10px] font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Days</div>
              <div className="font-mono font-semibold text-sm">{rows.length}</div>
            </div>
          </div>
        );
      })()}
      {isLoading ? (
        <div className="flex items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No readings in this period</p>
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 20, left: 0 }} barSize={Math.max(3, Math.min(14, 380 / rows.length))}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)} interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={40}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
              <Tooltip content={customTooltip} />
              {metrics.map((m, i) => (
                <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color ?? PALETTE[i % PALETTE.length]} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── TrainRODetailCharts ──────────────────────────────────────────────────────
// 2×3 grid of mini sparkline cards for RO performance metrics.
// Source: ro_train_readings — no extra tables needed.

export function TrainRODetailCharts({ trainId, trainLabel }: { trainId: string; trainLabel: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['train-ro-detail', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('reading_datetime,permeate_flow,feed_flow,reject_flow,feed_pressure_psi,reject_pressure_psi,permeate_tds,feed_tds,reject_tds,recovery_pct,permeate_meter_delta,temperature_c')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];
      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, { date, _count: 0, perm_vol: 0 });
        const e = byDate.get(date)!;
        e._count++;
        const avgCols = ['permeate_flow','feed_flow','reject_flow','feed_pressure_psi','reject_pressure_psi','permeate_tds','feed_tds','reject_tds','recovery_pct','temperature_c'];
        for (const col of avgCols) if (r[col] != null) e[col] = (e[col] ?? 0) + +r[col];
        if (r.permeate_meter_delta != null && +r.permeate_meter_delta > 0) e.perm_vol += +r.permeate_meter_delta;
      }
      return Array.from(byDate.values()).map(e => {
        const out: any = { date: e.date, permeate_volume: +e.perm_vol.toFixed(2) };
        const avgCols = ['permeate_flow','feed_flow','reject_flow','feed_pressure_psi','reject_pressure_psi','permeate_tds','feed_tds','reject_tds','recovery_pct','temperature_c'];
        for (const col of avgCols) if (e[col] != null) out[col] = +(e[col] / e._count).toFixed(2);
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data'); return; }
    const cols = ['date','permeate_flow','feed_flow','reject_flow','feed_pressure_psi','permeate_tds','recovery_pct','permeate_volume'];
    const blob = new Blob([[cols.join(','), ...rows.map(r => cols.map(c => r[c] ?? '').join(','))].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${trainLabel.replace(/\s+/g, '_')}_ro_performance.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const miniMetrics: { key: string; label: string; unit: string; color: string }[] = [
    { key: 'permeate_flow',     label: 'Permeate Flow',  unit: 'm³/h', color: 'hsl(174,72%,40%)' },
    { key: 'feed_pressure_psi', label: 'Feed Pressure',  unit: 'psi',  color: 'hsl(216,72%,46%)' },
    { key: 'permeate_tds',      label: 'Permeate TDS',   unit: 'ppm',  color: 'hsl(38,84%,52%)'  },
    { key: 'recovery_pct',      label: 'Recovery',       unit: '%',    color: 'hsl(150,60%,40%)' },
    { key: 'reject_flow',       label: 'Reject Flow',    unit: 'm³/h', color: 'hsl(0,65%,50%)'   },
    { key: 'permeate_volume',   label: 'Daily Volume',   unit: 'm³',   color: 'hsl(174,72%,40%)' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">RO Performance</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-36 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No readings in this period</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {miniMetrics.map(m => {
            const vals = rows.map(r => r[m.key]).filter((v): v is number => v != null);
            if (!vals.length) return null;
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const max = Math.max(...vals);
            return (
              <div key={m.key} className="rounded-lg border bg-muted/20 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide truncate">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{m.unit}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-mono font-semibold" style={{ color: m.color }}>{fmtNum(avg)}</span>
                  <span className="text-[10px] text-muted-foreground">avg · pk {fmtNum(max)}</span>
                </div>
                <div className="h-14 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}
                      barSize={Math.max(2, Math.min(8, 200 / Math.max(rows.length, 1)))}>
                      <Bar dataKey={m.key} fill={m.color} radius={[1, 1, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PretreatAFMChart ─────────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → afm_units JSONB.
// Press view: In/Out pressure + ΔP line (daily avg across all units).
// Backwash view: event count bars + avg duration line + avg volume stat.
export function PretreatAFMChart({
  trainId,
  mediaType = 'AFM',
}: {
  trainId: string;
  mediaType?: string;
}) {
  const [range, setRange]       = useState<'30' | '90' | '180' | 'all'>('30');
  const [view, setView]         = useState<'pressure' | 'backwash'>('pressure');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['pretreat-afm', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,afm_units,mmf_readings,backwash_start,backwash_end')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, {
            date,
            _inSum: 0, _inN: 0, _outSum: 0, _outN: 0, _dpSum: 0, _dpN: 0,
            _bwCount: 0, _durSum: 0, _durN: 0, _volSum: 0, _volN: 0,
          });
        const e = byDate.get(date)!;

        for (const u of (r.afm_units ?? []) as any[]) {
          if (u.inlet_psi  != null) { e._inSum  += +u.inlet_psi;  e._inN++;  }
          if (u.outlet_psi != null) { e._outSum += +u.outlet_psi; e._outN++; }
          if (u.dp_psi     != null) { e._dpSum  += +u.dp_psi;     e._dpN++;  }
          if (u.backwash_start && u.backwash_end) {
            e._bwCount++;
            const dur = (new Date(u.backwash_end).getTime() - new Date(u.backwash_start).getTime()) / 60_000;
            if (dur > 0) { e._durSum += dur; e._durN++; }
          }
        }
        if (r.backwash_start && r.backwash_end) {
          e._bwCount++;
          const dur = (new Date(r.backwash_end).getTime() - new Date(r.backwash_start).getTime()) / 60_000;
          if (dur > 0) { e._durSum += dur; e._durN++; }
        }
        for (const m of (r.mmf_readings ?? []) as any[]) {
          if (m.meter_start != null && m.meter_end != null) {
            const vol = Math.max(0, +m.meter_end - +m.meter_start);
            e._volSum += vol; e._volN++;
          }
        }
      }

      return Array.from(byDate.values()).map(e => ({
        date:            e.date,
        inlet_psi:       e._inN  ? +(e._inSum  / e._inN ).toFixed(2) : null,
        outlet_psi:      e._outN ? +(e._outSum / e._outN).toFixed(2) : null,
        dp_psi:          e._dpN  ? +(e._dpSum  / e._dpN ).toFixed(2) : null,
        bw_count:        e._bwCount,
        bw_duration_min: e._durN ? +(e._durSum / e._durN).toFixed(1) : null,
        bw_volume_m3:    e._volN ? +(e._volSum / e._volN).toFixed(3) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const dpVals   = rows.map(r => r.dp_psi).filter((v): v is number => v != null);
  const avgDp    = dpVals.length ? dpVals.reduce((a, b) => a + b, 0) / dpVals.length : 0;
  const maxDp    = dpVals.length ? Math.max(...dpVals) : 0;
  const totalBw  = rows.reduce((s, r) => s + (r.bw_count ?? 0), 0);
  const durRows  = rows.filter(r => r.bw_duration_min != null);
  const avgDur   = durRows.length ? durRows.reduce((s, r) => s + (r.bw_duration_min ?? 0), 0) / durRows.length : 0;
  const volRows  = rows.filter(r => r.bw_volume_m3 != null);
  const avgVol   = volRows.length ? volRows.reduce((s, r) => s + (r.bw_volume_m3 ?? 0), 0) / volRows.length : 0;

  const barSize = Math.max(3, Math.min(14, 360 / Math.max(rows.length, 1)));

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const unit = (key: string) =>
      key === 'inlet_psi' || key === 'outlet_psi' || key === 'dp_psi' ? 'psi'
      : key === 'bw_duration_min' ? 'min'
      : key === 'bw_volume_m3'   ? 'm³'
      : '';
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke ?? p.fill }}>
            {p.name}:{' '}
            <span className="font-mono font-semibold">{fmtNum(p.value)}</span>{' '}
            {unit(p.dataKey)}
          </p>
        ))}
      </div>
    );
  };

  const RangeBar = () => (
    <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
      {(['30', '90', '180', 'all'] as const).map(r => (
        <button key={r} onClick={() => setRange(r)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
            ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
          {r === 'all' ? 'All' : `${r}d`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">{mediaType} — Pressure & Backwash</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['pressure', 'backwash'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize transition-colors
                  ${view === v ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {v}
              </button>
            ))}
          </div>
          <RangeBar />
        </div>
      </div>

      {rows.length > 0 && view === 'pressure' && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Avg ΔP',   val: fmtNum(avgDp), unit: 'psi' },
            { label: 'Peak ΔP',  val: fmtNum(maxDp), unit: 'psi' },
            { label: 'BW Total', val: String(totalBw), unit: 'events' },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-[10px] font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && view === 'backwash' && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total BW',     val: String(totalBw),    unit: 'events' },
            { label: 'Avg Duration', val: fmtNum(avgDur, 1),  unit: 'min'    },
            { label: 'Avg Volume',   val: fmtNum(avgVol, 3),  unit: 'm³'     },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-[10px] font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No pre-treatment readings in this period</p>
        </div>
      ) : view === 'pressure' ? (
        <>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
            {[
              { color: 'hsl(216,72%,50%)', label: 'In Pressure' },
              { color: 'hsl(38,84%,52%)',  label: 'Out Pressure' },
              { color: 'hsl(0,65%,50%)',   label: 'ΔP (dashed)' },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36} />
                <Tooltip content={<Tooltip2 />} />
                <Area type="monotone" dataKey="inlet_psi"  name="In Pressure"
                  stroke="hsl(216,72%,50%)" fill="hsl(216,72%,50%)" fillOpacity={0.07}
                  strokeWidth={1.5} dot={false} connectNulls />
                <Area type="monotone" dataKey="outlet_psi" name="Out Pressure"
                  stroke="hsl(38,84%,52%)"  fill="hsl(38,84%,52%)"  fillOpacity={0.07}
                  strokeWidth={1.5} dot={false} connectNulls />
                <Line  type="monotone" dataKey="dp_psi"    name="ΔP"
                  stroke="hsl(0,65%,50%)" strokeWidth={2}
                  strokeDasharray="5 3" dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis yAxisId="cnt" allowDecimals={false}
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={28} />
              <YAxis yAxisId="dur" orientation="right"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={38}
                tickFormatter={(v: number) => `${v}m`} />
              <Tooltip content={<Tooltip2 />} />
              <Bar yAxisId="cnt" dataKey="bw_count" name="BW Events"
                fill="hsl(270,55%,58%)" radius={[2, 2, 0, 0]} barSize={barSize} />
              <Line yAxisId="dur" type="monotone" dataKey="bw_duration_min" name="Avg Duration"
                stroke="hsl(174,72%,40%)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── PretreatBoosterChart ─────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → booster_pumps JSONB.
// Shows target_pressure_psi (psi mode) and/or target_hz (Hz mode).
export function PretreatBoosterChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['pretreat-booster', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,booster_pumps')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, { date, _psiSum: 0, _psiN: 0, _hzSum: 0, _hzN: 0 });
        const e = byDate.get(date)!;
        for (const p of (r.booster_pumps ?? []) as any[]) {
          if (p.target_pressure_psi != null) { e._psiSum += +p.target_pressure_psi; e._psiN++; }
          if (p.target_hz           != null) { e._hzSum  += +p.target_hz;           e._hzN++;  }
        }
      }
      return Array.from(byDate.values()).map(e => ({
        date:       e.date,
        target_psi: e._psiN ? +(e._psiSum / e._psiN).toFixed(2) : null,
        target_hz:  e._hzN  ? +(e._hzSum  / e._hzN ).toFixed(2) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const psiVals = rows.map(r => r.target_psi).filter((v): v is number => v != null);
  const hzVals  = rows.map(r => r.target_hz ).filter((v): v is number => v != null);
  const hasPsi  = psiVals.length > 0;
  const hasHz   = hzVals.length  > 0;
  const avgPsi  = hasPsi ? psiVals.reduce((a, b) => a + b, 0) / psiVals.length : 0;
  const avgHz   = hasHz  ? hzVals .reduce((a, b) => a + b, 0) / hzVals.length  : 0;

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}:{' '}
            <span className="font-mono font-semibold">{fmtNum(p.value)}</span>{' '}
            {p.dataKey === 'target_psi' ? 'psi' : 'Hz'}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">Booster Pump — Target Setting</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
                ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div className={`grid gap-2 ${hasPsi && hasHz ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>
          {hasPsi && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Avg Target (PSI)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgPsi)}<span className="text-[10px] font-normal ml-0.5">psi</span>
              </div>
            </div>
          )}
          {hasHz && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Avg Target (Hz)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgHz)}<span className="text-[10px] font-normal ml-0.5">Hz</span>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No pre-treatment readings in this period</p>
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              {hasPsi && (
                <YAxis yAxisId="psi"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36}
                  tickFormatter={(v: number) => String(v)} />
              )}
              {hasHz && (
                <YAxis yAxisId="hz" orientation={hasPsi ? 'right' : 'left'}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={40}
                  tickFormatter={(v: number) => `${v}Hz`} />
              )}
              <Tooltip content={<Tooltip2 />} />
              {hasPsi && (
                <Line yAxisId="psi" type="monotone" dataKey="target_psi" name="Target (psi)"
                  stroke="hsl(216,72%,46%)" strokeWidth={2} dot={false} connectNulls />
              )}
              {hasHz && (
                <Line yAxisId="hz" type="monotone" dataKey="target_hz" name="Target (Hz)"
                  stroke="hsl(38,84%,52%)" strokeWidth={2} dot={false} connectNulls strokeDasharray="5 3" />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── PretreatHPPChart ─────────────────────────────────────────────────────────
// Dual-source: hpp_target_pressure_psi from ro_pretreatment_readings (target)
// overlaid with feed_pressure_psi from ro_train_readings (achieved).
export function PretreatHPPChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['pretreat-hpp', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();

      const [ptRes, roRes] = await Promise.all([
        (supabase.from('ro_pretreatment_readings' as any) as any)
          .select('reading_datetime,hpp_target_pressure_psi')
          .eq('train_id', trainId).gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true }),
        (supabase.from('ro_train_readings' as any) as any)
          .select('reading_datetime,feed_pressure_psi,reject_pressure_psi')
          .eq('train_id', trainId).gte('reading_datetime', since)
          .order('reading_datetime', { ascending: true }),
      ]);

      const byDate = new Map<string, any>();
      const ensureDate = (d: string) => {
        if (!byDate.has(d))
          byDate.set(d, { date: d, _tgtSum: 0, _tgtN: 0, _feedSum: 0, _feedN: 0, _rejSum: 0, _rejN: 0 });
        return byDate.get(d)!;
      };
      for (const r of (ptRes.data ?? []) as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10); if (!date) continue;
        const e = ensureDate(date);
        if (r.hpp_target_pressure_psi != null) { e._tgtSum += +r.hpp_target_pressure_psi; e._tgtN++; }
      }
      for (const r of (roRes.data ?? []) as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10); if (!date) continue;
        const e = ensureDate(date);
        if (r.feed_pressure_psi   != null) { e._feedSum += +r.feed_pressure_psi;   e._feedN++; }
        if (r.reject_pressure_psi != null) { e._rejSum  += +r.reject_pressure_psi; e._rejN++;  }
      }
      return Array.from(byDate.values()).map(e => ({
        date:        e.date,
        hpp_target:  e._tgtN  ? +(e._tgtSum  / e._tgtN ).toFixed(1) : null,
        feed_actual: e._feedN ? +(e._feedSum  / e._feedN).toFixed(1) : null,
        reject_psi:  e._rejN  ? +(e._rejSum   / e._rejN ).toFixed(1) : null,
      })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const tgtVals  = rows.map(r => r.hpp_target ).filter((v): v is number => v != null);
  const feedVals = rows.map(r => r.feed_actual).filter((v): v is number => v != null);
  const avgTgt   = tgtVals .length ? tgtVals .reduce((a, b) => a + b, 0) / tgtVals.length  : null;
  const avgFeed  = feedVals.length ? feedVals.reduce((a, b) => a + b, 0) / feedVals.length  : null;

  const Tooltip2 = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span> psi
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">HPP — Target vs Actual Pressure</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
                ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
            {[
              { color: 'hsl(216,72%,46%)', label: 'Feed (actual)', dashed: false },
              { color: 'hsl(174,72%,40%)', label: 'HPP Target',    dashed: true  },
              { color: 'hsl(0,65%,50%)',   label: 'Reject',        dashed: false },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="inline-block w-4 h-0.5 rounded" style={{
                  background: l.dashed
                    ? `repeating-linear-gradient(90deg,${l.color} 0,${l.color} 4px,transparent 4px,transparent 7px)`
                    : l.color
                }} />
                {l.label}
              </span>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap text-xs">
            {avgTgt  != null && (
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide block">Avg Target</span>
                <span className="font-mono font-semibold">{fmtNum(avgTgt)} <span className="font-normal text-[10px]">psi</span></span>
              </div>
            )}
            {avgFeed != null && (
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide block">Avg Feed</span>
                <span className="font-mono font-semibold">{fmtNum(avgFeed)} <span className="font-normal text-[10px]">psi</span></span>
              </div>
            )}
          </div>
        </>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No readings in this period</p>
        </div>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36} />
              <Tooltip content={<Tooltip2 />} />
              <Area type="monotone" dataKey="feed_actual" name="Feed (actual)"
                stroke="hsl(216,72%,46%)" fill="hsl(216,72%,46%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="hpp_target" name="HPP Target"
                stroke="hsl(174,72%,40%)" strokeWidth={2}
                strokeDasharray="5 3" dot={false} connectNulls />
              <Line type="monotone" dataKey="reject_psi" name="Reject"
                stroke="hsl(0,65%,50%)" strokeWidth={1.5} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── PretreatCFChart ──────────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → cartridge_filter_housings JSONB.
// Shows In/Out pressure and computed ΔP per day (avg across all housing units).
export function PretreatCFChart({
  trainId,
  filterType = 'Cartridge Filter',
}: {
  trainId: string;
  filterType?: string;
}) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['pretreat-cf', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await (supabase.from('ro_pretreatment_readings' as any) as any)
        .select('reading_datetime,cartridge_filter_housings')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];

      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date))
          byDate.set(date, { date, _inSum: 0, _inN: 0, _outSum: 0, _outN: 0 });
        const e = byDate.get(date)!;
        for (const h of (r.cartridge_filter_housings ?? []) as any[]) {
          if (h.in_psi  != null) { e._inSum  += +h.in_psi;  e._inN++;  }
          if (h.out_psi != null) { e._outSum += +h.out_psi; e._outN++; }
        }
      }
      return Array.from(byDate.values()).map(e => {
        const inP  = e._inN  ? +(e._inSum  / e._inN ).toFixed(2) : null;
        const outP = e._outN ? +(e._outSum / e._outN).toFixed(2) : null;
        const dp   = inP != null && outP != null ? +(inP - outP).toFixed(2) : null;
        return { date: e.date, in_psi: inP, out_psi: outP, dp_psi: dp };
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const dpVals  = rows.map(r => r.dp_psi).filter((v): v is number => v != null);
  const avgDp   = dpVals.length ? dpVals.reduce((a, b) => a + b, 0) / dpVals.length : 0;
  const maxDp   = dpVals.length ? Math.max(...dpVals) : 0;
  const inVals  = rows.map(r => r.in_psi ).filter((v): v is number => v != null);
  const avgIn   = inVals.length ? inVals.reduce((a, b) => a + b, 0) / inVals.length  : 0;

  const label = filterType === 'Bag Filter' ? 'Filter Housing' : 'CF Housing';

  const Tooltip2 = ({ active, payload, label: lbl }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5">
        <p className="font-semibold text-foreground mb-1">{lbl}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.stroke }}>
            {p.name}: <span className="font-mono font-semibold">{fmtNum(p.value)}</span> psi
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold">{label} — In / Out / ΔP</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors
                ${range === r ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Avg In',   val: fmtNum(avgIn),  unit: 'psi' },
            { label: 'Avg ΔP',  val: fmtNum(avgDp),  unit: 'psi' },
            { label: 'Peak ΔP', val: fmtNum(maxDp),  unit: 'psi' },
          ].map(s => (
            <div key={s.label} className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-[10px] font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
          {[
            { color: 'hsl(216,72%,50%)', label: 'In Pressure',  dashed: false },
            { color: 'hsl(38,84%,52%)',  label: 'Out Pressure', dashed: false },
            { color: 'hsl(0,65%,50%)',   label: 'ΔP',          dashed: true  },
          ].map(l => (
            <span key={l.label} className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 rounded" style={{
                background: l.dashed
                  ? `repeating-linear-gradient(90deg,${l.color} 0,${l.color} 4px,transparent 4px,transparent 7px)`
                  : l.color
              }} />
              {l.label}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-xs text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-30" /><p>No pre-treatment readings in this period</p>
        </div>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 22, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="date"
                tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval="preserveStartEnd" angle={-30} textAnchor="end" height={36} />
              <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={36} />
              <Tooltip content={<Tooltip2 />} />
              <Area type="monotone" dataKey="in_psi"  name="In Pressure"
                stroke="hsl(216,72%,50%)" fill="hsl(216,72%,50%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Area type="monotone" dataKey="out_psi" name="Out Pressure"
                stroke="hsl(38,84%,52%)" fill="hsl(38,84%,52%)" fillOpacity={0.08}
                strokeWidth={1.5} dot={false} connectNulls />
              <Line  type="monotone" dataKey="dp_psi" name="ΔP"
                stroke="hsl(0,65%,50%)" strokeWidth={2}
                strokeDasharray="5 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── recalculateTrainDeltas ──────────────────────────────────────────────────
//
// Recomputes permeate_meter_delta for EVERY reading of an RO train in strict
// chronological order.  Call this whenever the permeate_meter baseline changes:
//
//   • is_meter_replacement toggled on or off  (toggleMeterReplacement below)
//   • DataAnalysis applies a permeate_meter correction  (DataAnalysis.tsx)
//   • A new reading is inserted between existing rows
//       → HOOK POINT in ROTrains.tsx: call recalculateTrainDeltas(trainId) at
//         the end of the submit() handler after every successful insert.
//
// ── HYBRID STRATEGY ──────────────────────────────────────────────────────────
// After every successful DB write this function also calls deltaCache.set() with
// the freshly-computed delta so the Dashboard and TrendChart pick up the new
// value immediately (Tier-1 cache shortcut) without waiting for a refetch.
// If permeate_meter is null the cache entry for that (trainId, dateKey) is
// cleared via deltaCache.invalidate() so consumers fall back to Tier-2 raw
// computation on the next render.
//
// Rules:
//   is_meter_replacement = true  → delta = 0; baseline still advances
//   Normal row, prev available   → delta = max(0, current − prev)
//   First row / meter is null    → delta = null
async function recalculateTrainDeltas(trainId: string): Promise<void> {
  try {
    const { data: rows } = await (supabase.from('ro_train_readings' as any) as any)
      .select('id, permeate_meter, permeate_meter_delta, is_meter_replacement, reading_datetime')
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: true });

    if (!rows?.length) return;

    let prevMeter: number | null = null;

    for (const row of rows as any[]) {
      const isRepl   = !!row.is_meter_replacement;
      const curMeter = row.permeate_meter != null ? +row.permeate_meter : null;
      const stored   = row.permeate_meter_delta != null ? +row.permeate_meter_delta : null;
      // Date key for cache population (yyyy-MM-dd local)
      const dateKey  = row.reading_datetime
        ? new Date(row.reading_datetime).toLocaleDateString('en-CA') // YYYY-MM-DD
        : null;

      let newDelta: number | null;
      if (isRepl) {
        newDelta = 0;
      } else if (prevMeter != null && curMeter != null) {
        newDelta = Math.max(0, curMeter - prevMeter);
      } else {
        newDelta = null;
      }

      // Always advance baseline — replacement rows still set the new meter floor
      if (curMeter != null) prevMeter = curMeter;

      // Only write to DB when the value has actually changed
      if (newDelta !== stored) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ permeate_meter_delta: newDelta })
          .eq('id', row.id);
      }

      // ── HYBRID STRATEGY: sync in-memory delta cache ──────────────────────
      // Always update the cache after the DB write (even if the stored value
      // didn't change) so consumers get the backend-verified value immediately.
      if (dateKey) {
        if (newDelta !== null) {
          // Mark as 'stored' — value now matches the backend authoritative value.
          deltaCache.set(trainId, dateKey, newDelta, 'stored');
        } else {
          // No computable delta for this row — remove stale cache entry so Tier-2
          // raw computation runs on the next render rather than returning 0.
          deltaCache.invalidate(trainId);
        }
      }
    }
  } catch {
    // Non-critical — log and continue
  }
}

// ─── Train Operator Log Modal ─────────────────────────────────────────────────
// Full paginated operator log with all columns + meter-replacement toggle,
// matching the Operations reading-history pattern.

export function TrainOperatorLogModal({
  trainId,
  trainLabel,
  onClose,
}: {
  trainId: string;
  trainLabel: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Date range — default last 30 days
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgoStr = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgoStr);
  const [dateTo, setDateTo]     = useState(todayStr);
  const [rangePreset, setRangePreset] = useState<'7' | '30' | '90' | 'custom'>('30');

  const applyPreset = (p: '7' | '30' | '90') => {
    const days = parseInt(p);
    setDateFrom(format(new Date(Date.now() - days * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'));
    setDateTo(todayStr);
    setRangePreset(p);
    setPage(0);
  };

  const untilNextDay = dateTo
    ? (() => {
        const [y, m, d] = dateTo.split('-').map(Number);
        const next = new Date(y, m - 1, d + 1);
        return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      })()
    : null;

  const queryKey = ['train-operator-log', trainId, dateFrom, untilNextDay];

  const { data: logs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        // Columns added by migration — may not exist in un-migrated DBs.
        // Try full select first; if Supabase returns a schema error for any
        // new column, fall back to the original safe set so logs always load.
        // Column tiers — each retry drops only the columns that failed.
        // This way is_meter_replacement stays in the query once it exists in DB,
        // even if other newer columns (remarks, reject_flow etc.) are still missing.
        const ALL_COLS = [
          'id', 'reading_datetime', 'recorded_by',
          'permeate_flow', 'feed_flow', 'reject_flow',
          'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
          'feed_tds', 'permeate_tds', 'reject_tds',
          'feed_ph', 'permeate_ph', 'temperature_c', 'turbidity_ntu',
          'recovery_pct',
          'permeate_meter', 'permeate_meter_prev', 'permeate_meter_delta',
          'is_meter_replacement', 'remarks',
        ];
        // Tier 2: drop migration-only columns (remarks, permeate_meter_prev) but
        // keep all original schema columns so Rej. Flow / Suction / Temp etc. display.
        const TIER2_COLS = [
          'id', 'reading_datetime', 'recorded_by',
          'permeate_flow', 'feed_flow', 'reject_flow',
          'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
          'feed_tds', 'permeate_tds', 'reject_tds',
          'temperature_c', 'recovery_pct',
          'permeate_meter', 'permeate_meter_delta',
          'is_meter_replacement',
        ];
        // Tier 3: absolute minimum — original columns only, no migration deps
        const TIER3_COLS = [
          'id', 'reading_datetime', 'recorded_by',
          'permeate_flow', 'feed_flow', 'reject_flow',
          'feed_pressure_psi', 'reject_pressure_psi', 'suction_pressure_psi',
          'feed_tds', 'permeate_tds', 'reject_tds',
          'temperature_c', 'recovery_pct',
          'permeate_meter',
        ];

        const buildQ = (cols: string[]) => {
          let q = (supabase.from('ro_train_readings' as any) as any)
            .select(cols.join(','))
            .eq('train_id', trainId)
            .order('reading_datetime', { ascending: false })
            .limit(2000);
          if (dateFrom)     q = q.gte('reading_datetime', `${dateFrom}T00:00:00`);
          if (untilNextDay) q = q.lt('reading_datetime',  `${untilNextDay}T00:00:00`);
          return q;
        };

        // Try each tier in order — stop at first success
        let readings: any[] | null = null;
        for (const tier of [ALL_COLS, TIER2_COLS, TIER3_COLS]) {
          const { data, error } = await buildQ(tier);
          if (!error) { readings = data ?? []; break; }
          // If the error isn't about a missing column, stop retrying — it's a real error
          const isMissingCol = error.message.includes('column') || error.message.includes('does not exist');
          if (!isMissingCol) { console.error('operator log fetch:', error); break; }
        }
        if (!readings?.length) return [];

        // Compute permeate_meter_delta in-memory from consecutive permeate_meter values.
        // Rows are sorted descending; reverse to ascending so prev-curr diff is correct.
        //
        // FIX: previously lastMeter was only updated inside the
        //   `if (permeate_meter_delta == null)` branch, so any row that already had a
        //   stored delta (even a wrong one written before DataAnalysis correction) would
        //   freeze the baseline.  Every subsequent null-delta row then computed against
        //   a stale previous reading, inflating or deflating its computed delta.
        //
        // Now:
        //   • lastMeter ALWAYS advances to the current row's permeate_meter.
        //   • _computed_delta is set for EVERY row that has a permeate_meter — it
        //     uses the corrected meter value, so DataAnalysis corrections to
        //     permeate_meter are reflected immediately without waiting for the stored
        //     permeate_meter_delta to be back-filled.
        const ascReadings = [...(readings as any[])].reverse();
        const lastMeter = new Map<string, number>(); // trainId → last seen permeate_meter
        ascReadings.forEach((r: any) => {
          if (r.permeate_meter != null) {
            const prev = lastMeter.get(r.train_id ?? trainId);
            // Always compute from meter readings — overrides stored delta which may
            // have been derived from a permeate_meter value that was later corrected.
            r._computed_delta = prev != null ? Math.max(0, +r.permeate_meter - prev) : null;
            lastMeter.set(r.train_id ?? trainId, +r.permeate_meter);
          }
        });

        // Resolve operator names
        const uids = [...new Set((readings as any[]).map((r: any) => r.recorded_by).filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (uids.length) {
          for (const table of ['user_profiles', 'profiles']) {
            const { data: pdata, error: perr } = await (supabase.from(table as any) as any)
              .select('id, first_name, last_name, username').in('id', uids);
            if (!perr && pdata?.length) {
              profileMap = Object.fromEntries(
                (pdata as any[]).map((p: any) => {
                  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.username?.trim() || '';
                  return [p.id, name || null];
                }).filter(([, n]) => n)
              );
              if (Object.keys(profileMap).length) break;
            }
          }
        }
        return (readings as any[]).map((r: any) => ({
          ...r,
          _operatorName: profileMap[r.recorded_by] ?? (r.recorded_by ? `UID:${String(r.recorded_by).slice(0, 8)}` : 'Unknown'),
        }));
      } catch (err) {
        console.error('operator log error:', err);
        return [];
      }
    },
    staleTime: 30_000,
    gcTime: 60_000,
  });

  // Toggle is_meter_replacement on a row (manager-only).
  // Toggling ON  → this row's delta becomes 0 in TrendChart / Dashboard.
  // Toggling OFF → this row's delta must be recalculated from actual meter readings.
  // Either way, a full cascade recalculation runs for the entire train so every
  // downstream row's delta stays consistent with the updated baseline.
  const toggleMeterReplacement = async (r: any) => {
    if (!isManager) return;
    setTogglingId(r.id);
    const next = !r.is_meter_replacement;
    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update({ is_meter_replacement: next }).eq('id', r.id);
    setTogglingId(null);
    if (error) {
      toast.error('is_meter_replacement column missing — run: ALTER TABLE ro_train_readings ADD COLUMN IF NOT EXISTS is_meter_replacement BOOLEAN DEFAULT FALSE');
      return;
    }

    // ── HYBRID STRATEGY: flush delta cache for this train ────────────────────
    // Toggling is_meter_replacement changes the delta of every row that follows
    // this one in the sequence.  Clear the entire train's cache entries so the
    // next render recomputes from Tier-2 raw data.  recalculateTrainDeltas below
    // will then re-populate the cache with corrected Tier-1 (stored) values.
    deltaCache.invalidate(r.train_id ?? trainId);

    // Full cascade: recompute permeate_meter_delta for every row in this train
    // so the changed flag propagates correctly through the entire meter sequence.
    // recalculateTrainDeltas also re-populates deltaCache with the new values.
    await recalculateTrainDeltas(r.train_id ?? trainId);

    toast.success(
      next
        ? 'Marked as meter replacement — Δ zeroed and downstream deltas recalculated'
        : 'Replacement flag removed — Δ recalculated from actual meter readings',
    );
    qc.invalidateQueries({ queryKey });
    // Invalidate Dashboard / TrendChart so the corrected production totals appear immediately
    qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries({ queryKey: ['trend-ro-train-ids'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    // DataSummaryModal Production tab reads dsm-ro-readings directly
    qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
    qc.invalidateQueries();
  };

  const totalPages = Math.ceil(logs.length / PAGE_SIZE);
  const pageLogs   = logs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const fmtVal = (v: any, unit = '') =>
    v != null ? <span>{Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}<span className="text-muted-foreground/60 ml-0.5 text-[10px]">{unit}</span></span>
              : <span className="text-muted-foreground/30">—</span>;

  const exportCSV = () => {
    if (!logs.length) { toast.error('No logs to export'); return; }
    const headers = [
      'Date/Time','Operator','Meter Repl.',
      'Perm Flow (m³/h)','Feed Flow (m³/h)','Reject Flow (m³/h)',
      'Feed Press (psi)','Reject Press (psi)','Suction Press (psi)',
      'Feed TDS (ppm)','Perm TDS (ppm)','Reject TDS (ppm)',
      'Feed pH','Perm pH','Temp (°C)','Turbidity (NTU)',
      'Recovery (%)','Perm Meter Curr','Perm Meter Prev','Perm Delta (m³)',
      'Remarks',
    ];
    const csvRows = logs.map((r: any) => [
      r.reading_datetime ? format(new Date(r.reading_datetime), 'yyyy-MM-dd HH:mm') : '',
      r._operatorName ?? 'Unknown',
      r.is_meter_replacement ? 'YES' : '',
      r.permeate_flow ?? '', r.feed_flow ?? '', r.reject_flow ?? '',
      r.feed_pressure_psi ?? '', r.reject_pressure_psi ?? '', r.suction_pressure_psi ?? '',
      r.feed_tds ?? '', r.permeate_tds ?? '', r.reject_tds ?? '',
      r.feed_ph ?? '', r.permeate_ph ?? '', r.temperature_c ?? '', r.turbidity_ntu ?? '',
      r.recovery_pct ?? '',
      r.permeate_meter ?? '', r.permeate_meter_prev ?? '', r.permeate_meter_delta ?? '',
      r.remarks ?? '',
    ].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `${trainLabel.replace(/\s+/g, '_')}_operator_log.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Log exported');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-[95vw] w-full max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden"
        onInteractOutside={() => onClose()}
      >
        <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <div className="text-base font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-teal-600 shrink-0" />
              <span className="truncate">Operator Log — {trainLabel}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              All readings submitted for this RO train · {isManager ? 'Click orange checkbox to flag meter replacement' : 'Managers can flag meter replacements'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mr-8">
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={exportCSV}>
              <Download className="h-3 w-3" /><span className="hidden sm:inline">Export CSV</span>
            </Button>
          </div>
        </div>

        {/* ── Filters bar ── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20 shrink-0 flex-wrap">
          {(['7','30','90'] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={[
                'h-6 px-2 rounded text-xs font-medium border transition-colors',
                rangePreset === p
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-background border-input text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >{p}d</button>
          ))}
          <input
            type="date" value={dateFrom} max={dateTo || todayStr}
            onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <input
            type="date" value={dateTo} min={dateFrom} max={todayStr}
            onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
          {!isLoading && (
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="font-semibold text-foreground">{logs.length}</span> {logs.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {/* ── Log table ── */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Calendar className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm font-medium">No logs found</p>
              <p className="text-xs mt-0.5">Try expanding the date range.</p>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background border-b z-10">
                <tr className="text-muted-foreground uppercase tracking-wide text-[10px]">
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap w-[130px]">Date / Time</th>
                  <th className="text-left px-2 py-2 font-semibold w-[110px]">Operator</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. Flow</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed Press.</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. Press.</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Suction</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Feed TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Rej. TDS</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Temp</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Recovery</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Perm Meter</th>
                  <th className="text-right px-2 py-2 font-semibold whitespace-nowrap">Δ m³</th>
                  <th className="px-2 py-2 font-semibold text-center text-orange-600 whitespace-nowrap w-[54px]" title="Meter Replacement — flags reading as meter change; zeroes Δ in chart">Repl.</th>
                  <th className="text-left px-2 py-2 font-semibold">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageLogs.map((r: any, i: number) => {
                  const isRepl     = !!r.is_meter_replacement;
                  const isToggling = togglingId === r.id;
                  const opName     = r._operatorName ?? 'Unknown';
                  const initials   = opName !== 'Unknown'
                    ? opName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
                    : '?';
                  return (
                    <tr
                      key={r.id ?? i}
                      className={[
                        'border-t transition-colors',
                        isRepl ? 'bg-orange-50/40 dark:bg-orange-950/10' : 'hover:bg-muted/30',
                      ].join(' ')}
                    >
                      {/* Date / Time */}
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground font-mono text-[11px]">
                        <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                        <div className="flex items-center gap-1">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}
                          {isRepl && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-orange-600 bg-orange-100 dark:bg-orange-900/30 px-1 py-0.5 rounded leading-none">repl.</span>
                          )}
                        </div>
                      </td>
                      {/* Operator */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[9px] font-bold shrink-0">
                            {initials}
                          </div>
                          <span className="truncate max-w-[80px]" title={opName}>{opName}</span>
                        </div>
                      </td>
                      {/* Flow */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.permeate_flow, 'm³/h')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_flow, 'm³/h')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_flow, 'm³/h')}</td>
                      {/* Pressure */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_pressure_psi, 'psi')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_pressure_psi, 'psi')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.suction_pressure_psi, 'psi')}</td>
                      {/* Quality */}
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.feed_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.permeate_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.reject_tds, 'ppm')}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtVal(r.temperature_c, '°C')}</td>
                      {/* Recovery */}
                      <td className="px-2 py-2 text-right font-mono">
                        {r.recovery_pct != null
                          ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">{Number(r.recovery_pct).toFixed(1)}%</span>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {/* Permeate meter */}
                      <td className="px-2 py-2 text-right font-mono text-[11px]">{fmtVal(r.permeate_meter, 'm³')}</td>
                      {/* Δ m³ — prefer in-memory delta (computed from corrected permeate_meter)
                           over the stored permeate_meter_delta, which may have been written
                           before DataAnalysis corrected the underlying meter reading. */}
                      <td className="px-2 py-2 text-right font-mono text-[11px]">
                        {(() => {
                          // _computed_delta is always available when permeate_meter exists and
                          // there is a predecessor row.  Fall back to stored delta only when
                          // _computed_delta is null (e.g. first-ever reading for this train).
                          const d = r._computed_delta ?? (r.permeate_meter_delta != null ? +r.permeate_meter_delta : null);
                          if (d == null) return <span className="text-muted-foreground/30">—</span>;
                          if (isRepl) return <span className="text-orange-500 font-medium">0</span>;
                          return d > 0
                            ? <span className="text-teal-600 dark:text-teal-400">+{d.toLocaleString(undefined,{maximumFractionDigits:1})}</span>
                            : <span className="text-muted-foreground/40">0</span>;
                        })()}
                      </td>
                      {/* Meter replacement toggle — next to Perm Meter / Δ */}
                      <td className="px-2 py-2 text-center">
                        <button
                          title={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                          disabled={!isManager || isToggling}
                          onClick={() => toggleMeterReplacement(r)}
                          className={[
                            'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                            !isManager ? 'opacity-30 cursor-not-allowed' : 'disabled:opacity-40 disabled:cursor-not-allowed',
                            isRepl
                              ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                              : 'border-input bg-background hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20',
                          ].join(' ')}
                        >
                          {isToggling
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : isRepl ? <span className="text-[9px] font-bold leading-none">✓</span> : null
                          }
                        </button>
                      </td>
                      {/* Remarks */}
                      <td className="px-2 py-2 text-muted-foreground max-w-[140px] truncate" title={r.remarks ?? ''}>{r.remarks || <span className="opacity-30">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination footer ── */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t shrink-0">
          <span className="text-xs text-muted-foreground">
            {totalPages > 1 ? `Page ${page + 1} of ${totalPages} · ` : ''}{logs.length} {logs.length === 1 ? 'entry' : 'entries'}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Trains List ─────────────────────────────────────────────────────────────

