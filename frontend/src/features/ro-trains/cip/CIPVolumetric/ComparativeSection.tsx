import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ComparativeSectionProps {
  preCipVol: string;
  setPreCipVol: (v: string) => void;
  postCipVol: string;
  setPostCipVol: (v: string) => void;
  preCipTds: string;
  setPreCipTds: (v: string) => void;
  postCipTds: string;
  setPostCipTds: (v: string) => void;
  preCipKpi: string;
  setPreCipKpi: (v: string) => void;
  postCipKpi: string;
  setPostCipKpi: (v: string) => void;
  deltaVolRecovery: number | null;
  deltaTds: number | null;
  deltaKpi: number | null;
  deltaColor: (val: number | null, lowerIsBetter?: boolean) => string;
  deltaSign: (val: number | null) => string;
}

export function ComparativeSection({
  preCipVol, setPreCipVol, postCipVol, setPostCipVol,
  preCipTds, setPreCipTds, postCipTds, setPostCipTds,
  preCipKpi, setPreCipKpi, postCipKpi, setPostCipKpi,
  deltaVolRecovery, deltaTds, deltaKpi, deltaColor, deltaSign,
}: ComparativeSectionProps) {
  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">Enter pre‑CIP and post‑CIP values — deltas compute automatically.</p>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Δ Volume Recovery</p>
        </div>
        <p className="text-2xs text-muted-foreground -mt-1">Post‑CIP Volume − Pre‑CIP Volume (m³)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="cipvolumetric-pre-cip-volume-m" className="text-xs text-muted-foreground">Pre-CIP Volume (m³)</Label>
            <Input type="number" step="any" value={preCipVol} onChange={e => setPreCipVol(e.target.value)}
              placeholder="e.g. 180.5" className="h-8 text-sm" id="cipvolumetric-pre-cip-volume-m"/>
          </div>
          <div>
            <Label htmlFor="cipvolumetric-post-cip-volume-m" className="text-xs text-muted-foreground">Post-CIP Volume (m³)</Label>
            <Input type="number" step="any" value={postCipVol} onChange={e => setPostCipVol(e.target.value)}
              placeholder="e.g. 215.0" className="h-8 text-sm" id="cipvolumetric-post-cip-volume-m"/>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground font-medium">Δ Volume Recovery</span>
          <span className={cn('text-base font-bold font-mono-num', deltaColor(deltaVolRecovery))}>
            {deltaSign(deltaVolRecovery)}{deltaVolRecovery !== null ? ' m³' : ''}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-info shrink-0" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Δ Water Quality</p>
        </div>
        <p className="text-2xs text-muted-foreground -mt-1">Post‑CIP Product TDS − Pre‑CIP Product TDS (ppm) — lower is better</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="cipvolumetric-pre-cip-tds-ppm" className="text-xs text-muted-foreground">Pre-CIP TDS (ppm)</Label>
            <Input type="number" step="any" value={preCipTds} onChange={e => setPreCipTds(e.target.value)}
              placeholder="e.g. 45" className="h-8 text-sm" id="cipvolumetric-pre-cip-tds-ppm"/>
          </div>
          <div>
            <Label htmlFor="cipvolumetric-post-cip-tds-ppm" className="text-xs text-muted-foreground">Post-CIP TDS (ppm)</Label>
            <Input type="number" step="any" value={postCipTds} onChange={e => setPostCipTds(e.target.value)}
              placeholder="e.g. 28" className="h-8 text-sm" id="cipvolumetric-post-cip-tds-ppm"/>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground font-medium">Δ TDS</span>
          <span className={cn('text-base font-bold font-mono-num', deltaColor(deltaTds, true))}>
            {deltaSign(deltaTds)}{deltaTds !== null ? ' ppm' : ''}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-warn shrink-0" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Δ Cost Impact</p>
        </div>
        <p className="text-2xs text-muted-foreground -mt-1">Post‑CIP Efficiency KPI − Pre‑CIP Efficiency KPI (kWh/m³)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="cipvolumetric-pre-cip-kpi-kwh-m" className="text-xs text-muted-foreground">Pre-CIP KPI (kWh/m³)</Label>
            <Input type="number" step="any" value={preCipKpi} onChange={e => setPreCipKpi(e.target.value)}
              placeholder="e.g. 0.85" className="h-8 text-sm" id="cipvolumetric-pre-cip-kpi-kwh-m"/>
          </div>
          <div>
            <Label htmlFor="cipvolumetric-post-cip-kpi-kwh-m" className="text-xs text-muted-foreground">Post-CIP KPI (kWh/m³)</Label>
            <Input type="number" step="any" value={postCipKpi} onChange={e => setPostCipKpi(e.target.value)}
              placeholder="e.g. 0.62" className="h-8 text-sm" id="cipvolumetric-post-cip-kpi-kwh-m"/>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground font-medium">Δ Efficiency KPI</span>
          <span className={cn('text-base font-bold font-mono-num', deltaColor(deltaKpi, true))}>
            {deltaSign(deltaKpi)}{deltaKpi !== null ? ' kWh/m³' : ''}
          </span>
        </div>
      </div>

      {(deltaVolRecovery !== null || deltaTds !== null || deltaKpi !== null) && (
        <div className="rounded-xl bg-accent-soft border border-accent p-3 space-y-1.5">
          <p className="text-2xs font-bold uppercase tracking-wider text-accent">CIP Impact Summary</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Δ Volume</p>
              <p className={cn('text-sm font-bold font-mono-num', deltaColor(deltaVolRecovery))}>
                {deltaSign(deltaVolRecovery)}{deltaVolRecovery !== null ? ' m³' : ''}
              </p>
            </div>
            <div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Δ TDS</p>
              <p className={cn('text-sm font-bold font-mono-num', deltaColor(deltaTds, true))}>
                {deltaSign(deltaTds)}{deltaTds !== null ? ' ppm' : ''}
              </p>
            </div>
            <div>
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Δ KPI</p>
              <p className={cn('text-sm font-bold font-mono-num', deltaColor(deltaKpi, true))}>
                {deltaSign(deltaKpi)}{deltaKpi !== null ? '' : ''}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
