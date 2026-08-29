import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// ─── Per-vessel flow row ──────────────────────────────────────────────────────
export type VesselFlowMethod = 'meter' | 'manual';
export type VesselFlowRow = {
  id: number;
  method: VesselFlowMethod;
  // meter delta
  prevMeter: string; currMeter: string;
  prevTime: string;  currTime: string;
  // manual bucket
  bucketVol: string;   // L
  fillTimeSec: string; // seconds
};

export function VesselFlowCard({ row, onChange }: { row: VesselFlowRow; onChange: (patch: Partial<VesselFlowRow>) => void }) {
  // ── Meter method calcs ────────────────────────────────────────────────────
  const deltaV_m3 = (row.currMeter !== '' && row.prevMeter !== '')
    ? +((+row.currMeter) - (+row.prevMeter)).toFixed(4) : null;
  const deltaT_hr = useMemo(() => {
    if (!row.prevTime || !row.currTime) return null;
    const diff = (new Date(row.currTime).getTime() - new Date(row.prevTime).getTime()) / 3600000;
    return diff > 0 ? +diff.toFixed(4) : null;
  }, [row.prevTime, row.currTime]);
  const qMeter = (deltaV_m3 !== null && deltaT_hr !== null && deltaT_hr > 0)
    ? +((deltaV_m3) / deltaT_hr).toFixed(4) : null;

  // ── Manual bucket calcs ───────────────────────────────────────────────────
  // Q (L/min) = bucketVol(L) / fillTime(s) × 60
  // Q (m³/hr) = Q(L/min) / 1000 × 60
  const bVol = +row.bucketVol || 0;
  const bSec = +row.fillTimeSec || 0;
  const qLperMin  = (bVol > 0 && bSec > 0) ? +((bVol / bSec) * 60).toFixed(3) : null;
  const qManual   = qLperMin !== null ? +((qLperMin / 1000) * 60).toFixed(4) : null;

  const Q = row.method === 'meter' ? qMeter : qManual;
  const hasResult = Q !== null;

  return (
    <div className={cn(
      'rounded-xl border-2 p-3 space-y-2.5 transition-colors',
      hasResult ? 'border-accent bg-accent-soft/30' : 'border-border bg-muted/10'
    )}>
      {/* Vessel label + method toggle */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">Vessel {row.id}</span>
        <div className="flex rounded-full border border-border overflow-hidden text-2xs font-semibold">
          <button type="button" onClick={() => onChange({ method: 'meter' })}
            className={cn('px-2.5 py-0.5 transition-colors',
              row.method === 'meter' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
            📟 Meter
          </button>
          <button type="button" onClick={() => onChange({ method: 'manual' })}
            className={cn('px-2.5 py-0.5 transition-colors',
              row.method === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
            🪣 Bucket
          </button>
        </div>
      </div>

      {/* ── Method A: Water Meter Delta ─────────────────────────────── */}
      {row.method === 'meter' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label htmlFor="vesselflowcard-prev-meter-m" className="text-2xs text-muted-foreground">Prev meter (m³)</Label>
              <Input type="number" step="any" value={row.prevMeter}
                onChange={e => onChange({ prevMeter: e.target.value })}
                placeholder="e.g. 102.40" className="h-8 text-xs" id="vesselflowcard-prev-meter-m"/>
            </div>
            <div>
              <Label htmlFor="vesselflowcard-curr-meter-m" className="text-2xs text-muted-foreground">Curr meter (m³)</Label>
              <Input type="number" step="any" value={row.currMeter}
                onChange={e => onChange({ currMeter: e.target.value })}
                placeholder="e.g. 108.75" className="h-8 text-xs" id="vesselflowcard-curr-meter-m"/>
            </div>
            <div>
              <Label htmlFor="vesselflowcard-prev-date-time" className="text-2xs text-muted-foreground">Prev date & time</Label>
              <Input type="datetime-local" value={row.prevTime}
                onChange={e => onChange({ prevTime: e.target.value })}
                className="h-8 text-2xs" id="vesselflowcard-prev-date-time"/>
            </div>
            <div>
              <Label htmlFor="vesselflowcard-curr-date-time" className="text-2xs text-muted-foreground">Curr date & time</Label>
              <Input type="datetime-local" value={row.currTime}
                onChange={e => onChange({ currTime: e.target.value })}
                className="h-8 text-2xs" id="vesselflowcard-curr-date-time"/>
            </div>
          </div>
          {/* ΔV + Δt inline chips */}
          <div className="flex gap-1.5 flex-wrap">
            <span className={cn('text-2xs px-2 py-0.5 rounded-full border font-mono-num',
              deltaV_m3 !== null ? 'border-accent bg-accent-soft text-accent'
                                 : 'border-border bg-muted/30 text-muted-foreground')}>
              ΔV = {deltaV_m3 !== null ? `${deltaV_m3} m³` : '—'}
            </span>
            <span className={cn('text-2xs px-2 py-0.5 rounded-full border font-mono-num',
              deltaT_hr !== null ? 'border-info bg-info-soft text-info'
                                 : 'border-border bg-muted/30 text-muted-foreground')}>
              Δt = {deltaT_hr !== null ? `${deltaT_hr} hr` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* ── Method B: Manual Bucket Test ────────────────────────────── */}
      {row.method === 'manual' && (
        <div className="space-y-2">
          <div className="rounded-md bg-muted/40 border border-border px-2.5 py-1.5 text-2xs text-muted-foreground leading-relaxed">
            Fill a container to a known volume (e.g. 20 L), measure the time in seconds.
            <span className="font-mono ml-1 text-foreground">Q = V ÷ t × 60 (L/min)</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <Label htmlFor="vesselflowcard-container-volume-l" className="text-2xs text-muted-foreground">Container volume (L)</Label>
              <Input type="number" step="any" value={row.bucketVol}
                onChange={e => onChange({ bucketVol: e.target.value })}
                placeholder="20" className="h-8 text-xs" id="vesselflowcard-container-volume-l"/>
            </div>
            <div>
              <Label htmlFor="vesselflowcard-fill-time-seconds" className="text-2xs text-muted-foreground">Fill time (seconds)</Label>
              <Input type="number" step="any" value={row.fillTimeSec}
                onChange={e => onChange({ fillTimeSec: e.target.value })}
                placeholder="e.g. 45" className="h-8 text-xs" id="vesselflowcard-fill-time-seconds"/>
            </div>
          </div>
          {/* Intermediate L/min chip */}
          {qLperMin !== null && (
            <span className="inline-block text-2xs px-2 py-0.5 rounded-full border border-info bg-info-soft text-info font-mono-num">
              {qLperMin} L/min
            </span>
          )}
        </div>
      )}

      {/* ── Q result strip ───────────────────────────────────────────── */}
      <div className={cn(
        'rounded-lg px-3 py-2 flex items-center justify-between',
        hasResult
          ? 'bg-accent-soft border border-accent'
          : 'bg-muted/20 border border-dashed border-border'
      )}>
        <div>
          <p className="text-3xs font-bold uppercase tracking-wider text-accent">Flow Rate Q</p>
          <p className="text-3xs text-muted-foreground font-mono">
            {row.method === 'meter' ? 'Q = ΔV ÷ Δt' : 'Q = V ÷ t × 60 ÷ 1000 × 60'}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-lg font-bold font-mono-num leading-none',
            hasResult ? 'text-accent' : 'text-muted-foreground/30')}>
            {hasResult ? Q : '—'}
          </p>
          {hasResult && <p className="text-3xs text-muted-foreground">m³/hr</p>}
        </div>
      </div>
    </div>
  );
}
