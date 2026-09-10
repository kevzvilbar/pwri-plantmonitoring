import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PretreatAFMChart } from '@/pages/plants/trains/PretreatAFMChart';
import { PretreatBoosterChart } from '@/pages/plants/trains/PretreatBoosterChart';
import { PretreatCFChart } from '@/pages/plants/trains/PretreatCFChart';
import { PretreatHPPChart } from '@/pages/plants/trains/PretreatHPPChart';
import { TrainRODetailCharts } from '@/pages/plants/trains/TrainRODetailCharts';
import { MeterDetailButton } from '@/pages/plants/charts/EntityHistoryChart';
import { ReplaceTrainMeterDialog } from '@/pages/ro-trains/ReplaceTrainMeterDialog';
import {
  ROTrainIcon, ChangeMeterIcon, MeterOdometerIcon, PressureGaugeIcon,
  HighPressurePumpIcon, BoosterPumpIcon, MediaFilterIcon, CartridgeFilterIcon, MembranePerformanceIcon,
} from '@/components/icons/water-icons';
import { X, Pencil, Trash2, Calendar, TrendingUp, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrainCardProps {
  t: any;
  plant: any;
  deriveTrainStatus: (t: any) => 'Running' | 'Maintenance' | 'Offline';
  toggleTrainStatus: (t: any) => void;
  toggleSection: (trainId: string, section: string) => void;
  activeSection: Record<string, string | null>;
  latestTrainReplacement: Record<string, any>;
  isManager: boolean;
  effectiveMediaType: (t: any) => string;
  effectiveFilterType: (t: any) => string;
  onLog: (train: { id: string; label: string }) => void;
  onEdit: (train: any) => void;
  onDelete: (train: any) => void;
  onReplaceMeter: (trainId: string) => void;
}

export function TrainCard({
  t, plant, deriveTrainStatus, toggleTrainStatus, toggleSection, activeSection,
  latestTrainReplacement, isManager, effectiveMediaType, effectiveFilterType,
  onLog, onEdit, onDelete, onReplaceMeter,
}: TrainCardProps) {
  const mt = effectiveMediaType(t);
  const ft = effectiveFilterType(t);
  const effectiveStatus = deriveTrainStatus(t);
  const activeKey = activeSection[t.id] ?? null;
  const trainLabel = `Train ${t.train_number}${t.name ? ` · ${t.name}` : ''}`;
  const numAfm   = t.num_afm            ?? 0;
  const numBp    = t.num_booster_pumps  ?? 0;
  const numHpp   = t.num_hp_pumps       ?? 0;
  const numCf    = t.num_cartridge_filters ?? 0;
  const numCtrl  = t.num_controllers    ?? 0;

  const CompBtn = ({
    trainId: tid, activeKey, sectionKey, icon, label, count,
  }: {
    trainId: string; activeKey: string | null;
    sectionKey: string; icon: ReactNode; label: string; count?: number;
  }) => {
    const isActive = activeKey === sectionKey;
    return (
      <button onClick={() => toggleSection(tid, sectionKey)}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shadow-2xs',
          isActive ? 'bg-primary text-primary-foreground border-primary shadow-xs'
            : 'bg-card/90 border-border/70 text-muted-foreground hover:border-primary/60 hover:text-foreground hover:bg-muted/60',
        ].join(' ')}>
        <span className={isActive ? 'text-primary-foreground' : 'text-primary'}>{icon}</span>
        <span>{label}</span>
        {count !== undefined && (
          <span className={`px-1.5 py-0.5 rounded-full text-3xs font-bold ${
            isActive ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground border border-border/60'
          }`}>{count}</span>
        )}
        <TrendingUp className={`h-3 w-3 ml-0.5 transition-transform ${isActive ? 'rotate-90 text-primary-foreground' : 'opacity-40'}`} />
      </button>
    );
  };

  return (
    <Card className="overflow-hidden border border-border rounded-lg shadow-xs transition-all hover:border-primary/40" data-testid={`train-card-${t.id}`}>
      <div className="p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-card border-b border-border/60">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <ROTrainIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight flex items-center gap-2">
              <span>{trainLabel}</span>
            </h3>
            <span className="inline-flex items-center text-3xs font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary border border-primary/30">{mt} Media</span>
            <span className="inline-flex items-center text-3xs font-medium px-2 py-0.5 rounded-full bg-info-soft text-info border border-info/30">{ft}</span>
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono">
            <span>{numAfm} AFM</span><span>·</span><span>{numBp} Booster</span>
            <span>·</span><span>{numCf} {ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'}</span>
            <span>·</span><span>{numHpp} HPP</span>
            {numCtrl > 0 && <><span>·</span><span>{numCtrl} Ctrl</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <button type="button" onClick={() => toggleTrainStatus(t)}
            title={isManager ? `Click to cycle status (currently ${effectiveStatus})` : effectiveStatus}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${
              effectiveStatus === 'Running' ? 'text-accent bg-accent-soft border-accent/40 hover:bg-accent-soft/80'
              : effectiveStatus === 'Maintenance' ? 'text-warn bg-warn-soft border-warn/40 hover:bg-warn-soft/80'
              : 'text-rose-400 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
            } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              effectiveStatus === 'Running' ? 'bg-accent'
              : effectiveStatus === 'Maintenance' ? 'bg-warn' : 'bg-rose-500'
            }`} /><span>{effectiveStatus}</span>
          </button>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs font-medium gap-1 rounded-lg"
              onClick={() => onLog({ id: t.id, label: trainLabel })} title="View Operator Shift Logs">
              <Calendar className="h-3.5 w-3.5 text-primary" /><span>Logs</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs font-medium gap-1 rounded-lg"
              onClick={() => onEdit(t)} data-testid={`edit-train-${t.id}`}>
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" /><span>Edit</span>
            </Button>
            {isManager && (
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                title="Delete train" onClick={() => onDelete(t)}
                data-testid={`delete-train-${t.id}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-3.5 bg-muted/20 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-border/70 bg-card/80 space-y-2">
            <div className="flex items-center justify-between gap-1 pb-1 border-b border-border/40">
              <div className="flex items-center gap-1.5">
                <span className="text-3xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent-soft text-accent border border-accent/40">Pre-treatment</span>
                <span className="text-3xs text-muted-foreground font-mono">Stage 1</span>
              </div>
              <span className="text-2xs text-muted-foreground font-medium">Filtration &amp; Boost</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {numAfm > 0 && (
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="afm"
                  icon={<MediaFilterIcon className="h-3.5 w-3.5 text-accent" />} label={mt} count={numAfm} />
              )}
              {numBp > 0 && (
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="booster"
                  icon={<BoosterPumpIcon className="h-3.5 w-3.5 text-accent" />} label="Booster Pump" count={numBp} />
              )}
              {numCf > 0 && (
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="cf"
                  icon={<CartridgeFilterIcon className="h-3.5 w-3.5 text-accent" />}
                  label={ft === 'Bag Filter' ? 'Filter Housing' : 'CF Housing'} count={numCf} />
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-border/70 bg-card/80 space-y-2">
            <div className="flex items-center justify-between gap-1 pb-1 border-b border-border/40">
              <div className="flex items-center gap-1.5">
                <span className="text-3xs font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-info-soft text-info border border-info/40">RO Stage</span>
                <span className="text-3xs text-muted-foreground font-mono">Stage 2</span>
              </div>
              <span className="text-2xs text-muted-foreground font-medium">High Pressure &amp; Permeate</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {numHpp > 0 && (
                <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="hpp"
                  icon={<HighPressurePumpIcon className="h-3.5 w-3.5 text-info" />} label="High Pressure Pump" count={numHpp} />
              )}
              <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="ro"
                icon={<MembranePerformanceIcon className="h-3.5 w-3.5 text-info" />} label="RO Performance" />
              <CompBtn trainId={t.id} activeKey={activeKey} sectionKey="meters"
                icon={<MeterOdometerIcon className="h-3.5 w-3.5 text-info" />} label="Meters" />
            </div>
          </div>
        </div>

        {activeKey === 'afm' && (
          <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                <MediaFilterIcon className="h-4 w-4" /> {mt} Media Filtration Telemetry
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'afm')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <PretreatAFMChart trainId={t.id} mediaType={mt} />
          </div>
        )}
        {activeKey === 'booster' && (
          <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                <BoosterPumpIcon className="h-4 w-4" /> Booster Pump Pressure &amp; Flow
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'booster')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <PretreatBoosterChart trainId={t.id} />
          </div>
        )}
        {activeKey === 'cf' && (
          <div className="p-3.5 rounded-xl border border-accent/40 bg-card animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                <CartridgeFilterIcon className="h-4 w-4" /> {ft} Differential Pressure &amp; Replacement History
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'cf')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <PretreatCFChart trainId={t.id} filterType={ft} />
          </div>
        )}
        {activeKey === 'hpp' && (
          <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-info flex items-center gap-1.5">
                <HighPressurePumpIcon className="h-4 w-4" /> High Pressure Pump Performance &amp; Current Draw
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'hpp')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <PretreatHPPChart trainId={t.id} />
          </div>
        )}
        {activeKey === 'ro' && (
          <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-info flex items-center gap-1.5">
                <MembranePerformanceIcon className="h-4 w-4" /> Reverse Osmosis Recovery &amp; Salt Rejection
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'ro')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <TrainRODetailCharts trainId={t.id} trainLabel={trainLabel} />
          </div>
        )}
        {activeKey === 'meters' && (
          <div className="p-3.5 rounded-xl border border-info/40 bg-card animate-fade-in shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-info flex items-center gap-1.5">
                <MeterOdometerIcon className="h-4 w-4" /> Train Meters &amp; Calibration Identity
              </span>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" onClick={() => toggleSection(t.id, 'meters')}><X className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(['feed', 'permeate', 'reject'] as const).map((mt) => {
                const latest = latestTrainReplacement[`${t.id}:${mt}`];
                const replacerName = latest?.replacer
                  ? [latest.replacer.first_name, latest.replacer.last_name].filter(Boolean).join(' ') : null;
                return (
                  <MeterDetailButton key={mt} label={`${mt[0].toUpperCase()}${mt.slice(1)} Meter`}
                    icon={<Gauge className="h-4 w-4 text-info" />}
                    fields={[
                      { label: 'Brand', value: t[`${mt}_meter_brand`] },
                      { label: 'Size', value: t[`${mt}_meter_size`] ? `${t[`${mt}_meter_size`]} in` : null },
                      { label: 'Serial No.', value: t[`${mt}_meter_serial`] },
                      { label: 'Installed', value: t[`${mt}_meter_installed_date`] },
                      { label: 'Last Replaced By', value: replacerName },
                      { label: 'Replacement Date', value: latest?.replacement_date },
                    ]}
                  />
                );
              })}
            </div>
            {isManager && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={() => onReplaceMeter(t.id)}>
                <ChangeMeterIcon className="h-3.5 w-3.5" /> Replace Meter / Calibrate
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
