import { MeterToggleTile } from '../MeterConfig';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Droplet, Gauge, Zap } from 'lucide-react';
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

  const handleUpdate = async (trainId: string, trainLabel: string, patch: Record<string, boolean>) => {
    try {
      await updateTrainEmCfg(trainId, patch);
      toast.success(`${trainLabel} instrumentation updated`);
      // Invalidate trains query to refresh UI with fresh data
      await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    } catch (err: any) {
      toast.error('Failed to update EM config', { description: err.message });
    }
  };

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train meter instrumentation</span>
      </div>
      <p className="text-2xs text-muted-foreground mb-2.5">
        Each toggle saves immediately — no need to press "Save meter configuration" below for this section.
      </p>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-muted/40 border-b border-border">
          <span className="w-16 shrink-0 text-2xs font-medium uppercase tracking-wide text-muted-foreground">Train</span>
          <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Instrumentation</span>
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
   TrainEmConfigRow — one train's instrumentation, one line in the common case
   ─────────────────────────────────────────────────────────────────────────── */

type EmMode = 'manual' | 'all' | 'mixed';
const MODE_LABEL: Record<EmMode, string> = { manual: 'Manual', all: 'All EM', mixed: 'Mixed' };

const STREAM_FIELDS = [
  { key: 'feed', field: 'em_stream_feed' as const, label: 'Feed', plantFlag: 'ro_has_feed_meter' as const },
  { key: 'permeate', field: 'em_stream_permeate' as const, label: 'Product', plantFlag: 'ro_has_permeate_meter' as const },
  { key: 'reject', field: 'em_stream_reject' as const, label: 'Reject', plantFlag: 'ro_has_reject_meter' as const },
];

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

  const selectMode = (next: EmMode) => {
    if (next === 'manual') onUpdate({ uses_em_meter: false, em_all_streams: false });
    else if (next === 'all') onUpdate({ uses_em_meter: true, em_all_streams: true });
    else onUpdate({ uses_em_meter: true, em_all_streams: false });
  };

  const streams = STREAM_FIELDS.filter(s => plantCfg[s.plantFlag]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <span className="w-16 shrink-0 text-sm font-medium">{trainLabel}</span>

      <div className="inline-flex items-center gap-0.5 bg-muted p-0.5 rounded-lg shrink-0">
        {(['manual', 'all', 'mixed'] as const).map(opt => {
          const active = mode === opt;
          return (
            <button
              key={opt}
              type="button"
              disabled={!canEdit}
              onClick={() => selectMode(opt)}
              aria-pressed={active}
              className={cn(
                'px-2.5 py-1 rounded-md text-2xs font-medium transition-all duration-150',
                active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                !canEdit ? 'cursor-default opacity-70' : 'cursor-pointer',
              )}
            >
              {MODE_LABEL[opt]}
            </button>
          );
        })}
      </div>

      {mode === 'mixed' && streams.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {streams.map(s => (
            <label key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Switch
                checked={cfg[s.field] ?? false}
                onCheckedChange={canEdit ? (v: boolean) => onUpdate({ [s.field]: v }) : undefined}
                disabled={!canEdit}
                className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3 data-[state=checked]:bg-info"
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
