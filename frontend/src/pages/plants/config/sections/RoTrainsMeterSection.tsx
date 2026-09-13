import { useState } from 'react';
import { MeterToggleTile } from '../MeterConfig';
import { ROTrainIcon, RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { Gauge, Zap } from 'lucide-react';
import { useROTrainsForPlant, type ROTrain } from '@/hooks/useROTrains';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
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
      <div className="pt-4">
        <div className="flex items-center gap-2 mb-3">
          <ROTrainIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">RO Trains — Flow meters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        {/* ── Per-train EM meter configuration ── */}
        {plantId && (
          <TrainEmConfigSection plantId={plantId} canEdit={canEdit} cfg={cfg} />
        )}
      </div>

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
    </>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   Per-train EM meter configuration section
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

  const getTrainEmConfig = (t: ROTrain) => ({
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
      toast.error('Failed to update EM config', { description: err.message });
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
    <div className="pt-4">
      <div className="flex items-center gap-2 mb-2">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train meter instrumentation</span>
        <span className="text-xs font-medium text-primary bg-primary-soft rounded-full px-2 py-0.5">Saves instantly</span>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {trains.length} train{trains.length === 1 ? '' : 's'}
          </span>
          {canEdit && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Set all to</span>
              <ModeButtonGroup
                mode={bulkApplying ?? undefined}
                onSelect={handleBulkApply}
                disabled={!!bulkApplying}
                ariaPrefix="Set all trains to"
              />
            </div>
          )}
        </div>
        <div className="divide-y divide-border">
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
        </div>
      </div>
    </div>
  );
}

// Type for EM config patches — known columns on ro_trains
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
const MODE_LABEL: Record<EmMode, string> = { manual: 'Manual', all: 'All EM', mixed: 'Mixed' };
const MODE_ORDER: EmMode[] = ['manual', 'all', 'mixed'];

const STREAM_FIELDS = [
  { key: 'feed', field: 'em_stream_feed' as const, label: 'Feed', plantFlag: 'ro_has_feed_meter' as const },
  { key: 'permeate', field: 'em_stream_permeate' as const, label: 'Product', plantFlag: 'ro_has_permeate_meter' as const },
  { key: 'reject', field: 'em_stream_reject' as const, label: 'Reject', plantFlag: 'ro_has_reject_meter' as const },
];

function modeToPatch(mode: EmMode): EmConfigPatch {
  if (mode === 'manual') return { uses_em_meter: false, em_all_streams: false };
  if (mode === 'all') return { uses_em_meter: true, em_all_streams: true };
  return { uses_em_meter: true, em_all_streams: false };
}

function ModeButtonGroup({ mode, onSelect, disabled, ariaPrefix }: {
  mode?: EmMode;
  onSelect: (m: EmMode) => void;
  disabled?: boolean;
  ariaPrefix: string;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 bg-muted p-0.5 rounded-lg shrink-0">
      {MODE_ORDER.map(opt => {
        const active = mode === opt;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt)}
            aria-pressed={active}
            aria-label={`${ariaPrefix} ${MODE_LABEL[opt]}`}
            className={cn(
              // text-xs + py-1.5 (was text-2xs + py-1): the 10px label and
              // ~24px-tall hit target were hard to read/tap at a glance across
              // 7 rows; this stays compact but crosses a legible/tappable floor.
              'px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
              active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              disabled ? 'cursor-default opacity-70' : 'cursor-pointer',
            )}
          >
            {MODE_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   TrainEmConfigRow — one train's instrumentation, one line in the common case
   ─────────────────────────────────────────────────────────────────────────── */

function TrainEmConfigRow({ trainLabel, cfg, plantCfg, onUpdate, canEdit }: {
  trainLabel: string;
  cfg: { uses_em_meter: boolean | null; em_all_streams: boolean | null; em_stream_feed: boolean | null; em_stream_permeate: boolean | null; em_stream_reject: boolean | null };
  plantCfg: import('@/pages/plants/shared').PlantMeterConfig;
  onUpdate: (p: EmConfigPatch) => void;
  canEdit: boolean;
}) {
  const usesEm = cfg.uses_em_meter ?? false;
  const allStreams = cfg.em_all_streams ?? false;
  const mode: EmMode = !usesEm ? 'manual' : allStreams ? 'all' : 'mixed';
  const notYetConfigured = cfg.uses_em_meter === null;

  const streams = STREAM_FIELDS.filter(s => plantCfg[s.plantFlag]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <span className="w-16 shrink-0 text-sm font-medium">{trainLabel}</span>

      <ModeButtonGroup
        mode={mode}
        onSelect={next => onUpdate(modeToPatch(next))}
        disabled={!canEdit}
        ariaPrefix={`${trainLabel} instrumentation:`}
      />

      {mode === 'mixed' && streams.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {streams.map(s => (
            <label key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer py-1">
              <Switch
                checked={cfg[s.field] ?? false}
                onCheckedChange={canEdit ? (v: boolean) => onUpdate({ [s.field]: v }) : undefined}
                disabled={!canEdit}
                className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-4 data-[state=checked]:bg-info"
              />
              {s.label}
            </label>
          ))}
        </div>
      )}

      {mode === 'manual' && notYetConfigured && (
        <span className="text-2xs text-muted-foreground italic">Not yet set — treated as manual for now</span>
      )}
    </div>
  );
}
