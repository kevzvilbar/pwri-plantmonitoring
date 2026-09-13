import { useState, useId } from 'react';
import { MeterToggleTile } from '../MeterConfig';
import { RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { Gauge, Zap, Wrench } from 'lucide-react';
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
      {/* ══ Per-train meter presence ══ */}
      {plantId && (
        <TrainMeterPresenceSection plantId={plantId} canEdit={canEdit} />
      )}

      {/* ── Per-train Electromagnetic (EMF) meter configuration ── */}
      {plantId && (
        <TrainEmConfigSection plantId={plantId} canEdit={canEdit} />
      )}

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
   Per-train water meter presence configuration section
   ─────────────────────────────────────────────────────────────────────────── */

function TrainMeterPresenceSection({ plantId, canEdit }: {
  plantId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: trains = [], isLoading, error } = useROTrainsForPlant(plantId);
  const [bulkApplying, setBulkApplying] = useState<MeterPresenceMode | null>(null);

  if (isLoading) return <div className="pt-2 text-xs text-muted-foreground/60">Loading trains…</div>;
  if (error) return <div className="pt-2 text-xs text-warn">Could not load trains</div>;
  if (trains.length === 0) return null;

  const handleUpdate = async (trainId: string, trainLabel: string, patch: MeterPresencePatch) => {
    try {
      await updateTrainMeterPresence(trainId, patch);
      toast.success(`${trainLabel} meter presence updated`);
      await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    } catch (err: any) {
      toast.error('Failed to update meter presence', { description: err.message });
    }
  };

  const handleBulkApply = async (mode: MeterPresenceMode) => {
    if (!canEdit || bulkApplying) return;
    setBulkApplying(mode);
    const patch = meterPresenceModeToPatch(mode);
    const results = await Promise.allSettled(trains.map(t => updateTrainMeterPresence(t.id, patch)));
    const failed = results.filter(r => r.status === 'rejected').length;
    await queryClient.invalidateQueries({ queryKey: ['ro_trains', [plantId]] });
    setBulkApplying(null);
    if (failed === 0) {
      toast.success(`Set all ${trains.length} trains to ${METER_PRESENCE_MODE_LABEL[mode]}`);
    } else {
      toast.warning(`${trains.length - failed} of ${trains.length} trains updated`, {
        description: `${failed} train${failed === 1 ? '' : 's'} failed — check the individual rows below.`,
      });
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <RawWaterIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-train water meters</span>
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
              <MeterPresenceModeToggle
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
              <TableHead>Feed Meter</TableHead>
              <TableHead>Permeate Meter</TableHead>
              <TableHead>Reject Meter</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trains.map(t => {
              const trainLabel = t.name ?? `Train ${t.train_number}`;
              return (
                <TableRow key={t.id}>
                  <TableCell className="font-semibold text-foreground whitespace-nowrap align-top py-3">{trainLabel}</TableCell>
                  <MeterPresenceCell
                    checked={t.has_feed_meter}
                    onChange={v => handleUpdate(t.id, trainLabel, { has_feed_meter: v })}
                    canEdit={canEdit}
                    label="Feed"
                  />
                  <MeterPresenceCell
                    checked={t.has_permeate_meter}
                    onChange={v => handleUpdate(t.id, trainLabel, { has_permeate_meter: v })}
                    canEdit={canEdit}
                    label="Permeate"
                  />
                  <MeterPresenceCell
                    checked={t.has_reject_meter}
                    onChange={v => handleUpdate(t.id, trainLabel, { has_reject_meter: v })}
                    canEdit={canEdit}
                    label="Reject"
                  />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MeterPresenceCell({ checked, onChange, canEdit, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  canEdit: boolean;
  label: string;
}) {
  const rowId = useId();
  const id = `${rowId}-${label.toLowerCase()}`;
  return (
    <TableCell className="align-top py-3">
      <div className="flex items-center gap-1.5">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={v => onChange(v === true)}
          disabled={!canEdit}
        />
        <Label htmlFor={id} className="text-2xs font-normal text-muted-foreground cursor-pointer">{label}</Label>
      </div>
    </TableCell>
  );
}

type MeterPresencePatch = Partial<{
  has_feed_meter: boolean;
  has_permeate_meter: boolean;
  has_reject_meter: boolean;
}>;

type MeterPresenceMode = 'all' | 'feed_only' | 'feed_perm' | 'none';
const METER_PRESENCE_MODE_LABEL: Record<MeterPresenceMode, string> = {
  all: 'All Meters',
  feed_only: 'Feed Only',
  feed_perm: 'Feed + Permeate',
  none: 'No Meters',
};
const METER_PRESENCE_MODES: MeterPresenceMode[] = ['all', 'feed_perm', 'feed_only', 'none'];

const METER_PRESENCE_META: Record<MeterPresenceMode, { activeClass: string }> = {
  all: { activeClass: 'data-[state=on]:bg-info-soft data-[state=on]:text-info data-[state=on]:border-info/40' },
  feed_perm: { activeClass: 'data-[state=on]:bg-info-soft data-[state=on]:text-info data-[state=on]:border-info/40' },
  feed_only: { activeClass: 'data-[state=on]:bg-warn-soft data-[state=on]:text-warn data-[state=on]:border-warn/40' },
  none: { activeClass: 'data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:border-border' },
};

function meterPresenceModeToPatch(mode: MeterPresenceMode): MeterPresencePatch {
  switch (mode) {
    case 'all': return { has_feed_meter: true, has_permeate_meter: true, has_reject_meter: true };
    case 'feed_only': return { has_feed_meter: true, has_permeate_meter: false, has_reject_meter: false };
    case 'feed_perm': return { has_feed_meter: true, has_permeate_meter: true, has_reject_meter: false };
    case 'none': return { has_feed_meter: false, has_permeate_meter: false, has_reject_meter: false };
  }
}

function MeterPresenceModeToggle({ mode, onSelect, disabled, ariaPrefix }: {
  mode?: MeterPresenceMode;
  onSelect: (m: MeterPresenceMode) => void;
  disabled?: boolean;
  ariaPrefix: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={v => { if (v) onSelect(v as MeterPresenceMode); }}
      disabled={disabled}
      aria-label={ariaPrefix}
      className="w-fit justify-start gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
    >
      {METER_PRESENCE_MODES.map(m => (
        <ToggleGroupItem
          key={m}
          value={m}
          aria-label={`${ariaPrefix} ${METER_PRESENCE_MODE_LABEL[m]}`}
          className={cn(
            'h-6 rounded-[5px] px-2 text-2xs font-medium border border-transparent text-muted-foreground hover:text-foreground transition-colors',
            METER_PRESENCE_META[m].activeClass,
          )}
        >
          {METER_PRESENCE_MODE_LABEL[m]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function updateTrainMeterPresence(trainId: string, patch: MeterPresencePatch): Promise<{ success: boolean; error?: string }> {
  return (async () => {
    const { data, error } = await (supabase as any).rpc('fn_update_ro_train_meter_config', {
      p_train_id: trainId,
      p_has_feed_meter: patch.has_feed_meter ?? null,
      p_has_permeate_meter: patch.has_permeate_meter ?? null,
      p_has_reject_meter: patch.has_reject_meter ?? null,
    });
    if (error) throw new Error(error.message);
    const result = data as { success: boolean; error?: string };
    if (!result.success) throw new Error(result.error ?? 'Update rejected');
    return result;
  })();
}

/* ───────────────────────────────────────────────────────────────────────────
   Per-train Electromagnetic (EMF) meter configuration section
   ─────────────────────────────────────────────────────────────────────────── */

function TrainEmConfigSection({ plantId, canEdit }: {
  plantId: string;
  canEdit: boolean;
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
                  hasFeedMeter={t.has_feed_meter}
                  hasPermeateMeter={t.has_permeate_meter}
                  hasRejectMeter={t.has_reject_meter}
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
  { field: 'em_stream_feed' as const, label: 'Feed' },
  { field: 'em_stream_permeate' as const, label: 'Permeate' },
  { field: 'em_stream_reject' as const, label: 'Reject' },
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

function TrainEmConfigRow({ trainLabel, cfg, hasFeedMeter, hasPermeateMeter, hasRejectMeter, onUpdate, canEdit }: {
  trainLabel: string;
  cfg: TrainEmCfg;
  hasFeedMeter: boolean;
  hasPermeateMeter: boolean;
  hasRejectMeter: boolean;
  onUpdate: (p: EmConfigPatch) => void;
  canEdit: boolean;
}) {
  const rowId = useId();
  const mode = modeOf(cfg);

  const meterPresence = [hasFeedMeter, hasPermeateMeter, hasRejectMeter];
  const streams = STREAM_FIELDS
    .filter((_, i) => meterPresence[i])
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
