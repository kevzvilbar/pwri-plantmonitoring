import { MeterToggleTile } from '../MeterConfig';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Droplet, Gauge, Zap } from 'lucide-react';
import { useROTrainsForPlant, type ROTrain } from '@/hooks/useROTrains';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useId, isValidElement, cloneElement, type ReactElement } from 'react';
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

  const modeOf = (cfg: ReturnType<typeof getTrainEmConfig>) =>
    cfg.uses_em_meter === null ? 'unset' :
    cfg.em_all_streams === true ? 'all' :
    cfg.em_all_streams === false ?
      (cfg.em_stream_feed === true || cfg.em_stream_permeate === true || cfg.em_stream_reject === true ? 'mixed' : 'off') :
      'mixed';

  const handleUpdate = async (trainId: string, patch: Record<string, boolean>) => {
    try {
      await updateTrainEmCfg(trainId, patch);
      toast.success('EM config updated');
      // Invalidate trains query to refresh UI with fresh data
      await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    } catch (err: any) {
      toast.error('Failed to update EM config', { description: err.message });
    }
  };

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train EM meter configuration</span>
      </div>
      <div className="space-y-2">
        {trains.map(t => {
          const trainCfg = getTrainEmConfig(t);
          return (
            <TrainEmConfigCard
              key={t.id}
              trainLabel={t.name ?? `Train ${t.train_number}`}
              cfg={trainCfg}
              plantCfg={plantCfg}
              onUpdate={patch => handleUpdate(t.id, patch)}
              canEdit={canEdit}
              mode={modeOf(trainCfg)}
            />
          );
        })}
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
   TrainEmConfigCard — per-train EM toggle card
   ─────────────────────────────────────────────────────────────────────────── */

const EM_MODE_LABEL: Record<string, string> = {
  all: 'All EM',
  mixed: 'Mixed',
  off: 'Manual',
  unset: 'Unset',
};

function TrainEmConfigCard({ trainLabel, cfg, plantCfg, onUpdate, canEdit, mode }: {
  trainLabel: string;
  cfg: { uses_em_meter: boolean | null; em_all_streams: boolean | null; em_stream_feed: boolean | null; em_stream_permeate: boolean | null; em_stream_reject: boolean | null };
  plantCfg: import('@/pages/plants/shared').PlantMeterConfig;
  onUpdate: (p: EmConfigPatch) => void;
  canEdit: boolean;
  mode: string;
}) {
  const usesEm = cfg.uses_em_meter ?? false;
  const allStreams = cfg.em_all_streams ?? false;
  // Per-stream toggles are inert while "All streams EM" is on (trainUsesEmForStream
  // short-circuits to true for every stream), so disable them rather than let an
  // operator toggle a control that silently does nothing.
  const streamDisabled = !canEdit || !usesEm || allStreams;

  return (
    <div className="rounded-lg border border-border-2 bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-foreground">{trainLabel}</span>
        <span
          className={cn(
            'text-2xs font-medium px-1.5 py-0.5 rounded-full border shrink-0',
            mode === 'all' && 'border-info/40 bg-info-soft text-info',
            mode === 'mixed' && 'border-warn/40 bg-warn-soft text-warn',
            (mode === 'off' || mode === 'unset') && 'border-border-2 bg-muted-foreground/10 text-muted-foreground',
          )}
        >
          {EM_MODE_LABEL[mode] ?? mode}
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <TooltipLabel label="Uses EM meter">
          <ToggleChip checked={usesEm} onToggle={v => {
            if (v) {
              onUpdate({ uses_em_meter: true, em_all_streams: true });
            } else {
              onUpdate({ uses_em_meter: false, em_all_streams: false });
            }
          }} disabled={!canEdit}/>
        </TooltipLabel>
        <TooltipLabel label="All streams EM">
          <ToggleChip checked={allStreams} onToggle={v => onUpdate({ em_all_streams: v })} disabled={!canEdit || !usesEm}/>
        </TooltipLabel>
        {/* Per-stream toggles only make sense for a stream that has a physical meter
            at all — hide the ones the plant-wide Feed/Permeate/Reject presence
            toggles have already turned off. */}
        {plantCfg.ro_has_feed_meter && (
          <TooltipLabel label="Feed EM">
            <ToggleChip checked={cfg.em_stream_feed ?? false} onToggle={v => onUpdate({ em_stream_feed: v })} disabled={streamDisabled}/>
          </TooltipLabel>
        )}
        {plantCfg.ro_has_permeate_meter && (
          <TooltipLabel label="Permeate EM">
            <ToggleChip checked={cfg.em_stream_permeate ?? false} onToggle={v => onUpdate({ em_stream_permeate: v })} disabled={streamDisabled}/>
          </TooltipLabel>
        )}
        {plantCfg.ro_has_reject_meter && (
          <TooltipLabel label="Reject EM">
            <ToggleChip checked={cfg.em_stream_reject ?? false} onToggle={v => onUpdate({ em_stream_reject: v })} disabled={streamDisabled}/>
          </TooltipLabel>
        )}
      </div>
    </div>
  );
}

function ToggleChip({ checked, onToggle, disabled, id, ariaLabel }: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      disabled={disabled}
      onClick={() => onToggle(!checked)}
      aria-label={ariaLabel}
      aria-pressed={checked}
      className={cn(
        'relative flex h-7 px-3 shrink-0 select-none items-center rounded-full border text-xs font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn/50',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        checked
          ? 'border-info bg-info-soft/70 text-info shadow-sm'
          : 'border-border-2 bg-muted-foreground/5 text-muted-foreground',
        disabled && !checked ? 'border-muted-foreground/20' : ''
      )}
    >
      <span className="sr-only">{checked ? 'Disable' : 'Enable'}</span>
      {checked && <span className="absolute left-1.5 inline-block h-1.5 w-1.5 rounded-full bg-info/80" />}
      <span className="pl-4 pr-1.5">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

function TooltipLabel({ label, children }: { label: string; children: ReactElement<{ id?: string; ariaLabel?: string }> }) {
  const id = useId();
  return (
    <div className="min-w-0 flex flex-col items-start gap-1">
      <label htmlFor={id} className="text-2xs font-medium text-muted-foreground leading-none whitespace-nowrap">{label}</label>
      {isValidElement(children) ? cloneElement(children, { id, ariaLabel: label }) : children}
    </div>
  );
}
