import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, MapPin, Pencil, Trash2, Droplets, Zap, Building2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { Button } from '@/components/ui/button';
import { Lamp } from '@/components/ui/Lamp';
import { fmtNum } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { loadThresholds } from '@/pages/Compliance';

interface PlantHeroBannerProps {
  plant: any;
  trainCounts?: { active: number; total: number };
  isManager?: boolean;
  onEdit: () => void;
  onBack: () => void;
  deleteButton?: React.ReactNode;
}

export function PlantHeroBanner({
  plant,
  trainCounts,
  isManager,
  onEdit,
  onBack,
  deleteButton,
}: PlantHeroBannerProps) {
  const [timeStr, setTimeStr] = useState('');

  const { data: thresholds } = useQuery({
    queryKey: ['thresholds', plant?.id || 'global'],
    queryFn: () => loadThresholds(plant?.id || 'global'),
    enabled: !!plant?.id,
    staleTime: 60_000,
  });

  // Live PHT Clock ticking every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(format(now, 'hh:mm:ss a') + ' PHT');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isOnline = plant.status === 'Active';
  const capM3 = plant.design_capacity_m3 ? plant.design_capacity_m3 * 1000 : null;
  const trainOnlinePct = trainCounts && trainCounts.total > 0
    ? Math.round((trainCounts.active / trainCounts.total) * 100)
    : null;

  return (
    <div className="space-y-3">
      {/* ── Breadcrumb & Top Command Bar ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors group"
        >
          <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>All Facilities</span>
          <span className="text-border">/</span>
          <span className="text-foreground">{plant.name}</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-muted-foreground hidden sm:inline">
            ID: {plant.id.slice(0, 8)}
          </span>
          {isManager && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                data-testid="edit-plant-info-btn"
                className="h-7 px-2.5 gap-1.5 text-xs font-medium bg-card shadow-2xs"
              >
                <Pencil className="h-3 w-3 text-primary" />
                <span>Edit Facility</span>
              </Button>
              {deleteButton}
            </div>
          )}
        </div>
      </div>

      {/* ── Double-Bezel Facility Cockpit Hero ── */}
      <div className="rounded-[1.75rem] bg-white/[0.03] ring-1 ring-white/10 p-1 sm:p-1.5 shadow-[var(--shadow-elev)]">
        <div className="rounded-[calc(1.75rem-0.375rem)] bg-gradient-stat text-white p-4 sm:p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] relative overflow-hidden space-y-4">
          
          {/* Top Row: Facility Tag + Name + Status Badge + Live Clock */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/15">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-primary to-highlight text-white shadow-xs shrink-0">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-3xs font-mono font-bold px-2 py-0.5 rounded bg-primary/20 text-teal-300 border border-primary/40 uppercase tracking-wider">
                  FACILITY COCKPIT
                </span>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  {plant.name}
                </h1>
                <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-0.5 rounded-full border ${
                  isOnline
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                }`}>
                  <Lamp tone={isOnline ? 'good' : 'warn'} pulse={isOnline} size={6} />
                  <span>{plant.status}</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono text-2xs text-slate-300 self-start sm:self-auto">
              <Lamp tone="live" pulse size={6} />
              <span className="text-cyan-300 font-semibold">Live Telemetry</span>
              <span className="text-white/30">&bull;</span>
              <span className="tabular-nums">{timeStr || '—'}</span>
            </div>
          </div>

          {/* Main Hero Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            
            {/* Left: Design Extraction Capacity */}
            <div className="md:col-span-5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
                <Droplets className="h-3 w-3 text-cyan-400" />
                <span>Peak Extraction Capacity</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="readout-num readout-glow text-3xl sm:text-4xl font-bold font-mono-num text-white leading-none">
                  {plant.design_capacity_m3 ? fmtNum(plant.design_capacity_m3) : '—'}
                </span>
                {plant.design_capacity_m3 && (
                  <span className="text-sm font-sans font-medium text-slate-300">
                    MLD <span className="text-2xs opacity-80 font-mono">({fmtNum(plant.design_capacity_m3 * 1000)} m³/d)</span>
                  </span>
                )}
              </div>
              <p className="text-2xs text-slate-300 flex items-center gap-1.5 pt-0.5">
                <MapPin className="h-3.5 w-3.5 text-teal-400 shrink-0" />
                <span className="truncate">{plant.address || 'Address unassigned'}</span>
              </p>
            </div>

            {/* Middle: RO Trains Fleet Operational Ratio */}
            <div className="md:col-span-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-3xs uppercase tracking-wider font-semibold text-teal-200/90">
                <ROTrainIcon className="h-3 w-3 text-teal-400" />
                <span>RO Trains Operational</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="readout-num text-3xl sm:text-4xl font-bold font-mono-num text-white leading-none">
                  {trainCounts ? `${trainCounts.active}` : (plant.num_ro_trains ?? '—')}
                </span>
                {trainCounts && (
                  <span className="text-sm font-mono text-slate-300">
                    / {trainCounts.total} units
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-3xs text-slate-300 font-mono">
                <Lamp
                  tone={trainOnlinePct === 100 ? 'good' : (trainOnlinePct ?? 0) > 0 ? 'warn' : 'danger'}
                  pulse={trainOnlinePct === 100}
                  size={6}
                />
                <span>
                  {trainCounts && trainCounts.total > 0
                    ? `${trainOnlinePct}% fleet online`
                    : 'Train telemetry online'}
                </span>
              </div>
            </div>

            {/* Right: Quick Spec Tag */}
            <div className="md:col-span-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
              <div className="text-3xs uppercase tracking-wider font-semibold text-teal-200/80">
                System Benchmark
              </div>
              <div className="text-xs font-mono font-medium text-white flex items-center justify-between">
                <span>Target Recovery:</span>
                <span className="text-teal-300 font-bold">{thresholds?.recovery_pct_min != null ? `${thresholds.recovery_pct_min}% – 75%` : '65% – 75%'}</span>
              </div>
              <div className="text-xs font-mono font-medium text-white flex items-center justify-between">
                <span>Permeate TDS:</span>
                <span className="text-teal-300 font-bold">&le; {thresholds?.permeate_tds_max ?? 500} ppm</span>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

