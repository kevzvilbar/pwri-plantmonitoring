import { useState, useId } from 'react';
import { MeterToggleTile } from '../MeterConfig';
import { RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { Gauge, Zap, Wrench, Info } from 'lucide-react';
import { useROTrainsForPlant, type ROTrain } from '@/hooks/useROTrains';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface RoTrainsMeterSectionProps {
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
  update: (patch: Partial<import('@/pages/plants/shared').PlantMeterConfig>) => void;
  canEdit: boolean;
  plantId?: string;
}

export function RoTrainsMeterSection({ cfg, update, canEdit, plantId }: RoTrainsMeterSectionProps) {
  return (
    <>
      {/* ══ SECTION: RO Trains ══ */}
      <div className="space-y-3">
        {/* 3 presence toggles, 3 columns — an even row at every desktop width */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <MeterToggleTile
            icon={<RawWaterIcon className="h-4 w-4 text-info" />}
            title="Feed meter"
            subtitle={
              !cfg.ro_has_feed_meter && cfg.ro_has_permeate_meter && cfg.ro_has_reject_meter
                ? 'Off — computed as permeate + reject'
                : 'Raw input flow into RO train'
            }
            checked={cfg.ro_has_feed_meter}
            onToggle={v => update({ ro_has_feed_meter: v })}
            canEdit={canEdit}
            accentColor="blue"
          />
          <MeterToggleTile
            icon={<PermeateIcon className="h-4 w-4 text-primary" />}
            title="Permeate meter"
            subtitle="Filtered / product-side output"
            checked={cfg.ro_has_permeate_meter}
            onToggle={v => update({ ro_has_permeate_meter: v })}
            canEdit={canEdit}
          />
          <MeterToggleTile
            icon={<RejectIcon className="h-4 w-4 text-muted-foreground" />}
            title="Reject meter"
            subtitle={!cfg.ro_has_reject_meter ? 'Off — computed as feed − permeate' : 'Brine / concentrate output'}
            checked={cfg.ro_has_reject_meter}
            onToggle={v => update({ ro_has_reject_meter: v })}
            canEdit={canEdit}
            // Neutral, not amber/warn — see MeterToggleTile.tsx and
            // RejectIcon in water-icons.tsx for the shared rationale.
            accentColor="neutral"
          />
        </div>
        {!cfg.ro_has_reject_meter && (
          <div className="flex items-start gap-1.5 text-xs text-info bg-info-soft border border-info rounded-md px-2.5 py-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>No reject meter — reject flow auto-inferred as feed − permeate. Operators won't see a reject meter input.</span>
          </div>
        )}
        {!cfg.ro_has_feed_meter && cfg.ro_has_permeate_meter && cfg.ro_has_reject_meter && (
          <div className="flex items-start gap-1.5 text-xs text-info bg-info-soft border border-info rounded-md px-2.5 py-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>No feed meter — feed flow auto-inferred as permeate + reject.</span>
          </div>
        )}
        {/* ── Per-train Electromagnetic (EMF) meter configuration ── */}
        {plantId && (
          <TrainEmConfigSection plantId={plantId} canEdit={canEdit} cfg={cfg} />
        )}
      </div>

      {/* ── Per-train utility meters ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train utility meters</span>
        </div>
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
          <div className="rounded-md border border-warn bg-warn-soft/60 px-3 py-2 text-xs text-warn space-y-1">
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
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Per-train Electromagnetic (EMF) meter configuration section
   ─────────────────────────────────────────────────────────────────────────── */

function TrainEmConfigSection({ plantId, canEdit, cfg: plantCfg }: {
  plantId: string;
  canEdit: boolean;
  cfg: import('@/pages/plants/shared').PlantMeterConfig;
}) {
  const queryClient = useQueryClient();
  const { data: trains = [], isLoading, error } = useROTrainsForPlant(plantId);
  const [bulkApplying, setBulkApplying] = useState<EmMode | null>(null);

  if (isLoading) return <div className="pt-2 text-xs text-muted-foreground/60">Loading trains…</div>;
  if (error) return <div className="pt-2 text-xs text-warn">Could not load trains</div>;
  if (trains.length === 0) return null;

  const getTrainEmConfig = (t: ROTrain): TrainEmCfg => ({
    uses_em_meter: t.uses_em_meter,
    em_all_streams: t.em_all_streams,
    em_stream_feed: t.em_stream_feed,
    em_stream_permeate: t.em_stream_permeate,
    em_stream_reject: t.em_stream_reject,
  });

  const handleUpdate = async (trainId: string, trainLabel: string, patch: EmConfigPatch) => {
    try {
      await updateTrainEmCfg(trainId, patch);
      toast.success(`${trainLabel} instrumentation updated`);
      // Invalidate trains query to refresh UI with fresh data
      await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    } catch (err: any) {
      toast.error('Failed to update Electromagnetic (EMF) config', { description: err.message });
    }
  };

  // Bulk-apply — the common case is "every train is instrumented the same
  // way", which previously meant tapping the same segmented control 7 times.
  // Fires all trains in parallel and reports one consolidated result instead
  // of one toast per train.
  const handleBulkApply = async (mode: EmMode) => {
    if (!canEdit || bulkApplying) return;
    setBulkApplying(mode);
    const patch = modeToPatch(mode);
    const results = await Promise.allSettled(trains.map(t => updateTrainEmCfg(t.id, patch)));
    const failed = results.filter(r => r.status === 'rejected').length;
    await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    setBulkApplying(null);
    if (failed === 0) {
      toast.success(`Set all ${trains.length} trains to ${MODE_LABEL[mode]}`);
    } else {
      toast.warning(`${trains.length - failed} of ${trains.length} trains updated`, {
        description: `${failed} train${failed === 1 ? '' : 's'} failed — check the individual rows below.`,
      });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train meter instrumentation</span>
        <span className="text-xs font-medium text-primary bg-primary-soft rounded-full px-2 py-0.5">Saves instantly</span>
      </div>
      {/* One table, one row per train — the column headers (Train / Electromagnetic (EMF) mode /
          Streams) are written once instead of being repeated on every row. */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {trains.length} train{trains.length === 1 ? '' : 's'}
          </span>
          {canEdit && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Set all to</span>
              <EmModeToggle
                mode={bulkApplying ?? undefined}
                onSelect={handleBulkApply}
                disabled={!!bulkApplying}
                ariaPrefix="Set all trains to"
              />
            </div>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Train</TableHead>
              <TableHead>Electromagnetic (EMF) mode</TableHead>
              <TableHead>Streams</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trains.map(t => {
              const trainLabel = t.name ?? `Train ${t.train_number}`;
              return (
                <TrainEmConfigRow
                  key={t.id}
                  trainLabel={trainLabel}
                  cfg={getTrainEmConfig(t)}
                  plantCfg={plantCfg}
                  onUpdate={patch => handleUpdate(t.id, trainLabel, patch)}
                  canEdit={canEdit}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Type for Electromagnetic (EMF) config patches — known columns on ro_trains
type EmConfigPatch = Partial<{
  uses_em_meter: boolean;
  em_all_streams: boolean;
  em_stream_feed: boolean;
  em_stream_permeate: boolean;
  em_stream_reject: boolean;
}>;

function updateTrainEmCfg(trainId: string, patch: EmConfigPatch): Promise<{ success: boolean; error?: string }> {
  return (async () => {
    const { data, error } = await (supabase as any).rpc('fn_update_ro_train_em_config', {
      p_train_id: trainId,
      p_uses_em_meter: patch.uses_em_meter ?? null,
      p_em_all_streams: patch.em_all_streams ?? null,
      p_em_stream_feed: patch.em_stream_feed ?? null,
      p_em_stream_permeate: patch.em_stream_permeate ?? null,
      p_em_stream_reject: patch.em_stream_reject ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }
    const result = data as { success: boolean; error?: string };
    if (!result.success) {
      throw new Error(result.error ?? 'Update rejected');
    }
    return result;
  })();
}

/* ───────────────────────────────────────────────────────────────────────────
   Mode selector — shared between each train's row and the "set all" bulk
   control so the two can never visually or behaviorally drift apart.
   ─────────────────────────────────────────────────────────────────────────── */

type EmMode = 'manual' | 'all' | 'mixed';
const MODE_LABEL: Record<EmMode, string> = { manual: 'Turbine (Common)', all: 'All Electromagnetic (EMF)', mixed: 'Mixed' };
// Display order in the toggle: the common "everything has Electromagnetic (EMF) meters" first.
const EM_MODES: EmMode[] = ['all', 'mixed', 'manual'];

// Per-mode active styling — All Electromagnetic (EMF) (instrumented everywhere) reads as info
// blue, Mixed (some streams Electromagnetic (EMF)) as warn amber, Turbine (Common) as neutral muted.
const MODE_META: Record<EmMode, { activeClass: string }> = {
  all: { activeClass: 'data-[state=on]:bg-info-soft data-[state=on]:text-info data-[state=on]:border-info/40' },
  mixed: { activeClass: 'data-[state=on]:bg-warn-soft data-[state=on]:text-warn data-[state=on]:border-warn/40' },
  manual: { activeClass: 'data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:border-border' },
};

type TrainEmCfg = {
  uses_em_meter: boolean | null;
  em_all_streams: boolean | null;
  em_stream_feed: boolean | null;
  em_stream_permeate: boolean | null;
  em_stream_reject: boolean | null;
};

function modeOf(cfg: TrainEmCfg): EmMode {
  if (!(cfg.uses_em_meter ?? false)) return 'manual';
  // Legacy/unset rows default to all-Electromagnetic (EMF) — matches the shared.tsx precedence
  // ("missing from the map defaults to all-Electromagnetic (EMF)").
  return (cfg.em_all_streams ?? true) ? 'all' : 'mixed';
}

const STREAM_FIELDS = [
  { field: 'em_stream_feed' as const, label: 'Feed', plantFlag: 'ro_has_feed_meter' as const },
  { field: 'em_stream_permeate' as const, label: 'Permeate', plantFlag: 'ro_has_permeate_meter' as const },
  { field: 'em_stream_reject' as const, label: 'Reject', plantFlag: 'ro_has_reject_meter' as const },
];

function modeToPatch(mode: EmMode): EmConfigPatch {
  if (mode === 'manual') return { uses_em_meter: false, em_all_streams: false };
  if (mode === 'all') return { uses_em_meter: true, em_all_streams: true };
  return { uses_em_meter: true, em_all_streams: false };
}

function EmModeToggle({ mode, onSelect, disabled, ariaPrefix }: {
  mode?: EmMode;
  onSelect: (m: EmMode) => void;
  disabled?: boolean;
  ariaPrefix: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      // Single-select ToggleGroup fires "" when the pressed item is re-clicked;
      // a mode is always selected, so empty changes are ignored.
      onValueChange={v => { if (v) onSelect(v as EmMode); }}
      disabled={disabled}
      aria-label={ariaPrefix}
      className="w-fit justify-start gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
    >
      {EM_MODES.map(m => (
        <ToggleGroupItem
          key={m}
          value={m}
          aria-label={`${ariaPrefix} ${MODE_LABEL[m]}`}
          className={cn(
            'h-6 rounded-[5px] px-2.5 text-2xs font-medium border border-transparent text-muted-foreground hover:text-foreground transition-colors',
            MODE_META[m].activeClass,
          )}
        >
          {MODE_LABEL[m]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   TrainEmConfigRow — one table row per train: identity, Electromagnetic (EMF)
   mode, streams. "Electromagnetic (EMF) mode" replaces the old raw
   uses_em_meter / em_all_streams double-toggle with a single 3-way choice;
   "Streams" only becomes interactive (checkboxes with visible labels) in
   Mixed mode — in All Electromagnetic (EMF) / Turbine (Common) the per-stream
   flags are implied, so there is nothing to toggle that would silently be moot.
   ─────────────────────────────────────────────────────────────────────────── */

function TrainEmConfigRow({ trainLabel, cfg, plantCfg, onUpdate, canEdit }: {
  trainLabel: string;
  cfg: TrainEmCfg;
  plantCfg: import('@/pages/plants/shared').PlantMeterConfig;
  onUpdate: (p: EmConfigPatch) => void;
  canEdit: boolean;
}) {
  const rowId = useId();
  const mode = modeOf(cfg);

  // Only offer a stream to configure if that stream's physical meter exists at
  // all, plant-wide (ro_has_feed/permeate/reject_meter) — mirrors the
  // plant-wide presence toggles above.
  const streams = STREAM_FIELDS
    .filter(s => plantCfg[s.plantFlag])
    .map(s => ({ ...s, checked: cfg[s.field] }));

  return (
    <TableRow>
      <TableCell className="font-semibold text-foreground whitespace-nowrap align-top py-3">{trainLabel}</TableCell>
      <TableCell className="align-top py-3">
        <EmModeToggle
          mode={mode}
          onSelect={next => onUpdate(modeToPatch(next))}
          disabled={!canEdit}
          ariaPrefix={`${trainLabel} instrumentation`}
        />
      </TableCell>
      <TableCell className="align-top py-3">
        {mode === 'manual' && <span className="text-2xs text-muted-foreground">—</span>}
        {mode === 'all' && (
          <span className="text-2xs text-muted-foreground">{streams.map(s => s.label).join(' · ') || '—'}</span>
        )}
        {mode === 'mixed' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {streams.length === 0 && <span className="text-2xs text-muted-foreground">—</span>}
            {streams.map(s => {
              const id = `${rowId}-${s.field}`;
              return (
                <div key={s.field} className="flex items-center gap-1.5">
                  <Checkbox
                    id={id}
                    checked={s.checked ?? false}
                    onCheckedChange={v => onUpdate({ [s.field]: v === true } as EmConfigPatch)}
                    disabled={!canEdit}
                  />
                  <Label htmlFor={id} className="text-2xs font-normal text-muted-foreground cursor-pointer">{s.label}</Label>
                </div>
              );
            })}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
