import { useState, useMemo } from 'react';
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
import { fmtIsoDate } from '@/lib/format';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format, parseISO, subDays, isValid } from 'date-fns';
import { PLANT_CHEMICALS } from '../shared';
import { ReplaceTrainMeterDialog } from '../../ro-trains/ReplaceTrainMeterDialog';

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
import { fmtIsoDate } from '@/lib/format';
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
            <Label htmlFor="traindetail-train-label-name-optional" className="text-xs">Train label / name (optional)</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. North Wing"
              disabled={!isManager}
              data-testid="train-name-input"
            id="traindetail-train-label-name-optional"/>
          </div>

          {/* Source well link */}
          <div>
            <Label htmlFor="traindetail-source-well-used-for-per-well-source-labels-on-d" className="text-xs">Source well <span className="text-muted-foreground font-normal">(used for "Per Well Source" labels on Dashboard)</span></Label>
            <Select
              value={form.well_id || '__none__'}
              onValueChange={(v) => setForm({ ...form, well_id: v === '__none__' ? '' : v })}
              disabled={!isManager}
            >
              <SelectTrigger data-testid="train-well-select" id="traindetail-source-well-used-for-per-well-source-labels-on-d">
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
              <Label htmlFor="traindetail-units-media-filter" className="text-xs">
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
                id="traindetail-units-media-filter"/>
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
              <Label htmlFor="traindetail-pre-filter" className="text-xs">
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
                id="traindetail-pre-filter"/>
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
              <Label htmlFor="traindetail-booster-pumps" className="text-xs">Booster Pumps</Label>
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
                id="traindetail-booster-pumps"/>
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
                  <p className="text-xs font-medium">Booster Pump Targets</p>
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
              <Label htmlFor="traindetail-high-pressure-pumps-hpp" className="text-xs">High-Pressure Pumps (HPP)</Label>
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
                id="traindetail-high-pressure-pumps-hpp"/>
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
              <Label htmlFor="traindetail-hpp-target-pressure-psi" className="text-xs">HPP Target Pressure (psi)</Label>
              <Input
                type="number"
                step="any"
                min={0}
                placeholder="e.g. 180"
                value={form.hpp_target_pressure_psi}
                onChange={(e) => setForm({ ...form, hpp_target_pressure_psi: e.target.value })}
                className="mt-1 font-mono-num"
                data-testid="hpp-target-pressure-input"
              id="traindetail-hpp-target-pressure-psi"/>
              <p className="text-2xs text-muted-foreground mt-1">
                Auto-fills on every reading for this train. Leave blank to keep entering it manually per reading.
              </p>
            </div>

            {/* Controllers */}
            <div>
              <Label htmlFor="traindetail-controllers" className="text-xs">Controllers</Label>
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
                id="traindetail-controllers"/>
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
              <Label htmlFor="traindetail-filter-housings" className="text-xs">Filter Housings</Label>
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
                id="traindetail-filter-housings"/>
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

