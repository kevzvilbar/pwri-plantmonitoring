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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, RefreshCw } from 'lucide-react';
// Icon-audit fix: the "RO Trains — Flow meters" section header now uses the
// purpose-built ROTrainIcon. Wrench is kept for this file's other two
// section headers ("Component Types & Backwash", "Plant-wide Component
// Types"), which are genuinely about physical hardware, not RO trains
// specifically.
import { ROTrainIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';


import {
  usePlantMeterConfig, PlantMeterConfig, CollapsibleSection, GridPylonIcon,
  DEFAULT_METER_CONFIG, PLANT_CHEMICALS,
} from '../shared';
import { BackwashModeCard } from './Appearance';

export const BUILTIN_CIP_CHEMICALS = ['Caustic Soda', 'HCl', 'SLS'];
export const CIP_CHEM_UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'gal'];

export function CIPChemicalsSection({
  cfg,
  update,
  canEdit,
}: {
  cfg: PlantMeterConfig;
  update: (patch: Partial<PlantMeterConfig>) => void;
  canEdit: boolean;
}) {
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('kg');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const chemicals: Array<{ name: string; unit: string }> =
    cfg.cip_chemicals?.length
      ? cfg.cip_chemicals
      : [
          { name: 'Caustic Soda', unit: 'kg' },
          { name: 'HCl',          unit: 'L'  },
          { name: 'SLS',          unit: 'g'  },
        ];

  const addChemical = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (chemicals.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return; // duplicate — silently ignore
    }
    update({ cip_chemicals: [...chemicals, { name: trimmed, unit: newUnit }] });
    setNewName('');
    setNewUnit('kg');
  };

  const removeChemical = (name: string) => {
    update({ cip_chemicals: chemicals.filter(c => c.name !== name) });
    setConfirmRemove(null);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base leading-none">🧫</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">CIP Chemicals</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        These chemicals appear as input fields in{' '}
        <strong className="font-medium">RO Trains → CIP</strong>. Built-in chemicals
        (Caustic Soda, HCl, SLS) map to dedicated DB columns; custom ones are stored
        in the remarks field.{!canEdit && ' (view only)'}
      </p>

      <div className="space-y-1.5">
        {chemicals.map(chem => {
          const isBuiltin = BUILTIN_CIP_CHEMICALS.includes(chem.name);
          const isConfirming = confirmRemove === chem.name;
          return (
            <div
              key={chem.name}
              className={[
                'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
                isBuiltin
                  ? 'border-primary/60 bg-primary-soft/50'
                  : 'border-border bg-muted/20',
              ].join(' ')}
            >
              {/* Icon badge */}
              <span className={[
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-3xs font-bold shrink-0',
                isBuiltin
                  ? 'bg-primary-soft text-primary'
                  : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {isBuiltin ? '★' : '✦'}
              </span>

              {/* Name + unit */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{chem.name}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">({chem.unit})</span>
                {isBuiltin && (
                  <span className="ml-2 text-3xs font-semibold uppercase tracking-wide text-primary">built-in</span>
                )}
              </div>

              {/* Remove controls */}
              {canEdit && (
                isConfirming ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-2xs text-muted-foreground">Remove?</span>
                    <button
                      type="button"
                      onClick={() => removeChemical(chem.name)}
                      className="px-2 py-0.5 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 text-2xs font-semibold"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="px-2 py-0.5 rounded hover:bg-muted text-muted-foreground text-2xs"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(chem.name)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title={`Remove ${chem.name} from CIP`}
                    aria-label={`Remove ${chem.name} from CIP`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )
              )}
            </div>
          );
        })}

        {/* Add chemical row — manager only */}
        {canEdit && (
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addChemical()}
              placeholder="New chemical name…"
              className="h-8 text-xs flex-1"
            />
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CIP_CHEM_UNITS.map(u => (
                  <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={addChemical}
              disabled={!newName.trim()}
              className="h-8 px-3 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              + Add
            </button>
          </div>
        )}

        {chemicals.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No CIP chemicals configured — add one above.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── PlantMeterConfigCard ─────────────────────────────────────────────────────
// Full meter configuration panel for managers. Lives at the top of the Trains tab.
// Sections: RO Trains | Wells | Locators | Product/NRW | Power/Energy.
// Uses 2-col tile layout on tablet+, single col on mobile.

export function MeterToggleTile({
  icon, title, subtitle, checked, onToggle, canEdit,
  accentColor = 'teal',
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  canEdit: boolean;
  accentColor?: 'teal' | 'amber' | 'blue' | 'purple';
}) {
  const colors = {
    teal:   { on: 'border-primary/60 bg-primary-soft/70', icon: 'bg-primary-soft', sw: 'data-[state=checked]:bg-primary' },
    amber:  { on: 'border-warn/60 bg-warn-soft/70', icon: 'bg-warn-soft', sw: 'data-[state=checked]:bg-warn' },
    blue:   { on: 'border-info/60 bg-info-soft/70', icon: 'bg-info-soft', sw: 'data-[state=checked]:bg-info' },
    purple: { on: 'border-kpi-ro/60 bg-kpi-ro/70', icon: 'bg-kpi-ro/15', sw: 'data-[state=checked]:bg-kpi-ro' },
  }[accentColor];

  return (
    // eslint-disable-next-line jsx-a11y/label-has-associated-control -- Switch (Radix) renders button[role=switch], not a native input; same false positive as ThemeSelector's Switch.
    <label className={[
      'flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors',
      checked ? colors.on : 'border-border bg-muted/30',
      canEdit ? 'cursor-pointer' : 'cursor-default',
    ].join(' ')}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${checked ? colors.icon : 'bg-muted'}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground leading-tight">{subtitle}</div>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={canEdit ? onToggle : undefined}
        disabled={!canEdit}
        className={`h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 ${colors.sw}`}
      />
    </label>
  );
}

export function MeterGroupChips({
  label,
  groupName,
  members,
  allEntities,
  entityLabel,
  onMembersChange,
  onGroupNameChange,
  onDeleteGroup,
  canEdit,
}: {
  label: string;
  groupName: string;
  members: string[];
  allEntities: Array<{ id: string; name: string }>;
  entityLabel: string;
  onMembersChange: (ids: string[]) => void;
  onGroupNameChange: (name: string) => void;
  onDeleteGroup?: () => void;
  canEdit: boolean;
}) {
  const available = allEntities.filter(e => !members.includes(e.id));
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3 space-y-2.5 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        {canEdit ? (
          <Input
            value={groupName}
            onChange={e => onGroupNameChange(e.target.value)}
            placeholder="Group name (e.g. Main Pump House)"
            className="h-8 text-xs font-semibold max-w-sm"
          />
        ) : (
          <p className="text-xs font-bold text-foreground">{groupName || label}</p>
        )}
        {canEdit && onDeleteGroup && (
          <button
            type="button"
            onClick={onDeleteGroup}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
            aria-label="Remove group"
            title="Delete group"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {members.map(id => {
          const e = allEntities.find(x => x.id === id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/40 font-medium transition-all shadow-2xs"
            >
              <span>{e?.name ?? id}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onMembersChange(members.filter(m => m !== id))}
                  className="h-3.5 w-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center text-primary/70 hover:text-primary transition-colors -mr-1"
                  aria-label={`Remove ${e?.name}`}
                  title="Remove"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          );
        })}
        {canEdit && available.length > 0 && (
          <Select onValueChange={id => onMembersChange([...members, id])}>
            <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
              <Plus className="h-3 w-3 mr-1 text-primary" />Add {entityLabel}
            </SelectTrigger>
            <SelectContent>
              {available.map(e => (
                <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

// ─── LocatorGroupRealitySync ───────────────────────────────────────────────
// FIX (2026-07-24) — addresses "Assign Locators is redundant with meter
// configuration, this should be unified": the "Shared bulk meter groups"
// list below is a freeform, manually-typed list stored in
// plant_meter_config.config. It is NOT connected to the real per-locator
// `product_meter_id` assignment made via the "Assign Locators" button on the
// Product tab — which is what NRW / derived (mother-meter) calculations
// actually read. The two lists can silently drift apart (a group can list a
// locator that was never really assigned, or omit one that was — this is
// already visible in production data: the group "Mother Meter Pump House"
// lists 8 locators while the real product meter "Mother Meter Pumphouse" has
// 0 assigned via Assign Locators).
//
// Rather than silently auto-syncing the two (risky — it would bypass the
// is_derived/mirror rules that Assign Locators enforces), this control makes
// the drift visible and lets a manager pull the real assignment into the
// group with one explicit click. It only ever writes to the config JSON
// (`members`), never to the `locators` table, so it can't affect any
// production/NRW calculation.
function LocatorGroupRealitySync({
  productMeters,
  locators,
  members,
  onSync,
  canEdit,
}: {
  productMeters: Array<{ id: string; name: string }>;
  locators: Array<{ id: string; name: string; product_meter_id: string | null }>;
  members: string[];
  onSync: (ids: string[]) => void;
  canEdit: boolean;
}) {
  const [meterId, setMeterId] = useState<string>('');
  if (!canEdit || productMeters.length === 0) return null;

  const realIds = meterId ? locators.filter(l => l.product_meter_id === meterId).map(l => l.id) : [];
  const memberSet = new Set(members);
  const realSet = new Set(realIds);
  const missing = realIds.filter(id => !memberSet.has(id)).length; // really assigned, not in this group's list
  const extra = members.filter(id => !realSet.has(id)).length;     // in this group's list, not really assigned
  const inSync = !!meterId && missing === 0 && extra === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1.5 mt-1.5 border-t border-dashed">
      <span className="text-2xs text-muted-foreground whitespace-nowrap">Compare to Assign Locators:</span>
      <Select value={meterId} onValueChange={setMeterId}>
        <SelectTrigger className="h-6 text-xs px-2 py-0 w-auto min-w-[130px]">
          <SelectValue placeholder="Pick a product meter…" />
        </SelectTrigger>
        <SelectContent>
          {productMeters.map(m => (
            <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {meterId && (
        inSync ? (
          <span className="text-2xs text-primary">✓ matches real assignment ({realIds.length})</span>
        ) : (
          <>
            <span className="text-2xs text-warn">
              ⚠ {[
                missing > 0 ? `${missing} really assigned but not listed here` : null,
                extra > 0 ? `${extra} listed here but not really assigned` : null,
              ].filter(Boolean).join(' · ')}
            </span>
            <Button size="sm" variant="outline" className="h-6 text-2xs px-2 gap-1" onClick={() => onSync(realIds)}>
              <RefreshCw className="h-2.5 w-2.5" />Use real list
            </Button>
          </>
        )
      )}
    </div>
  );
}

export function PlantMeterConfigCard({ plant }: { plant: any }) {
  const { isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
  const { config: savedConfig, isLoading, saveConfig, isLocalOnly } = usePlantMeterConfig(plant.id);
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<PlantMeterConfig>(DEFAULT_METER_CONFIG);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true); // now behind the Configuration tab (Section 7.2) — no need to collapse by default anymore

  // Sync with DB data
  useEffect(() => { setCfg(savedConfig); }, [savedConfig]);

  // Pull wells and locators for group chip editors
  const { data: wells = [] } = useQuery({
    queryKey: ['wells-list', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').eq('plant_id', plant.id).order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
  const { data: locators = [] } = useQuery({
    queryKey: ['locators-list', plant.id],
    queryFn: async () => {
      // NOTE: product_meter_id is missing from the generated Supabase types
      // (src/integrations/supabase/types.ts) even though it's a real column
      // added by 20260721_product_meters_and_readings.sql — see the flagged
      // "stale generated types" issue.
      // REFINEMENT (2026-07-25): swapped the `(supabase.from('locators') as
      // any)` cast for `.returns<>()` — the same escape hatch ROTrains.tsx
      // already uses for its own missing-column/view situation. This keeps
      // .from('locators') and .select(...) properly typed (locators is a
      // real, known table) and only overrides the final result shape, so it
      // doesn't trip @typescript-eslint/no-explicit-any like the `any` cast
      // did. Regenerate types.ts and the .returns<>() override can be dropped.
      const { data } = await supabase.from('locators')
        .select('id, name, product_meter_id').eq('plant_id', plant.id).order('name')
        .returns<Array<{ id: string; name: string; product_meter_id: string | null }>>();
      return data ?? [];
    },
  });
  // Real Product Meters for this plant, used only to cross-check/sync the
  // "Shared bulk meter groups" below against the actual Assign Locators
  // assignments (product_meter_id) — see note above that section.
  const { data: configProductMeters = [] } = useQuery({
    queryKey: ['config-product-meters', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_meters').select('id, name').eq('plant_id', plant.id).order('sort_order', { ascending: true });
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const update = (patch: Partial<PlantMeterConfig>) => setCfg(c => ({ ...c, ...patch }));

  const doSave = async () => {
    setSaving(true);
    // Mirror energy sources back to the plants table for backwards compat
    await supabase.from('plants').update({
      has_solar: cfg.has_solar,
      has_grid: cfg.has_grid,
      solar_capacity_kw: cfg.solar_capacity_kw,
    }).eq('id', plant.id);

    // ── Sync has_power_meter on all wells from meter config ─────────────────
    // The meter config is the source of truth for WHICH wells have electricity
    // metering. We derive has_power_meter (which gates the kWh input in
    // Operations) from the config so both data stores stay consistent.
    const electricWellIds = new Set<string>([
      ...cfg.wells_dedicated_electric_ids,
      ...cfg.wells_shared_electric_groups.flatMap(g => g.members),
    ]);
    if (wells.length > 0) {
      const toEnable  = wells.filter(w => electricWellIds.has(w.id)).map(w => w.id);
      const toDisable = wells.filter(w => !electricWellIds.has(w.id)).map(w => w.id);
      await Promise.all([
        toEnable.length  ? supabase.from('wells').update({ has_power_meter: true  }).in('id', toEnable)  : Promise.resolve(),
        toDisable.length ? supabase.from('wells').update({ has_power_meter: false }).in('id', toDisable) : Promise.resolve(),
      ]);
      qc.invalidateQueries({ queryKey: ['wells', plant.id] });
    }

    const savedToDb = await saveConfig(cfg);
    setSaving(false);
    if (savedToDb) {
      toast.success('Meter configuration saved');
    } else {
      // NOT a success — the change only reached this browser's localStorage.
      // Dashboard, TrendChart, and the Data Summary modal all read this
      // config straight from Supabase, so production/consumption totals
      // elsewhere will NOT reflect this change until it actually syncs
      // (retried automatically in the background — see usePlantMeterConfig).
      toast.warning('Saved on this device only — not yet in the database', {
        description: 'Other screens (Dashboard, Production totals) won\'t show this change until it syncs. It will retry automatically.',
        duration: 10000,
      });
    }
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meter config…
    </div>
  );

  // Summary badge shown on the collapsed header
  const roFlags = [
    cfg.ro_has_feed_meter && 'Feed',
    cfg.ro_has_permeate_meter && 'Perm',
    cfg.ro_has_reject_meter && 'Reject',
  ].filter(Boolean).join(' · ') || 'None';

  return (
    <Card className="p-0 overflow-hidden" data-testid="plant-meter-config-card">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          <div>
            <div className="text-sm font-semibold">Plant Configuration Settings</div>
            {!open && (
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>RO: {roFlags}</span>
                <span>Prod: {cfg.ro_production_source === 'both'
                  ? `Product meter + Permeate${cfg.permeate_is_production ? '' : ' (⚠ permeate switch off)'}`
                  : cfg.ro_production_source === 'permeate'
                    ? `Permeate${cfg.permeate_is_production
                        ? ` (${cfg.permeate_cutoff_enabled ? `cut-off ${cfg.permeate_cutoff_time || '00:20'}` : 'no cut-off'})`
                        : ''}`
                    : 'Product meter'}</span>
                {cfg.ro_has_per_train_electricity && <span>⚡ Per-train kWh</span>}
                <span>{cfg.has_solar && cfg.has_grid ? 'Solar + Grid' : cfg.has_solar ? 'Solar' : 'Grid'}</span>
                <span>Loc: {cfg.locator_readings_per_day ?? 3}×/day</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!canEdit && <span className="text-2xs bg-muted px-2 py-0.5 rounded font-medium text-muted-foreground">View only</span>}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-5 border-t border-border/50">
          {isLocalOnly && (
            <div className="mt-4 flex items-start gap-2 text-xs text-warn bg-warn-soft border border-warn rounded-md px-3 py-2">
              <span className="mt-0.5">⚠</span>
              <span>
                A saved change to this plant's configuration hasn't reached the database yet — it's stored
                only on this device. Dashboard, Trend, and Production totals elsewhere won't reflect it until
                it syncs. This retries automatically in the background; keep this app open on this device for
                it to take effect, or ask an admin to check the <code className="font-mono">plant_meter_config</code> table/RLS setup.
              </span>
            </div>
          )}
          {/* ══ SECTION: RO Trains ══ */}
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <ROTrainIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RO Trains — Flow meters</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <MeterToggleTile
                icon={<Droplet className="h-4 w-4 text-info" />}
                title="Feed meter"
                subtitle="Raw input flow into RO train"
                checked={cfg.ro_has_feed_meter}
                onToggle={v => update({ ro_has_feed_meter: v })}
                canEdit={canEdit}
                accentColor="blue"
              />
              <MeterToggleTile
                icon={<Droplet className="h-4 w-4 text-primary" />}
                title="Permeate meter"
                subtitle="Filtered / product-side output"
                checked={cfg.ro_has_permeate_meter}
                onToggle={v => update({ ro_has_permeate_meter: v })}
                canEdit={canEdit}
              />
              <MeterToggleTile
                icon={<Droplet className="h-4 w-4 text-warn" />}
                title="Reject meter"
                subtitle="Brine / concentrate output"
                checked={cfg.ro_has_reject_meter}
                onToggle={v => update({ ro_has_reject_meter: v })}
                canEdit={canEdit}
                accentColor="amber"
              />
            </div>
            {!cfg.ro_has_reject_meter && (
              <p className="mt-2 text-xs text-info bg-info-soft border border-info rounded-md px-2.5 py-1.5">
                No reject meter — reject flow auto-inferred as feed − permeate. Operators won't see a reject meter input.
              </p>
            )}
            {!cfg.ro_has_feed_meter && cfg.ro_has_permeate_meter && cfg.ro_has_reject_meter && (
              <p className="mt-2 text-xs text-info bg-info-soft border border-info rounded-md px-2.5 py-1.5">
                No feed meter — feed flow auto-inferred as permeate + reject.
              </p>
            )}
          </div>

          {/* ── Production source ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Production volume source</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([
                { val: 'product', label: 'Dedicated product meter', sub: 'Separate meter for finished product' },
                { val: 'permeate', label: 'Permeate meter = production', sub: 'No product meter — permeate IS production' },
                { val: 'both', label: 'Product meter + Permeate', sub: 'Two independent sources — totals are added together' },
              ] as const).map(opt => (
                <label key={opt.val} className={[
                  'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                  cfg.ro_production_source === opt.val ? 'border-primary/60 bg-primary-soft/70' : 'border-border bg-muted/30',
                  canEdit ? 'cursor-pointer' : 'cursor-default',
                ].join(' ')}>
                  <div className={`h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${cfg.ro_production_source === opt.val ? 'border-primary' : 'border-muted-foreground/40'}`}>
                    {cfg.ro_production_source === opt.val && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.sub}</div>
                  </div>
                  {canEdit && (
                    <input type="radio" className="sr-only" checked={cfg.ro_production_source === opt.val}
                      onChange={() => update({
                        ro_production_source: opt.val,
                        // Selecting 'permeate' or 'both' always needs RO permeate deltas
                        // pulled into production — flip the switch in the same click so
                        // choosing a source here can't silently leave permeate excluded
                        // (the exact gap that leaves Total Prod. blank for a plant like
                        // this — see MeterConfig summary badge below once saved).
                        permeate_is_production: opt.val !== 'product',
                      })} />
                  )}
                </label>
              ))}
            </div>
            {cfg.ro_production_source === 'both' && (
              <p className="mt-2 text-xs text-warn bg-warn-soft border border-warn rounded-md px-2.5 py-1.5">
                Only pick this if the product meter and the permeate meter measure <em>different</em> water
                (e.g. a bulk/mirrored meter from another plant, plus this plant's own RO output). If they
                measure the same water twice, use "Permeate meter = production" instead — otherwise Total
                Production and NRW % will be inflated.
              </p>
            )}
          </div>

          {/* ── Permeate = Production: cut-off (manager only) ── */}
          {(cfg.ro_production_source === 'permeate' || cfg.ro_production_source === 'both') && (() => {
            return (
              <div className="rounded-lg border border-primary bg-primary-soft/40 p-3 space-y-2.5">
                {/* Header row with master toggle */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <span>⏱</span> Permeate readings are production
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      Readings are collected hourly. A daily "cut-off" groups them into calendar days.
                      The day label is the date <em>after</em> the cut-off crosses midnight.
                    </div>
                  </div>
                  <Switch
                    checked={cfg.permeate_is_production}
                    onCheckedChange={canEdit ? (v) => update({ permeate_is_production: v }) : undefined}
                    disabled={!canEdit}
                    className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
                  />
                </div>

                {cfg.permeate_is_production && (
                  <div className="space-y-4 pt-1 border-t border-primary">

                    {/* ── Daily cut-off time ── */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily cut-off time</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(cfg.permeate_cutoff_enabled ?? true)
                              ? 'Readings taken just after midnight are attributed to the previous production day.'
                              : 'Cut-off is optional — new entries use the natural calendar date. Historical data still groups by the saved time below.'}
                          </p>
                        </div>
                        <Switch
                          checked={cfg.permeate_cutoff_enabled ?? true}
                          onCheckedChange={canEdit ? (v) => update({ permeate_cutoff_enabled: v }) : undefined}
                          disabled={!canEdit}
                          className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
                        />
                      </div>

                      {/* Always show the time input — it's used for historical grouping even when toggle is off */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {canEdit ? (
                          <Input
                            type="time"
                            value={cfg.permeate_cutoff_time}
                            onChange={e => update({ permeate_cutoff_time: e.target.value })}
                            className="h-8 w-32 text-sm font-mono"
                          />
                        ) : (
                          <span className="font-mono text-sm bg-muted px-2 py-1 rounded border border-border">
                            {cfg.permeate_cutoff_time || '00:20'}
                          </span>
                        )}
                        <div className="text-xs text-muted-foreground leading-relaxed max-w-xs">
                          {(() => {
                            const t = cfg.permeate_cutoff_time || '00:20';
                            const [hh, mm] = t.split(':');
                            const cutH = parseInt(hh ?? '0');
                            const cutM = parseInt(mm ?? '20');
                            const pad = (n: number) => String(n).padStart(2, '0');
                            const nextM = (cutM + 1) % 60;
                            const nextH = cutM === 59 ? (cutH + 1) % 24 : cutH;
                            return (cfg.permeate_cutoff_enabled ?? true) ? (
                              <span>
                                Day recorded as <strong>May 4</strong> = readings from{' '}
                                <span className="font-mono">May 3 {pad(nextH)}:{pad(nextM)}</span> to{' '}
                                <span className="font-mono">May 4 {t}</span>
                              </span>
                            ) : (
                              <span className="italic text-muted-foreground/70">
                                Saved for historical grouping. New entries use <strong>midnight</strong> as the day boundary.
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {!canEdit && (
                        <p className="text-2xs text-muted-foreground">Only managers and admins can change these settings.</p>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Per-train utility meters ── */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Per-train utility meters</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <MeterToggleTile
                icon={<Zap className="h-4 w-4 text-warn" />}
                title="Electricity meter per train"
                subtitle="Each train has its own kWh meter"
                checked={cfg.ro_has_per_train_electricity}
                onToggle={v => update({ ro_has_per_train_electricity: v })}
                canEdit={canEdit}
                accentColor="amber"
              />
              <MeterToggleTile
                icon={<Gauge className="h-4 w-4 text-info" />}
                title="Water meter per train"
                subtitle="Each train has its own flow meter"
                checked={cfg.ro_has_per_train_water}
                onToggle={v => update({ ro_has_per_train_water: v })}
                canEdit={canEdit}
                accentColor="blue"
              />
            </div>

            {/* Shared power meter group notice — shown when per-train kWh is enabled */}
            {cfg.ro_has_per_train_electricity && (
              <div className="mt-2 rounded-md border border-warn bg-warn-soft/60 px-3 py-2 text-xs text-warn space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Zap className="h-3 w-3 shrink-0" /> Shared Power Meter Groups
                </p>
                <p className="opacity-80 leading-relaxed">
                  If multiple trains share <em>one physical meter</em> (e.g. Umapad Colbox 1/2/3),
                  set <code className="font-mono bg-warn-soft px-1 rounded">shared_power_meter_group</code> to
                  the same label on each train (via CSV import or SQL).
                  Operators enter the <strong>same meter reading</strong> on each train — the delta is stored per-train;
                  volume-weighted kWh attribution runs in reporting queries.
                </p>
                <p className="text-2xs opacity-60 font-mono">
                  SQL: UPDATE ro_trains SET shared_power_meter_group = 'colbox' WHERE plant_id = '…' AND train_number IN (1,2,3);
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: Wells ══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Droplet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raw water — wells</span>
              <span className="text-2xs text-muted-foreground ml-1">(each well always has its own water meter)</span>
            </div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Electricity metering</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <MeterToggleTile
                icon={<Zap className="h-4 w-4 text-warn" />}
                title="Shared electric meter"
                subtitle="Multiple wells / colboxes share one kWh meter"
                checked={cfg.wells_shared_electric_groups.length > 0}
                onToggle={v => update({ wells_shared_electric_groups: v ? [{ id: crypto.randomUUID(), name: 'Group 1', members: [] }] : [] })}
                canEdit={canEdit}
                accentColor="amber"
              />
              <MeterToggleTile
                icon={<Zap className="h-4 w-4 text-warn" />}
                title="Dedicated meter (per well)"
                subtitle="Some wells have their own kWh meter"
                checked={cfg.wells_dedicated_electric_ids.length > 0}
                onToggle={v => update({ wells_dedicated_electric_ids: v ? (wells[0] ? [wells[0].id] : []) : [] })}
                canEdit={canEdit}
                accentColor="amber"
              />
              <MeterToggleTile
                icon={<Zap className="h-4 w-4 text-muted-foreground" />}
                title="No electricity metering"
                subtitle="Some wells have no kWh meter at all"
                checked={cfg.wells_no_electric}
                onToggle={v => update({ wells_no_electric: v })}
                canEdit={canEdit}
                accentColor="teal"
              />
            </div>

            {/* Shared electric groups */}
            {cfg.wells_shared_electric_groups.length > 0 && (
              <div className="space-y-2.5 mb-2">
                <p className="text-xs font-medium text-muted-foreground">Shared meter groups</p>
                {cfg.wells_shared_electric_groups.map((grp, gi) => (
                  <div key={grp.id}>
                    <MeterGroupChips
                      label={grp.name}
                      groupName={grp.name}
                      members={grp.members}
                      allEntities={wells}
                      entityLabel="well"
                      canEdit={canEdit}
                      onGroupNameChange={name => {
                        const next = [...cfg.wells_shared_electric_groups];
                        next[gi] = { ...grp, name };
                        update({ wells_shared_electric_groups: next });
                      }}
                      onMembersChange={members => {
                        const next = [...cfg.wells_shared_electric_groups];
                        next[gi] = { ...grp, members };
                        update({ wells_shared_electric_groups: next });
                      }}
                      onDeleteGroup={() => update({ wells_shared_electric_groups: cfg.wells_shared_electric_groups.filter((_, i) => i !== gi) })}
                    />
                  </div>
                ))}
                {canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 rounded-lg border-border/80 font-semibold"
                    onClick={() => update({ wells_shared_electric_groups: [...cfg.wells_shared_electric_groups, { id: crypto.randomUUID(), name: `Group ${cfg.wells_shared_electric_groups.length + 1}`, members: [] }] })}>
                    <Plus className="h-3 w-3 text-primary" />Add group
                  </Button>
                )}
              </div>
            )}

            {/* Dedicated electric wells */}
            {cfg.wells_dedicated_electric_ids.length > 0 && (
              <div className="space-y-1.5 mb-2">
                <p className="text-xs font-medium text-muted-foreground">Wells with dedicated meter</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {cfg.wells_dedicated_electric_ids.map(id => {
                    const w = wells.find(x => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-warn-soft text-warn border border-warn/40 font-medium shadow-2xs">
                        <span>{w?.name ?? id}</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => update({ wells_dedicated_electric_ids: cfg.wells_dedicated_electric_ids.filter(x => x !== id) })}
                            aria-label={`Remove ${w?.name ?? id}`}
                            title="Remove"
                            className="h-3.5 w-3.5 rounded-full hover:bg-warn/20 flex items-center justify-center text-warn/80 hover:text-warn transition-colors -mr-1"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {canEdit && wells.filter(w => !cfg.wells_dedicated_electric_ids.includes(w.id)).length > 0 && (
                    <Select onValueChange={id => update({ wells_dedicated_electric_ids: [...cfg.wells_dedicated_electric_ids, id] })}>
                      <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
                        <Plus className="h-3 w-3 mr-1 text-primary" />Add well
                      </SelectTrigger>
                      <SelectContent>
                        {wells.filter(w => !cfg.wells_dedicated_electric_ids.includes(w.id)).map(w => (
                          <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: Locators ══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locators / distribution</span>
              <span className="text-2xs text-muted-foreground ml-1">(each locator always has its own water meter)</span>
            </div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Bulk / product metering</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              <MeterToggleTile
                icon={<Gauge className="h-4 w-4 text-primary" />}
                title="Dedicated bulk meter"
                subtitle="Some locators have their own bulk meter"
                checked={cfg.locators_dedicated_bulk_ids.length > 0}
                onToggle={v => update({ locators_dedicated_bulk_ids: v ? (locators[0] ? [locators[0].id] : []) : [] })}
                canEdit={canEdit}
              />
              <MeterToggleTile
                icon={<Gauge className="h-4 w-4 text-kpi-ro" />}
                title="Shared bulk meter group"
                subtitle="Multiple locators share one bulk meter"
                checked={cfg.locators_shared_bulk_groups.length > 0}
                onToggle={v => update({ locators_shared_bulk_groups: v ? [{ id: crypto.randomUUID(), name: 'South Cluster', members: [] }] : [] })}
                canEdit={canEdit}
                accentColor="purple"
              />
              <MeterToggleTile
                icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
                title="No bulk meter (some locators)"
                subtitle="Certain locators only track water meter"
                checked={cfg.locators_no_bulk}
                onToggle={v => update({ locators_no_bulk: v })}
                canEdit={canEdit}
                accentColor="teal"
              />
            </div>

            {/* Dedicated bulk locators */}
            {cfg.locators_dedicated_bulk_ids.length > 0 && (
              <div className="space-y-1.5 mb-2">
                <p className="text-xs font-medium text-muted-foreground">Locators with dedicated bulk meter</p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {cfg.locators_dedicated_bulk_ids.map(id => {
                    const l = locators.find(x => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/40 font-medium shadow-2xs">
                        <span>{l?.name ?? id}</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => update({ locators_dedicated_bulk_ids: cfg.locators_dedicated_bulk_ids.filter(x => x !== id) })}
                            aria-label={`Remove ${l?.name ?? id}`}
                            title="Remove"
                            className="h-3.5 w-3.5 rounded-full hover:bg-primary/20 flex items-center justify-center text-primary/70 hover:text-primary transition-colors -mr-1"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {canEdit && locators.filter(l => !cfg.locators_dedicated_bulk_ids.includes(l.id)).length > 0 && (
                    <Select onValueChange={id => update({ locators_dedicated_bulk_ids: [...cfg.locators_dedicated_bulk_ids, id] })}>
                      <SelectTrigger className="h-6 w-auto text-xs px-2.5 py-0 rounded-full border-dashed border-border/80 bg-muted/30 hover:bg-muted font-medium">
                        <Plus className="h-3 w-3 mr-1 text-primary" />Add locator
                      </SelectTrigger>
                      <SelectContent>
                        {locators.filter(l => !cfg.locators_dedicated_bulk_ids.includes(l.id)).map(l => (
                          <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            {/* Shared bulk locator groups */}
            {cfg.locators_shared_bulk_groups.length > 0 && (
              <div className="space-y-2.5 mb-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Shared bulk meter groups <span className="font-normal opacity-70">(for reference / reporting only — each locator still logs separately. This list is independent from the real "Assign Locators" assignment on the Product tab, which drives NRW/derived-meter calculations. Use "Compare to Assign Locators" below to check for drift.)</span>
                </p>
                {cfg.locators_shared_bulk_groups.map((grp, gi) => (
                  <div key={grp.id} className="space-y-1.5">
                    <MeterGroupChips
                      label={grp.name}
                      groupName={grp.name}
                      members={grp.members}
                      allEntities={locators}
                      entityLabel="locator"
                      canEdit={canEdit}
                      onGroupNameChange={name => {
                        const next = [...cfg.locators_shared_bulk_groups];
                        next[gi] = { ...grp, name };
                        update({ locators_shared_bulk_groups: next });
                      }}
                      onMembersChange={members => {
                        const next = [...cfg.locators_shared_bulk_groups];
                        next[gi] = { ...grp, members };
                        update({ locators_shared_bulk_groups: next });
                      }}
                      onDeleteGroup={() => update({ locators_shared_bulk_groups: cfg.locators_shared_bulk_groups.filter((_, i) => i !== gi) })}
                    />
                    <LocatorGroupRealitySync
                      productMeters={configProductMeters}
                      locators={locators}
                      members={grp.members}
                      canEdit={canEdit}
                      onSync={members => {
                        const next = [...cfg.locators_shared_bulk_groups];
                        next[gi] = { ...grp, members };
                        update({ locators_shared_bulk_groups: next });
                      }}
                    />
                  </div>
                ))}
                {canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 rounded-lg border-border/80 font-semibold"
                    onClick={() => update({ locators_shared_bulk_groups: [...cfg.locators_shared_bulk_groups, { id: crypto.randomUUID(), name: `Cluster ${cfg.locators_shared_bulk_groups.length + 1}`, members: [] }] })}>
                    <Plus className="h-3 w-3 text-primary" />Add group
                  </Button>
                )}
              </div>
            )}

            {/* ── Locator readings frequency ── */}
            <div className="mt-3 rounded-lg border border-primary bg-primary-soft/40 p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="text-sm font-medium">Locator readings per day</div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                How many times per day operators can submit a reading per locator. Only managers and admins can change this.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Preset buttons */}
                {([3, 8, 24] as const).map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => canEdit && update({ locator_readings_per_day: preset })}
                    disabled={!canEdit}
                    className={[
                      'px-3 py-1 text-xs font-medium rounded-md border transition-colors',
                      (cfg.locator_readings_per_day ?? 3) === preset
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border hover:bg-muted dark:hover:bg-muted/50',
                      !canEdit ? 'opacity-50 cursor-default' : 'cursor-pointer',
                    ].join(' ')}
                    title={preset === 24 ? 'Hourly (every hour)' : `${preset} times per day`}
                  >
                    {preset === 24 ? 'Hourly (24)' : `${preset}×/day`}
                  </button>
                ))}
                {/* Custom stepper */}
                {canEdit ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Custom:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => update({ locator_readings_per_day: Math.max(1, (cfg.locator_readings_per_day ?? 3) - 1) })}
                        disabled={(cfg.locator_readings_per_day ?? 3) <= 1}
                        className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                      >−</button>
                      <Input
                        type="number"
                        min={1}
                        max={48}
                        value={cfg.locator_readings_per_day ?? 3}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v >= 1 && v <= 48) update({ locator_readings_per_day: v });
                        }}
                        className="h-7 w-14 text-xs text-center font-mono font-semibold"
                      />
                      <button
                        type="button"
                        onClick={() => update({ locator_readings_per_day: Math.min(48, (cfg.locator_readings_per_day ?? 3) + 1) })}
                        disabled={(cfg.locator_readings_per_day ?? 3) >= 48}
                        className="h-7 w-7 rounded-md border bg-background flex items-center justify-center text-sm font-medium hover:bg-muted disabled:opacity-40"
                      >+</button>
                    </div>
                    <span className="text-xs text-muted-foreground">per day</span>
                  </div>
                ) : (
                  <span className="text-sm font-mono font-semibold">{cfg.locator_readings_per_day ?? 3}×/day</span>
                )}
              </div>
              {!canEdit && (
                <p className="text-2xs text-muted-foreground">Only managers and admins can change the reading frequency.</p>
              )}
            </div>
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: Energy / Power ══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Energy sources</span>
              <span className="text-2xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded ml-1">
                {cfg.has_solar && cfg.has_grid ? 'Solar + Grid' : cfg.has_solar ? 'Solar only' : 'Grid only'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <MeterToggleTile
                icon={<Sun className="h-4 w-4 text-warn" />}
                title="Solar"
                subtitle="Photovoltaic energy source"
                checked={cfg.has_solar}
                onToggle={v => update({ has_solar: v })}
                canEdit={canEdit}
                accentColor="amber"
              />
              <MeterToggleTile
                icon={<GridPylonIcon className="h-4 w-4 text-info" />}
                title="Grid"
                subtitle="Utility / mains power supply"
                checked={cfg.has_grid}
                onToggle={v => update({ has_grid: v })}
                canEdit={canEdit}
                accentColor="blue"
              />
            </div>
            {cfg.has_solar && canEdit && (
              <div className="mt-2 space-y-2">
                <Label htmlFor="meterconfig-solar-capacity-kw" className="text-xs text-muted-foreground">Solar capacity (kW)</Label>
                <Input
                  type="number" step="any" value={cfg.solar_capacity_kw ?? ''}
                  onChange={e => update({ solar_capacity_kw: e.target.value ? +e.target.value : null })}
                  placeholder="e.g. 50"
                  className="h-9 text-sm mt-1 max-w-[180px]"
                id="meterconfig-solar-capacity-kw"/>
                <div>
                  <p className="text-xs text-muted-foreground mb-1 block">
                    Solar reading input mode
                    <span className="ml-1 text-2xs opacity-70">(used in Operations entry form)</span>
                  </p>
                  <div className="flex items-center rounded-md border border-warn overflow-hidden text-xs font-medium w-fit">
                    <button
                      type="button"
                      onClick={() => update({ default_solar_input_mode: 'raw' })}
                      className={[
                        'px-3 py-1.5 transition-colors',
                        cfg.default_solar_input_mode !== 'direct'
                          ? 'bg-warn text-white'
                          : 'bg-transparent text-muted-foreground hover:bg-warn-soft',
                      ].join(' ')}
                      title="Cumulative meter reading — Δ auto-computed from previous"
                    >
                      Raw Meter
                    </button>
                    <button
                      type="button"
                      onClick={() => update({ default_solar_input_mode: 'direct' })}
                      className={[
                        'px-3 py-1.5 transition-colors border-l border-warn',
                        cfg.default_solar_input_mode === 'direct'
                          ? 'bg-warn text-white'
                          : 'bg-transparent text-muted-foreground hover:bg-warn-soft',
                      ].join(' ')}
                      title="Enter daily kWh directly — no cumulative meter needed"
                    >
                      Direct kWh
                    </button>
                  </div>
                  <p className="text-2xs text-muted-foreground mt-1">
                    {cfg.default_solar_input_mode === 'direct'
                      ? 'Operators enter daily solar kWh directly (e.g. from inverter display).'
                      : 'Operators enter a cumulative meter reading; Δ is auto-computed.'}
                  </p>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Power meter names (Solar/Grid meter count &amp; labels) are configured in the <strong className="font-medium">Power tab</strong>.
            </p>
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: NRW / Product ══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production & NRW</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <MeterToggleTile
                icon={<BarChart2 className="h-4 w-4 text-primary" />}
                title="Enable NRW calculation"
                subtitle="Auto-compute non-revenue water"
                checked={cfg.nrw_enabled}
                onToggle={v => update({ nrw_enabled: v })}
                canEdit={canEdit}
              />
              <MeterToggleTile
                icon={<Gauge className="h-4 w-4 text-info" />}
                title="Billed volume meter"
                subtitle="Separate meter for billed / sold water"
                checked={cfg.has_billed_volume_meter}
                onToggle={v => update({ has_billed_volume_meter: v })}
                canEdit={canEdit}
                accentColor="blue"
              />
            </div>
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: Component Types & Backwash ══ */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Component Types & Backwash</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PlantComponentTypeCard plant={plant} embedded />
              <BackwashModeCard plant={plant} />
            </div>
          </div>

          <div className="border-t border-border/50" />

          {/* ══ SECTION: Chemicals ══ */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base leading-none">🧪</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chemicals in use</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Select which chemicals this plant uses. Only checked chemicals appear in{' '}
              <strong className="font-medium">RO Trains → Chemical Dosing</strong>.
              {!canEdit && ' (view only)'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PLANT_CHEMICALS.map(chem => {
                // Empty array = all chemicals enabled (backwards compat)
                const isEnabled = cfg.enabled_chemicals.length === 0 || cfg.enabled_chemicals.includes(chem.name);
                return (
                  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- Switch (Radix) renders button[role=switch], not a native input; same false positive as ThemeSelector's Switch.
                  <label
                    key={chem.name}
                    className={[
                      'flex items-center gap-3 p-3 rounded-lg border transition-colors',
                      isEnabled
                        ? 'border-primary/60 bg-primary-soft/70'
                        : 'border-border bg-muted/30',
                      canEdit ? 'cursor-pointer' : 'cursor-default',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{chem.name}</div>
                      <div className="text-xs text-muted-foreground">default unit: {chem.defaultUnit}</div>
                    </div>
                    <Switch
                      checked={isEnabled}
                      disabled={!canEdit}
                      onCheckedChange={canEdit ? (checked) => {
                        // When first toggling from "all" (empty) state, expand to full list first
                        const current = cfg.enabled_chemicals.length === 0
                          ? PLANT_CHEMICALS.map(c => c.name)
                          : [...cfg.enabled_chemicals];
                        const next = checked
                          ? [...new Set([...current, chem.name])]
                          : current.filter(n => n !== chem.name);
                        update({ enabled_chemicals: next });
                      } : undefined}
                      className="h-8 w-14 sm:h-5 sm:w-9 shrink-0 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-4 sm:[&>span]:w-4 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary"
                    />
                  </label>
                );
              })}
            </div>
            {canEdit && cfg.enabled_chemicals.length > 0 && cfg.enabled_chemicals.length < PLANT_CHEMICALS.length && (
              <button
                type="button"
                onClick={() => update({ enabled_chemicals: [] })}
                className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Enable all chemicals
              </button>
            )}
          </div>

          {/* ══ SECTION: CIP Chemicals ══ */}
          <CIPChemicalsSection cfg={cfg} update={update} canEdit={canEdit} />

          {/* Save button */}
          {canEdit && (
            <Button onClick={doSave} disabled={saving} className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 text-sm" data-testid="save-meter-config-btn">
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save meter configuration
            </Button>
          )}
          {!canEdit && (
            <p className="text-xs text-muted-foreground text-center">Only managers and admins can edit meter configuration.</p>
          )}
        </div>
      )}
    </Card>
  );
}


export function PlantComponentTypeCard({ plant, embedded = false }: { plant: any; embedded?: boolean }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mediaType, setMediaTypeState] = useState<'AFM' | 'MMF'>(plant.filter_media_type ?? 'AFM');
  const [filterType, setFilterTypeState] = useState<'Cartridge Filter' | 'Bag Filter'>(plant.filter_housing_type ?? 'Cartridge Filter');

  // Independent collapse state for each row — collapsed by default
  const [mediaOpen, setMediaOpen]   = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const setMediaType = (v: 'AFM' | 'MMF') => { setMediaTypeState(v); setEditing(true); };
  const setFilterType = (v: 'Cartridge Filter' | 'Bag Filter') => { setFilterTypeState(v); setEditing(true); };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('plants')
      .update({ filter_media_type: mediaType, filter_housing_type: filterType })
      .eq('id', plant.id);
    setSaving(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success('Component types updated for all trains');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  const cancel = () => {
    setMediaTypeState(plant.filter_media_type ?? 'AFM');
    setFilterTypeState(plant.filter_housing_type ?? 'Cartridge Filter');
    setEditing(false);
  };

  const inner = (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="h-4 w-4 text-chart-6 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Plant-wide Component Types</div>
          <div className="text-2xs text-muted-foreground">Applies universally — reflected in all train labels &amp; forms.</div>
        </div>
      </div>

      <div className="space-y-1.5 flex-1">
        {/* ── Media filter collapsible row ── */}
        <div className="rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setMediaOpen(o => !o)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Media</span>
              {/* Current value badge — visible when collapsed */}
              {!mediaOpen && (
                <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                  {mediaType}
                </span>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${mediaOpen ? 'rotate-180' : ''}`} />
          </button>
          {mediaOpen && (
            <div className="p-2">
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
                {(['AFM', 'MMF'] as const).map((opt) => {
                  const active = mediaType === opt;
                  return (
                    <button
                      key={opt}
                      disabled={!isManager}
                      onClick={() => { if (isManager) setMediaType(opt); }}
                      data-testid={`media-type-${opt}`}
                      className={[
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        !isManager ? 'cursor-default opacity-70' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full border ${active ? 'bg-white border-white' : 'border-muted-foreground/40'}`} />
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Pre-filter collapsible row ── */}
        <div className="rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setFilterOpen(o => !o)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pre-filter</span>
              {!filterOpen && (
                <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                  {filterType === 'Cartridge Filter' ? 'Cartridge' : 'Bag'}
                </span>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
          </button>
          {filterOpen && (
            <div className="p-2">
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
                {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => {
                  const active = filterType === opt;
                  return (
                    <button
                      key={opt}
                      disabled={!isManager}
                      onClick={() => { if (isManager) setFilterType(opt); }}
                      data-testid={`filter-type-${opt.replace(' ', '-')}`}
                      className={[
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        !isManager ? 'cursor-default opacity-70' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full border ${active ? 'bg-white border-white' : 'border-muted-foreground/40'}`} />
                      {opt === 'Cartridge Filter' ? 'Cartridge' : 'Bag'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save / Cancel — only shown when manager has made changes */}
      {isManager && editing && (
        <div className="flex gap-1.5 justify-end pt-2.5">
          <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving} data-testid="save-component-types-btn" className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex flex-col" data-testid="plant-component-type-card">{inner}</div>;
  return <Card className="p-3 flex flex-col" data-testid="plant-component-type-card">{inner}</Card>;
}

// ─── Edit Train Dialog ───────────────────────────────────────────────────────

