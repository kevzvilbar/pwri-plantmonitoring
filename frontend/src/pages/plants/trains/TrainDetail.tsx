import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { cn } from '@/lib/utils';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { DataState } from '@/components/DataState';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Droplet, AlertTriangle, Maximize2, CalendarIcon } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area, Scatter, Legend } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, parseISO, subDays, isValid } from 'date-fns';


import { PLANT_CHEMICALS } from '../shared';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';

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
    hpp_target_pressure_psi: train.hpp_target_pressure_psi != null ? String(train.hpp_target_pressure_psi) : '',
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

  // Booster pump target setpoints — separate from `form` since it's a
  // per-unit map, not a flat field. Same JSONB shape the reading form and
  // the 20260807_ro_trains_booster_pump_targets.sql migration both use:
  // { psi_mode: bool, targets: { "<unit>": number } }.
  const parsedBoosterTargets = useMemo(() => {
    const raw = train.booster_pump_targets as any;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { psi_mode: raw.psi_mode !== false, targets: (raw.targets ?? {}) as Record<string, number> };
    }
    return { psi_mode: true, targets: {} as Record<string, number> };
  }, [train.booster_pump_targets]);
  const [boosterPsiMode, setBoosterPsiMode] = useState(parsedBoosterTargets.psi_mode);
  const [boosterTargets, setBoosterTargets] = useState<Record<number, string>>(() => {
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsedBoosterTargets.targets)) {
      if (v != null) out[Number(k)] = String(v);
    }
    return out;
  });

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
      booster_pump_targets: num(form.num_booster_pumps) > 0
        ? {
            psi_mode: boosterPsiMode,
            targets: Object.fromEntries(
              Array.from({ length: num(form.num_booster_pumps) }, (_, i) => i + 1)
                .filter(u => (boosterTargets[u] ?? '') !== '')
                .map(u => [String(u), Number(boosterTargets[u])]),
            ),
          }
        : null,
      num_hp_pumps: num(form.num_hp_pumps),
      hpp_target_pressure_psi: form.hpp_target_pressure_psi === '' ? null : Number(form.hpp_target_pressure_psi),
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
    if (error) { toast.error(friendlyError(error)); return; }
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
                  aria-label={`Decrease ${mediaType} units`}
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
                  aria-label={`Increase ${mediaType} units`}
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
                  aria-label={`Decrease ${filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'} count`}
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
                  aria-label={`Increase ${filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'} count`}
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
                  aria-label="Decrease Booster Pumps"
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
                  aria-label="Increase Booster Pumps"
                  onClick={() => setForm({ ...form, num_booster_pumps: String(num(form.num_booster_pumps) + 1) })}
                  data-testid="inc-bp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* Booster pump target setpoints — configured once here instead
                of retyped on every pre-treatment/RO reading, see
                20260807_ro_trains_booster_pump_targets.sql for why. Mode is
                one toggle for the whole train (matches the reading form's
                own global psi/Hz toggle, which already applies to every
                pump on the train at once). Amperage is intentionally not
                here — it's a per-reading measurement, not a setpoint. */}
            {num(form.num_booster_pumps) > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Booster Pump Targets</Label>
                  <div className="flex rounded-full border border-border overflow-hidden text-2xs font-semibold">
                    <button type="button" onClick={() => setBoosterPsiMode(true)}
                      className={cn('px-2.5 py-0.5 transition-colors',
                        boosterPsiMode ? 'bg-primary text-white' : 'bg-background text-muted-foreground hover:bg-muted')}>
                      psi
                    </button>
                    <button type="button" onClick={() => setBoosterPsiMode(false)}
                      className={cn('px-2.5 py-0.5 transition-colors',
                        !boosterPsiMode ? 'bg-primary text-white' : 'bg-background text-muted-foreground hover:bg-muted')}>
                      Hz
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {Array.from({ length: num(form.num_booster_pumps) }, (_, i) => i + 1).map((u) => (
                    <div key={u} className="flex items-center gap-2">
                      <span className="text-2xs font-medium text-muted-foreground w-14 shrink-0">Pump {u}</span>
                      <Input
                        type="number" step="any" min={0}
                        placeholder={boosterPsiMode ? 'psi — leave blank to enter per reading' : 'Hz — leave blank to enter per reading'}
                        value={boosterTargets[u] ?? ''}
                        onChange={(e) => setBoosterTargets({ ...boosterTargets, [u]: e.target.value })}
                        className="h-8 text-xs font-mono-num"
                        data-testid={`booster-target-${u}`}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-2xs text-muted-foreground">
                  Leave a pump blank to keep entering its target manually per reading.
                </p>
              </div>
            )}

            {/* HP pumps */}
            <div>
              <Label className="text-xs">High-Pressure Pumps (HPP)</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  aria-label="Decrease High-Pressure Pumps"
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
                  aria-label="Increase High-Pressure Pumps"
                  onClick={() => setForm({ ...form, num_hp_pumps: String(num(form.num_hp_pumps) + 1) })}
                  data-testid="inc-hpp"
                >
                  +
                </Button>
              </div>
            </div>

            {/* HPP target pressure — configured once here instead of retyped
                on every pre-treatment/RO reading, see 20260807_ro_trains_hpp_
                target_pressure_setpoint.sql for why. */}
            <div>
              <Label className="text-xs">HPP Target Pressure (psi)</Label>
              <Input
                type="number"
                step="any"
                min={0}
                placeholder="e.g. 180"
                value={form.hpp_target_pressure_psi}
                onChange={(e) => setForm({ ...form, hpp_target_pressure_psi: e.target.value })}
                className="mt-1 font-mono-num"
                data-testid="hpp-target-pressure-input"
              />
              <p className="text-2xs text-muted-foreground mt-1">
                Auto-fills on every reading for this train. Leave blank to keep entering it manually per reading.
              </p>
            </div>

            {/* Controllers */}
            <div>
              <Label className="text-xs">Controllers</Label>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  aria-label="Decrease Controllers"
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
                  aria-label="Increase Controllers"
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
                  aria-label="Decrease Filter Housings"
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
                  aria-label="Increase Filter Housings"
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
                  <span className="ml-2 text-2xs text-accent font-normal">
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
              <p className="text-2xs text-muted-foreground mt-1">AFM = Active Filter Media · MMF = Multi-Media Filter</p>
            </div>

            {/* Pre-filter housing type */}
            <div>
              <Label className="text-xs mb-1.5 block">
                Pre-filter Housing Type
                {usingPlantFilter && (
                  <span className="ml-2 text-2xs text-accent font-normal">
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
              <p className="text-2xs text-warn">
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

  const { data: rows = [], isLoading, error, refetch } = useQuery<{ date: string; volume: number }[]>({
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
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Production History</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30','90','180','all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
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
            <div className="text-muted-foreground text-2xs uppercase">Days</div>
            <div className="font-mono font-semibold text-base">{rows.length}</div>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <div className="text-muted-foreground text-2xs uppercase">Total m³</div>
            <div className="font-mono font-semibold text-base">{fmtNum(total)}</div>
          </div>
        </div>
      )}
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-36"
      >
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
      </DataState>
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

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
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
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
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
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(avg)}<span className="text-2xs font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Peak</div>
              <div className="font-mono font-semibold text-sm">{fmtNum(max)}<span className="text-2xs font-normal ml-0.5">{firstMetric.unit}</span></div>
            </div>
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Days</div>
              <div className="font-mono font-semibold text-sm">{rows.length}</div>
            </div>
          </div>
        );
      })()}
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-36"
      >
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
      </DataState>
    </div>
  );
}

// ─── TrainRODetailCharts ──────────────────────────────────────────────────────
// RO performance panel: a compact 2×3 glance grid (unchanged from the original
// layout) where each card opens a wider detail dialog on click.
// Source: ro_train_readings — no extra tables needed.
//
// Readings tagged norm_status = 'pending_review' | 'retracted' (the same spike
// guard used by PretreatmentAndROLog.tsx and lib/readingGuards.ts) are dropped
// from every average, peak, and axis domain below, and are surfaced instead as
// a small ◇ marker in the detail view — so one bad meter entry can't silently
// flatten the rest of the chart, but it also isn't hidden.
//
// Permeate Flow, Reject Flow, and Daily Volume all open the same "Flow & Volume"
// dialog — Flow Rate / Volume tabs, a Feed/Permeate/Reject series toggle, an
// adjustable date range, and a Daily-avg / Individual-readings granularity
// switch (readings are logged manually, not on a fixed cadence, so "hourly"
// really means "each reading at its own timestamp").

type RoModalKey = 'flow_volume' | 'feed_pressure_psi' | 'permeate_tds' | 'recovery_pct';
type RoFlowMode = 'flow' | 'volume';
type RoGranularity = 'daily' | 'raw';

const RO_FLAGGED_STATUSES = new Set(['pending_review', 'retracted']);
const RO_FLAG_COLOR = 'hsl(38,92%,50%)';

const RO_GLANCE_METRICS: { key: string; label: string; unit: string; color: string; modalKey: RoModalKey; modalMode?: RoFlowMode }[] = [
  { key: 'permeate_flow',     label: 'Permeate Flow', unit: 'm³/h', color: 'hsl(174,72%,40%)', modalKey: 'flow_volume', modalMode: 'flow'   },
  { key: 'feed_pressure_psi', label: 'Feed Pressure', unit: 'psi',  color: 'hsl(216,72%,46%)', modalKey: 'feed_pressure_psi' },
  { key: 'permeate_tds',      label: 'Permeate TDS',  unit: 'ppm',  color: 'hsl(38,84%,52%)',  modalKey: 'permeate_tds' },
  { key: 'recovery_pct',      label: 'Recovery',      unit: '%',    color: 'hsl(150,60%,40%)', modalKey: 'recovery_pct' },
  { key: 'reject_flow',       label: 'Reject Flow',   unit: 'm³/h', color: 'hsl(0,65%,50%)',   modalKey: 'flow_volume', modalMode: 'flow'   },
  { key: 'permeate_volume',   label: 'Daily Volume',  unit: 'm³',   color: 'hsl(174,72%,40%)', modalKey: 'flow_volume', modalMode: 'volume' },
];

const RO_FLOW_METRICS: { key: string; label: string; color: string }[] = [
  { key: 'feed_flow',     label: 'Feed',     color: 'hsl(216,72%,46%)' },
  { key: 'permeate_flow', label: 'Permeate', color: 'hsl(174,72%,40%)' },
  { key: 'reject_flow',   label: 'Reject',   color: 'hsl(0,65%,50%)'   },
];

const RO_OTHER_METRICS: { key: string; label: string; unit: string; color: string }[] = [
  { key: 'feed_pressure_psi', label: 'Feed Pressure', unit: 'psi', color: 'hsl(216,72%,46%)' },
  { key: 'permeate_tds',      label: 'Permeate TDS',  unit: 'ppm', color: 'hsl(38,84%,52%)'  },
  { key: 'recovery_pct',      label: 'Recovery',      unit: '%',   color: 'hsl(150,60%,40%)' },
];

const RO_MODAL_META: Record<RoModalKey, { title: string; unit: string }> = {
  flow_volume:        { title: 'Flow & Volume',  unit: ''     },
  feed_pressure_psi:  { title: 'Feed Pressure',  unit: 'psi'  },
  permeate_tds:       { title: 'Permeate TDS',   unit: 'ppm'  },
  recovery_pct:       { title: 'Recovery',       unit: '%'    },
};

/** Highest clean (non-flagged) value across one or more series, floored so an
 *  all-null range still yields a sane axis instead of NaN/undefined. */
function cleanMax(rows: any[], keys: string[]): number {
  let max = 0;
  for (const r of rows) for (const k of keys) if (r[k] != null && r[k] > max) max = r[k];
  return max;
}

/** Flagged days rendered as a fixed-height marker just above the clean data —
 *  its height is capped, so it never re-scales the axis the way the excluded
 *  raw value would have. */
function flagMarkerData(rows: any[], markerY: number) {
  return rows.filter(r => r.flagged).map(r => ({ date: r.date, y: markerY }));
}

function RoFlagTooltip({ active, payload, label, unit, labelFormat = 'MMM d' }: any) {
  if (!active || !payload?.length) return null;
  const flaggedHit = payload.find((p: any) => p.dataKey === 'y');
  let shownLabel = label;
  try { shownLabel = format(parseISO(label), labelFormat); } catch { /* leave raw label if unparsable */ }
  if (flaggedHit) {
    return (
      <div className="rounded-md border bg-popover px-2 py-1.5 text-2xs shadow-md">
        <div className="font-medium">{shownLabel}</div>
        <div className="text-warn">Flagged reading — pending review, excluded from average</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-2xs shadow-md">
      <div className="font-medium mb-0.5">{shownLabel}</div>
      {payload.filter((p: any) => p.dataKey !== 'y').map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5" style={{ color: p.color }}>
          <span>{p.name}: {fmtNum(p.value)}{unit ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** One compact glance card — same size and style as the original 2×3 grid.
 *  Clickable: opens the wider, detailed chart for this metric in a dialog. */
function RoGlanceTile({ m, rows, flaggedCount, onOpen }: {
  m: typeof RO_GLANCE_METRICS[number];
  rows: any[];
  flaggedCount: number;
  onOpen: () => void;
}) {
  const vals = rows.map(r => r[m.key]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const peak = Math.max(...vals);
  return (
    <button type="button" onClick={onOpen}
      className="group relative text-left rounded-lg border bg-muted/20 p-2.5 space-y-1.5 transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
      {flaggedCount > 0 && (
        <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full"
          style={{ background: RO_FLAG_COLOR }}
          title={`${flaggedCount} flagged reading${flaggedCount === 1 ? '' : 's'} in range — click for detail`} />
      )}
      <div className="flex items-center justify-between gap-1 pr-3">
        <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide truncate">{m.label}</span>
        <span className="flex items-center gap-1 text-2xs text-muted-foreground shrink-0">
          {m.unit}
          <Maximize2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-mono font-semibold" style={{ color: m.color }}>{fmtNum(avg)}</span>
        <span className="text-2xs text-muted-foreground">avg · pk {fmtNum(peak)}</span>
      </div>
      <div className="h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}
            barSize={Math.max(2, Math.min(8, 200 / Math.max(rows.length, 1)))}>
            <Bar dataKey={m.key} fill={m.color} radius={[1, 1, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}

/** Detail view for a single metric — wider, with a real axis and flagged markers.
 *  Opens in the dialog when a glance tile (other than the two flow tiles) is clicked. */
function RoDetailMetricChart({ m, rows }: { m: typeof RO_OTHER_METRICS[number]; rows: any[] }) {
  const vals = rows.map(r => r[m.key]).filter((v): v is number => v != null);
  if (!vals.length) return <p className="py-10 text-center text-sm text-muted-foreground">No readings in this period.</p>;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const peak = Math.max(...vals);
  const domainMax = Math.max(peak * 1.15, 1);
  const markerY = Math.max(peak * 1.08, domainMax * 0.9);
  const markers = flagMarkerData(rows, markerY);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-mono font-semibold" style={{ color: m.color }}>{fmtNum(avg)}</span>
        <span className="text-sm text-muted-foreground">{m.unit} avg · peak {fmtNum(peak)}</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
            barSize={Math.max(3, Math.min(20, 520 / Math.max(rows.length, 1)))}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
              tickFormatter={(d: string) => format(parseISO(d), 'MMM d')} interval="preserveStartEnd" minTickGap={50} />
            <YAxis domain={[0, domainMax]} width={44} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<RoFlagTooltip unit={m.unit} />} />
            <Bar dataKey={m.key} fill={m.color} radius={[2, 2, 0, 0]} />
            {markers.length > 0 && <Scatter data={markers} dataKey="y" fill={RO_FLAG_COLOR} shape="diamond" legendType="none" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {markers.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-warn">
          <AlertTriangle className="h-3 w-3" />
          {markers.length} flagged reading{markers.length === 1 ? '' : 's'} in this period — excluded from the average above.
        </p>
      )}
    </div>
  );
}

/** Builds display rows for the Flow & Volume detail view.
 *  'daily' bucket-averages by calendar date, same rule as the glance grid.
 *  'raw' skips bucketing entirely and plots each reading at its own
 *  timestamp — useful for zooming into a single day, since readings are
 *  logged manually rather than on a fixed cadence. Flagged readings are
 *  excluded from both the same way: null in the series, surfaced via
 *  flagMarkerData() instead. */
function buildRoSeries(raw: any[], granularity: RoGranularity) {
  const cols = ['feed_flow', 'permeate_flow', 'reject_flow'];
  if (granularity === 'raw') {
    return raw.map(r => {
      const isFlagged = RO_FLAGGED_STATUSES.has(r.norm_status);
      const out: any = { date: r.reading_datetime, flagged: isFlagged };
      for (const c of cols) out[c] = !isFlagged && r[c] != null ? +r[c] : null;
      out.permeate_volume = !isFlagged && r.permeate_meter_delta != null && +r.permeate_meter_delta > 0 ? +r.permeate_meter_delta : null;
      return out;
    });
  }
  const byDate = new Map<string, any>();
  for (const r of raw) {
    const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, _count: 0, _flagged: false, perm_vol: 0 });
    const e = byDate.get(date)!;
    if (RO_FLAGGED_STATUSES.has(r.norm_status)) { e._flagged = true; continue; }
    e._count++;
    for (const c of cols) if (r[c] != null) e[c] = (e[c] ?? 0) + +r[c];
    if (r.permeate_meter_delta != null && +r.permeate_meter_delta > 0) e.perm_vol += +r.permeate_meter_delta;
  }
  return Array.from(byDate.values()).map(e => {
    const out: any = { date: e.date, flagged: e._flagged, permeate_volume: e._count > 0 ? +e.perm_vol.toFixed(2) : null };
    for (const c of cols) out[c] = e._count > 0 && e[c] != null ? +(e[c] / e._count).toFixed(2) : null;
    return out;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Flow & Volume detail dialog content — opens when Permeate Flow, Reject
 *  Flow, or Daily Volume is clicked on the glance grid. Has its own date
 *  range independent of the glance grid's 30/90/180/All pills, since the
 *  whole point is being able to zoom into a window those presets don't hit. */
function RoFlowVolumeDetail({ trainId, initialMode }: { trainId: string; initialMode: RoFlowMode }) {
  const [mode, setMode] = useState<RoFlowMode>(initialMode);
  const [granularity, setGranularity] = useState<RoGranularity>('daily');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({ from: subDays(new Date(), 29), to: new Date() });
  const [visible, setVisible] = useState<Set<string>>(new Set(RO_FLOW_METRICS.map(m => m.key)));

  const fromISO = dateRange.from.toISOString();
  const toISO = new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23, 59, 59).toISOString();

  const { data: raw = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['train-ro-flow-volume', trainId, fromISO, toISO],
    queryFn: async () => {
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('reading_datetime,feed_flow,permeate_flow,reject_flow,permeate_meter_delta,norm_status')
        .eq('train_id', trainId)
        .gte('reading_datetime', fromISO)
        .lte('reading_datetime', toISO)
        .order('reading_datetime', { ascending: true });
      return (data as any[]) ?? [];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => buildRoSeries(raw, granularity), [raw, granularity]);
  const flaggedCount = rows.filter(r => r.flagged).length;
  const visibleFlowKeys = RO_FLOW_METRICS.map(m => m.key).filter(k => visible.has(k));
  const domainKeys = mode === 'volume' ? ['permeate_volume'] : visibleFlowKeys;
  const domainMax = Math.max(cleanMax(rows, domainKeys) * 1.15, 1);
  const markers = flagMarkerData(rows, domainMax * 0.94);
  const tickFormat = granularity === 'raw' ? 'MMM d, HH:mm' : 'MMM d';

  const toggleSeries = (key: string) => setVisible(prev => {
    const next = new Set(prev);
    if (next.has(key)) { if (next.size > 1) next.delete(key); } else next.add(key);
    return next;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={mode} onValueChange={(v) => setMode(v as RoFlowMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="flow" className="text-xs px-2.5">Flow Rate</TabsTrigger>
            <TabsTrigger value="volume" className="text-xs px-2.5">Volume</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['daily', 'raw'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${granularity === g ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {g === 'daily' ? 'Daily avg' : 'Individual readings'}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5">
                <CalendarIcon className="h-3 w-3" />
                {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(r: any) => { if (r?.from && r?.to) setDateRange({ from: r.from, to: r.to }); }}
                disabled={{ after: new Date() }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {mode === 'flow' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {RO_FLOW_METRICS.map(m => {
            const active = visible.has(m.key);
            return (
              <button key={m.key} onClick={() => toggleSeries(m.key)}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors"
                style={{
                  borderColor: active ? m.color : 'var(--border)',
                  color: active ? m.color : 'var(--muted-foreground)',
                  background: active ? 'var(--muted)' : 'transparent',
                }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? m.color : 'var(--muted-foreground)' }} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      <DataState loading={isLoading} error={error} isEmpty={rows.length === 0}
        emptyTitle="No readings in this window" onRetry={refetch} className="h-56">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              barSize={mode === 'volume' ? Math.max(3, Math.min(20, 520 / Math.max(rows.length, 1))) : undefined}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(d: string) => format(parseISO(d), tickFormat)} interval="preserveStartEnd" minTickGap={50} />
              <YAxis domain={[0, domainMax]} width={44} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip content={<RoFlagTooltip unit={mode === 'volume' ? 'm³' : 'm³/h'} labelFormat={tickFormat} />} />
              {mode === 'volume' && <Bar dataKey="permeate_volume" fill="hsl(174,72%,40%)" radius={[2, 2, 0, 0]} />}
              {mode === 'flow' && RO_FLOW_METRICS.filter(m => visible.has(m.key)).map(m => (
                <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color}
                  strokeWidth={2} dot={granularity === 'raw'} connectNulls activeDot={{ r: 4 }} />
              ))}
              {markers.length > 0 && <Scatter data={markers} dataKey="y" fill={RO_FLAG_COLOR} shape="diamond" name="Flagged" legendType="none" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </DataState>

      {flaggedCount > 0 && (
        <p className="flex items-center gap-1 text-xs text-warn">
          <AlertTriangle className="h-3 w-3" />
          {flaggedCount} flagged reading{flaggedCount === 1 ? '' : 's'} in this window — shown as ◇, excluded from the line.
        </p>
      )}
      {granularity === 'raw' && (
        <p className="text-2xs text-muted-foreground">Readings are logged manually, not on a fixed schedule — each point sits at its actual log time.</p>
      )}
    </div>
  );
}

export function TrainRODetailCharts({ trainId, trainLabel }: { trainId: string; trainLabel: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');
  const [openMetric, setOpenMetric] = useState<RoModalKey | null>(null);
  const [openModalMode, setOpenModalMode] = useState<RoFlowMode>('flow');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['train-ro-detail', trainId, range],
    queryFn: async () => {
      const days  = range === 'all' ? 9999 : parseInt(range);
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const { data } = await (supabase.from('ro_train_readings' as any) as any)
        .select('reading_datetime,permeate_flow,feed_flow,reject_flow,feed_pressure_psi,reject_pressure_psi,permeate_tds,feed_tds,reject_tds,recovery_pct,permeate_meter_delta,temperature_c,norm_status')
        .eq('train_id', trainId)
        .gte('reading_datetime', since)
        .order('reading_datetime', { ascending: true });
      if (!data?.length) return [];
      const avgCols = ['permeate_flow','feed_flow','reject_flow','feed_pressure_psi','reject_pressure_psi','permeate_tds','feed_tds','reject_tds','recovery_pct','temperature_c'];
      const byDate = new Map<string, any>();
      for (const r of data as any[]) {
        const date = (r.reading_datetime as string)?.slice(0, 10) ?? '';
        if (!date) continue;
        if (!byDate.has(date)) byDate.set(date, { date, _count: 0, _flagged: false, perm_vol: 0 });
        const e = byDate.get(date)!;
        // Flagged readings never contribute to a day's average/peak/volume —
        // they're excluded from the underlying numbers, not just hidden visually.
        if (RO_FLAGGED_STATUSES.has(r.norm_status)) { e._flagged = true; continue; }
        e._count++;
        for (const col of avgCols) if (r[col] != null) e[col] = (e[col] ?? 0) + +r[col];
        if (r.permeate_meter_delta != null && +r.permeate_meter_delta > 0) e.perm_vol += +r.permeate_meter_delta;
      }
      return Array.from(byDate.values()).map(e => {
        const out: any = {
          date: e.date,
          flagged: e._flagged,
          permeate_volume: e._count > 0 ? +e.perm_vol.toFixed(2) : null,
        };
        for (const col of avgCols) out[col] = e._count > 0 && e[col] != null ? +(e[col] / e._count).toFixed(2) : null;
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60_000,
  });

  const flaggedCount = rows.filter(r => r.flagged).length;
  const openedOtherMetric = openMetric && openMetric !== 'flow_volume' ? RO_OTHER_METRICS.find(m => m.key === openMetric) : null;

  const exportCSV = () => {
    if (!rows.length) { toast.error('No data'); return; }
    const cols = ['date','feed_flow','permeate_flow','reject_flow','feed_pressure_psi','permeate_tds','recovery_pct','permeate_volume'];
    const header = [...cols, 'flagged'];
    const lines = rows.map(r => [...cols.map(c => r[c] ?? ''), r.flagged ? 'yes' : 'no'].join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${trainLabel.replace(/\s+/g, '_')}_ro_performance.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">RO Performance</span>
          {flaggedCount > 0 && (
            <span className="flex items-center gap-1 text-2xs text-warn">
              <AlertTriangle className="h-3 w-3" />
              {flaggedCount} flagged — click a chart for detail
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['30', '90', '180', 'all'] as const).map(r => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                {r === 'all' ? 'All' : `${r}d`}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={exportCSV}>
            <Download className="h-3 w-3" /><span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>
      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-36"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {RO_GLANCE_METRICS.map(m => (
            <RoGlanceTile key={m.key} m={m} rows={rows} flaggedCount={flaggedCount}
              onOpen={() => { setOpenMetric(m.modalKey); if (m.modalMode) setOpenModalMode(m.modalMode); }} />
          ))}
        </div>
      </DataState>

      <Dialog open={!!openMetric} onOpenChange={(o) => !o && setOpenMetric(null)}>
        <DialogContent className="max-w-3xl w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{openMetric ? RO_MODAL_META[openMetric].title : ''} · {trainLabel}</span>
              {openMetric && RO_MODAL_META[openMetric].unit && (
                <span className="text-xs font-normal text-muted-foreground">{RO_MODAL_META[openMetric].unit}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {openMetric === 'flow_volume' && <RoFlowVolumeDetail trainId={trainId} initialMode={openModalMode} />}
          {openedOtherMetric && <RoDetailMetricChart m={openedOtherMetric} rows={rows} />}
        </DialogContent>
      </Dialog>
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

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
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
          className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
            ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
          {r === 'all' ? 'All' : `${r}d`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{mediaType} — Pressure & Backwash</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(['pressure', 'backwash'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-2xs font-medium capitalize transition-colors
                  ${view === v ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
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
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-2xs font-normal ml-0.5">{s.unit}</span>
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
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-2xs font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No pre-treatment readings in this period"
        onRetry={refetch}
        className="h-40"
      >
        {view === 'pressure' ? (
        <>
          <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
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
      </DataState>
    </div>
  );
}

// ─── PretreatBoosterChart ─────────────────────────────────────────────────────
// Queries ro_pretreatment_readings → booster_pumps JSONB.
// Shows target_pressure_psi (psi mode) and/or target_hz (Hz mode).
export function PretreatBoosterChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
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
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Booster Pump — Target Setting</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
                ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <div className={`grid gap-2 ${hasPsi && hasHz ? 'grid-cols-2' : 'grid-cols-1 max-w-xs'}`}>
          {hasPsi && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg Target (PSI)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgPsi)}<span className="text-2xs font-normal ml-0.5">psi</span>
              </div>
            </div>
          )}
          {hasHz && (
            <div className="bg-muted/40 rounded-lg p-2 text-center">
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">Avg Target (Hz)</div>
              <div className="font-mono font-semibold text-sm">
                {fmtNum(avgHz)}<span className="text-2xs font-normal ml-0.5">Hz</span>
              </div>
            </div>
          )}
        </div>
      )}

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No pre-treatment readings in this period"
        onRetry={refetch}
        className="h-40"
      >
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
      </DataState>
    </div>
  );
}

// ─── PretreatHPPChart ─────────────────────────────────────────────────────────
// Dual-source: hpp_target_pressure_psi from ro_pretreatment_readings (target)
// overlaid with feed_pressure_psi from ro_train_readings (achieved).
export function PretreatHPPChart({ trainId }: { trainId: string }) {
  const [range, setRange] = useState<'30' | '90' | '180' | 'all'>('30');

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
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
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">HPP — Target vs Actual Pressure</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
                ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
              {r === 'all' ? 'All' : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
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
                <span className="text-muted-foreground text-2xs uppercase tracking-wide block">Avg Target</span>
                <span className="font-mono font-semibold">{fmtNum(avgTgt)} <span className="font-normal text-2xs">psi</span></span>
              </div>
            )}
            {avgFeed != null && (
              <div className="bg-muted/40 rounded-lg px-3 py-1.5 text-center">
                <span className="text-muted-foreground text-2xs uppercase tracking-wide block">Avg Feed</span>
                <span className="font-mono font-semibold">{fmtNum(avgFeed)} <span className="font-normal text-2xs">psi</span></span>
              </div>
            )}
          </div>
        </>
      )}

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No readings in this period"
        onRetry={refetch}
        className="h-40"
      >
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
      </DataState>
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

  const { data: rows = [], isLoading, error, refetch } = useQuery<any[]>({
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
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{label} — In / Out / ΔP</span>
          <span className="text-xs text-muted-foreground">(daily avg)</span>
        </div>
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          {(['30', '90', '180', 'all'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-2xs font-medium transition-colors
                ${range === r ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>
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
              <div className="text-muted-foreground text-2xs uppercase tracking-wide">{s.label}</div>
              <div className="font-mono font-semibold text-sm">
                {s.val}<span className="text-2xs font-normal ml-0.5">{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 text-2xs text-muted-foreground flex-wrap">
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

      <DataState
        loading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="No pre-treatment readings in this period"
        onRetry={refetch}
        className="h-40"
      >
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
      </DataState>
    </div>
  );
}

// ─── recalculateTrainDeltas ──────────────────────────────────────────────────
//
// Recomputes permeate_meter_delta AND reject_meter_delta for EVERY reading of
// an RO train in strict chronological order.  Both meters are corrected in a
// single ascending pass.  Call this whenever a meter baseline changes:
//
//   • is_meter_replacement toggled on or off  (toggleMeterReplacement below)
//   • DataAnalysis applies a permeate_meter correction  (DataAnalysis.tsx)
//   • A new reading is inserted between existing rows
//       → HOOK POINT in ROTrains.tsx: call recalculateTrainDeltas(trainId) at
//         the end of the submit() handler after every successful insert.
//
// ── HYBRID STRATEGY (permeate only) ─────────────────────────────────────────
// After every successful DB write this function also calls deltaCache.set() with
// the freshly-computed permeate delta so the Dashboard and TrendChart pick up
// the new value immediately (Tier-1 cache shortcut) without waiting for a
// refetch.  Reject delta is not Dashboard-cached (it's display-only in the
// operator log) so no equivalent cache update is needed there.
//
// Rules (applied identically to both meters):
//   Replacement flag true        → delta = 0; baseline still advances
//   Normal row, prev available   → delta = max(0, current − prev)
//   First row / meter is null    → delta = null
//
// Permeate: is_permeate_meter_replacement OR is_meter_replacement (the latter
//   for backward compat with pre-migration rows that only had the shared flag).
// Reject:   is_reject_meter_replacement ONLY — pre-migration rows with
//   is_meter_replacement=true had permeate-only replacements; don't zero reject.
async function recalculateTrainDeltas(trainId: string): Promise<void> {
  try {
    const { data: rows } = await (supabase.from('ro_train_readings' as any) as any)
      .select(
        'id, reading_datetime, ' +
        'permeate_meter, permeate_meter_delta, reject_meter, reject_meter_delta, ' +
        'is_meter_replacement, is_permeate_meter_replacement, is_reject_meter_replacement',
      )
      .eq('train_id', trainId)
      .order('reading_datetime', { ascending: true });

    if (!rows?.length) return;

    let prevMeter:    number | null = null;
    let prevRejMeter: number | null = null;

    for (const row of rows as any[]) {
      // ── Permeate delta ────────────────────────────────────────────────────
      const isPermRepl = !!(row.is_permeate_meter_replacement || row.is_meter_replacement);
      const curMeter   = row.permeate_meter != null ? +row.permeate_meter : null;
      const stored     = row.permeate_meter_delta != null ? +row.permeate_meter_delta : null;
      const dateKey    = row.reading_datetime
        ? new Date(row.reading_datetime).toLocaleDateString('en-CA') // YYYY-MM-DD
        : null;

      let newDelta: number | null;
      if (isPermRepl) {
        newDelta = 0;
      } else if (prevMeter != null && curMeter != null) {
        newDelta = Math.max(0, curMeter - prevMeter);
      } else {
        newDelta = null;
      }
      if (curMeter != null) prevMeter = curMeter;
      if (newDelta !== stored) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ permeate_meter_delta: newDelta })
          .eq('id', row.id);
      }

      // ── HYBRID STRATEGY: sync in-memory delta cache (permeate) ───────────
      if (dateKey) {
        if (newDelta !== null) {
          deltaCache.set(trainId, dateKey, newDelta, 'stored');
        } else {
          deltaCache.invalidate(trainId);
        }
      }

      // ── Reject delta ──────────────────────────────────────────────────────
      const isRejRepl   = !!(row.is_reject_meter_replacement);
      const curRejMeter = row.reject_meter != null ? +row.reject_meter : null;
      const storedRej   = row.reject_meter_delta != null ? +row.reject_meter_delta : null;
      let newRejDelta: number | null;
      if (isRejRepl) {
        newRejDelta = 0;
      } else if (prevRejMeter != null && curRejMeter != null) {
        newRejDelta = Math.max(0, curRejMeter - prevRejMeter);
      } else {
        newRejDelta = null;
      }
      if (curRejMeter != null) prevRejMeter = curRejMeter;
      if (newRejDelta !== storedRej) {
        await (supabase.from('ro_train_readings' as any) as any)
          .update({ reject_meter_delta: newRejDelta })
          .eq('id', row.id);
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
  plantId,
  onClose,
}: {
  trainId: string;
  trainLabel: string;
  /** Required so a checked Repl. box can open ReplaceTrainMeterDialog, which
   *  logs plant_id on ro_train_meter_replacements like every other module's
   *  replacement table. */
  plantId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Reading id currently going through ReplaceTrainMeterDialog. See
  // toggleMeterReplacement below for why checking opens this instead of a
  // bare flag flip.
  const [replaceReadingId, setReplaceReadingId] = useState<string | null>(null);

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

  const { data: logs = [], isLoading, error, refetch } = useQuery({
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
          'is_meter_replacement',
          'is_feed_meter_replacement', 'is_permeate_meter_replacement', 'is_reject_meter_replacement',
          'remarks',
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
  // CHECKING opens ReplaceTrainMeterDialog so the swap actually gets logged
  // against ro_train_meter_replacements (which meter, old/new brand, size,
  // serial, installed date) instead of just flipping a flag.
  // UNCHECKING clears all three granular flags directly — nothing to log for
  // undoing a mis-tap — and, same as before, triggers a full cascade
  // recalculation so every downstream row's delta stays consistent.
  const toggleMeterReplacement = async (r: any) => {
    if (!isManager) return;
    const next = !r.is_meter_replacement;
    if (next) {
      setReplaceReadingId(r.id);
      return;
    }
    setTogglingId(r.id);
    const { error } = await (supabase.from('ro_train_readings' as any) as any)
      .update({
        is_meter_replacement: false,
        is_feed_meter_replacement: false,
        is_permeate_meter_replacement: false,
        is_reject_meter_replacement: false,
      }).eq('id', r.id);
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

    toast.success('Replacement flag removed — Δ recalculated from actual meter readings');
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
    v != null ? <span>{Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}<span className="text-muted-foreground/60 ml-0.5 text-2xs">{unit}</span></span>
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
        onInteractOutside={(e) => {
          // ReplaceTrainMeterDialog is a Radix Dialog.Portal — its content
          // mounts as a sibling of this DialogContent's node, not a
          // descendant, so any pointerdown inside it looks "outside" this
          // layer. Without this guard, opening it via the Repl. checkbox and
          // then clicking anything inside it (a field, the meter-type
          // Select) closes this whole Operator Log modal — and takes the
          // just-opened replace dialog down with it — before the swap can
          // be saved.
          if (replaceReadingId) { e.preventDefault(); return; }
          onClose();
        }}
      >
        <DialogTitle className="sr-only">Operator Log — {trainLabel}</DialogTitle>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <div className="text-base font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary shrink-0" />
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
                  ? 'bg-primary text-white border-primary'
                  : 'bg-background border-input text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >{p}d</button>
          ))}
          <input
            type="date" value={dateFrom} max={dateTo || todayStr}
            onChange={e => { setDateFrom(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <input
            type="date" value={dateTo} min={dateFrom} max={todayStr}
            onChange={e => { setDateTo(e.target.value); setRangePreset('custom'); setPage(0); }}
            className="h-6 text-xs px-2 rounded-md border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {!isLoading && (
            <span className="text-xs text-muted-foreground ml-auto">
              <span className="font-semibold text-foreground">{logs.length}</span> {logs.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {/* ── Log table ── */}
        <div className="flex-1 overflow-auto">
          <DataState
            loading={isLoading}
            error={error}
            isEmpty={logs.length === 0}
            emptyTitle="No logs found"
            emptyDescription="Try expanding the date range."
            onRetry={refetch}
          >
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-background border-b z-10">
                <tr className="text-muted-foreground uppercase tracking-wide text-2xs">
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
                  <th className="px-2 py-2 font-semibold text-center text-kpi-solar whitespace-nowrap w-[54px]" title="Meter Replacement — flags reading as meter change; zeroes Δ in chart">Repl.</th>
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
                        isRepl ? 'bg-kpi-solar/40' : 'hover:bg-muted/30',
                      ].join(' ')}
                    >
                      {/* Date / Time */}
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground font-mono text-xs">
                        <div className="text-foreground font-medium">{r.reading_datetime ? format(new Date(r.reading_datetime), 'MMM d, yyyy') : '—'}</div>
                        <div className="flex items-center gap-1">
                          {r.reading_datetime ? format(new Date(r.reading_datetime), 'HH:mm') : ''}
                          {isRepl && (
                            <span className="text-3xs font-bold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">repl.</span>
                          )}
                        </div>
                      </td>
                      {/* Operator */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-5 w-5 rounded-full bg-primary-soft text-primary flex items-center justify-center text-3xs font-bold shrink-0">
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
                          ? <span className="text-accent font-medium">{Number(r.recovery_pct).toFixed(1)}%</span>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      {/* Permeate meter */}
                      <td className="px-2 py-2 text-right font-mono text-xs">{fmtVal(r.permeate_meter)}</td>
                      {/* Δ m³ — prefer in-memory delta (computed from corrected permeate_meter)
                           over the stored permeate_meter_delta, which may have been written
                           before DataAnalysis corrected the underlying meter reading. */}
                      <td className="px-2 py-2 text-right font-mono text-xs">
                        {(() => {
                          // _computed_delta is always available when permeate_meter exists and
                          // there is a predecessor row.  Fall back to stored delta only when
                          // _computed_delta is null (e.g. first-ever reading for this train).
                          const d = r._computed_delta ?? (r.permeate_meter_delta != null ? +r.permeate_meter_delta : null);
                          if (d == null) return <span className="text-muted-foreground/30">—</span>;
                          if (isRepl) return <span className="text-kpi-solar font-medium">0</span>;
                          return d > 0
                            ? <span className="text-primary">+{d.toLocaleString(undefined,{maximumFractionDigits:1})}</span>
                            : <span className="text-muted-foreground/40">0</span>;
                        })()}
                      </td>
                      {/* Meter replacement toggle — next to Perm Meter / Δ */}
                      <td className="px-2 py-2 text-center">
                        <button
                          title={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                          aria-label={isRepl ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ in chart)'}
                          disabled={!isManager || isToggling}
                          onClick={() => toggleMeterReplacement(r)}
                          className={[
                            'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                            !isManager ? 'opacity-30 cursor-not-allowed' : 'disabled:opacity-40 disabled:cursor-not-allowed',
                            isRepl
                              ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                              : 'border-input bg-background hover:border-kpi-solar/90 hover:bg-kpi-solar/15',
                          ].join(' ')}
                        >
                          {isToggling
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null
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
          </DataState>
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

        {replaceReadingId && (
          <ReplaceTrainMeterDialog
            trainId={trainId}
            plantId={plantId}
            readingId={replaceReadingId}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey });
              qc.invalidateQueries({ queryKey: ['dash-ro-recent'] });
              qc.invalidateQueries({ queryKey: ['trend-ro'] });
              qc.invalidateQueries({ queryKey: ['dsm-ro-readings'] });
            }}
            onClose={() => setReplaceReadingId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Trains List ─────────────────────────────────────────────────────────────

