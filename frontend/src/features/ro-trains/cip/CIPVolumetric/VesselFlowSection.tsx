import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VesselFlowCard, type VesselFlowRow } from '../VesselFlowCard';
import { X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VesselFlowSectionProps {
  vesselCount: number;
  vesselCountInput: string;
  setVesselCountInput: (v: string) => void;
  listGenerated: boolean;
  setListGenerated: (v: boolean) => void;
  vesselListOpen: boolean;
  setVesselListOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  vesselRows: VesselFlowRow[];
  expandedVessel: number | null;
  setExpandedVessel: (v: number | null) => void;
  globalMethod: 'meter' | 'manual';
  applyGlobalMethod: (m: 'meter' | 'manual') => void;
  generateList: () => void;
  patchRow: (id: number, patch: Partial<VesselFlowRow>) => void;
  savedVessels: Set<number>;
  editingVessel: number | null;
  saveVessel: (id: number) => void;
  editVessel: (id: number) => void;
  deleteVessel: (id: number) => void;
}

export function VesselFlowSection({
  vesselCount, vesselCountInput, setVesselCountInput, listGenerated, setListGenerated,
  vesselListOpen, setVesselListOpen, vesselRows, expandedVessel, setExpandedVessel,
  globalMethod, applyGlobalMethod, generateList, patchRow, savedVessels, editingVessel,
  saveVessel, editVessel, deleteVessel,
}: VesselFlowSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-muted/20 px-3 py-2.5">
        <span className="text-xs font-semibold text-foreground shrink-0">Vessels per train:</span>
        <Input
          type="number" min="1" max="50"
          value={vesselCountInput}
          onChange={e => setVesselCountInput(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && generateList()}
          className="h-7 w-16 text-sm text-center font-mono"
        />
        <Button
          size="sm"
          onClick={generateList}
          className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Generate List
        </Button>
        {listGenerated && (
          <span className="text-2xs text-accent font-medium">
            ✓ {vesselCount} vessel{vesselCount !== 1 ? 's' : ''} ready
          </span>
        )}
      </div>

      {listGenerated && (<>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">All vessels:</span>
          <div className="flex rounded-full border border-border overflow-hidden text-xs font-semibold">
            <button type="button" onClick={() => applyGlobalMethod('meter')}
              className={cn('px-3 py-1 transition-colors',
                globalMethod === 'meter' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
              📟 Water Meter
            </button>
            <button type="button" onClick={() => applyGlobalMethod('manual')}
              className={cn('px-3 py-1 transition-colors',
                globalMethod === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
              🪣 Bucket Test
            </button>
          </div>
          <span className="text-2xs text-muted-foreground/60 italic">or switch per vessel ↓</span>
        </div>

        <div className="rounded-md bg-muted/30 border border-border px-3 py-1.5 text-2xs text-muted-foreground font-mono space-y-0.5">
          {globalMethod === 'meter'
            ? <><span className="text-foreground font-semibold">Q = ΔV ÷ Δt</span>  ·  ΔV = curr − prev meter (m³)  ·  Δt = elapsed time (hr)</>
            : <><span className="text-foreground font-semibold">Q = V_bucket ÷ t_fill</span>  ·  e.g. 20 L ÷ 45 s → L/min → m³/hr</>
          }
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setVesselListOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <span className="text-xs font-semibold text-foreground">
              Vessel List ({vesselCount} vessel{vesselCount !== 1 ? 's' : ''})
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-muted-foreground">
                {vesselRows.filter(r => {
                  if (r.method === 'meter') {
                    const dV = r.currMeter && r.prevMeter ? +r.currMeter - +r.prevMeter : null;
                    const dT = r.prevTime && r.currTime ? (new Date(r.currTime).getTime() - new Date(r.prevTime).getTime()) / 3600000 : null;
                    return dV !== null && dT !== null && dT > 0;
                  }
                  return +r.bucketVol > 0 && +r.fillTimeSec > 0;
                }).length} / {vesselCount} filled
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', vesselListOpen ? 'rotate-180' : '')} />
            </div>
          </button>

          {vesselListOpen && (
          <div className="divide-y divide-border">
          {vesselRows.map(row => {
            const isOpen = expandedVessel === row.id;
            const prevM = +row.prevMeter, currM = +row.currMeter;
            const dV = (row.currMeter && row.prevMeter) ? currM - prevM : null;
            const dT = (row.prevTime && row.currTime)
              ? (new Date(row.currTime).getTime() - new Date(row.prevTime).getTime()) / 3600000 : null;
            const qPreview_meter = (dV !== null && dT !== null && dT > 0) ? +(dV / dT).toFixed(3) : null;
            const bV = +row.bucketVol, bT = +row.fillTimeSec;
            const qPreview_manual = (bV > 0 && bT > 0) ? +((bV / bT * 60 / 1000 * 60)).toFixed(3) : null;
            const qPreview = row.method === 'meter' ? qPreview_meter : qPreview_manual;

            const isSaved = savedVessels.has(row.id);
            const isEditing = editingVessel === row.id;

            return (
              <div key={row.id} className={cn(
                'rounded-xl border transition-colors overflow-hidden',
                isSaved
                  ? 'border-accent bg-accent-soft/30'
                  : isOpen ? 'border-accent' : 'border-border'
              )}>
                <div className="flex items-center px-3 py-2.5 hover:bg-muted/20 transition-colors">
                  <button
                    type="button"
                    onClick={() => !isSaved && setExpandedVessel(isOpen ? null : row.id)}
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                    disabled={isSaved}
                  >
                    <span className="text-xs font-bold text-foreground">Vessel {row.id}</span>
                    <span className={cn('text-2xs px-1.5 py-0.5 rounded-full border font-medium shrink-0',
                      row.method === 'meter'
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-warn bg-warn-soft text-warn')}>
                      {row.method === 'meter' ? '📟 Meter' : '🪣 Bucket'}
                    </span>
                    {isSaved && (
                      <span className="text-2xs text-accent font-semibold">✓ saved</span>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {qPreview !== null ? (
                      <span className="text-xs font-bold font-mono-num text-accent">
                        {qPreview} m³/hr
                      </span>
                    ) : (
                      !isSaved && <span className="text-2xs text-muted-foreground/50">not set</span>
                    )}

                    {isOpen && !isSaved && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); saveVessel(row.id); }}
                        className="h-6 px-2 rounded text-2xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        title="Save this vessel"
                      >
                        Save
                      </button>
                    )}

                    {isSaved && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); editVessel(row.id); }}
                        className="h-6 px-2 rounded text-2xs font-semibold border border-border bg-background hover:bg-muted transition-colors text-foreground"
                        title="Edit this vessel"
                      >
                        Edit
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); deleteVessel(row.id); }}
                      className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove this vessel"
                      aria-label="Remove this vessel"
                    >
                      <X className="h-3 w-3" />
                    </button>

                    {!isSaved && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={isOpen ? 'Collapse vessel details' : 'Expand vessel details'}
                        className="text-muted-foreground/50 text-xs cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 rounded"
                        onClick={() => setExpandedVessel(isOpen ? null : row.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedVessel(isOpen ? null : row.id); }
                        }}
                      >
                        {isOpen ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                </div>

                {isOpen && !isSaved && (
                  <div className="px-2 pb-2">
                    <VesselFlowCard row={row} onChange={patch => patchRow(row.id, patch)} />
                  </div>
                )}
              </div>
            );
          })}
          </div>
          )}
        </div>

        {vesselRows.some(r => {
          if (r.method === 'meter') {
            const dV = r.currMeter && r.prevMeter ? +r.currMeter - +r.prevMeter : null;
            const dT = r.prevTime && r.currTime ? (new Date(r.currTime).getTime() - new Date(r.prevTime).getTime()) / 3600000 : null;
            return dV !== null && dT !== null && dT > 0;
          }
          return +r.bucketVol > 0 && +r.fillTimeSec > 0;
        }) && (
          <div className="rounded-lg bg-accent-soft border border-accent p-2.5">
            <p className="text-3xs text-accent font-bold uppercase tracking-wide mb-1.5">Flow Summary — All Vessels</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {vesselRows.map(r => {
                let q: number | null = null;
                if (r.method === 'meter') {
                  const dV = r.currMeter && r.prevMeter ? +r.currMeter - +r.prevMeter : null;
                  const dT = r.prevTime && r.currTime ? (new Date(r.currTime).getTime() - new Date(r.prevTime).getTime()) / 3600000 : null;
                  q = (dV !== null && dT !== null && dT > 0) ? +(dV / dT).toFixed(3) : null;
                } else {
                  const bV = +r.bucketVol, bT = +r.fillTimeSec;
                  q = (bV > 0 && bT > 0) ? +((bV / bT * 60 / 1000 * 60)).toFixed(3) : null;
                }
                return (
                  <div key={r.id} className="text-center">
                    <p className="text-3xs text-muted-foreground">V{r.id}</p>
                    <p className={cn('text-xs font-bold font-mono-num',
                      q !== null ? 'text-accent' : 'text-muted-foreground/40')}>
                      {q !== null ? q : '—'}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-3xs text-muted-foreground/50 mt-1.5">m³/hr per vessel</p>
          </div>
        )}
      </>)}
    </div>
  );
}
