import React, { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

import { VesselFlowCard, type VesselFlowMethod, type VesselFlowRow } from './VesselFlowCard';

// ─── CIP Volumetric & Analytics ───────────────────────────────────────────────
// Per-vessel flow rate — two methods:
//   A) Water Meter Delta:  Q = ΔV / Δt   (ΔV = curr−prev m³, Δt in hr)
//   B) Manual Bucket Test: Q = V_bucket / t_fill  (e.g. 20 L ÷ seconds → L/min → m³/hr)
// Comparative analytics: Δ volume recovery, Δ TDS, Δ cost/efficiency (pre vs post CIP)
export function CIPVolumetric({ numVessels = 4 }: { numVessels?: number }) {
  // ── Vessel count — user can override before generating the list ──────────
  const [vesselCount, setVesselCount] = useState(numVessels);
  const [vesselCountInput, setVesselCountInput] = useState(String(numVessels));
  const [listGenerated, setListGenerated] = useState(false);
  const [vesselListOpen, setVesselListOpen] = useState(true);

  // ── Per-vessel flow state ─────────────────────────────────────────────────
  const makeRow = (id: number): VesselFlowRow => ({
    id, method: 'meter',
    prevMeter: '', currMeter: '', prevTime: '', currTime: '',
    bucketVol: '20', fillTimeSec: '',
  });
  const [vesselRows, setVesselRows] = useState<VesselFlowRow[]>(
    Array.from({ length: vesselCount }, (_, i) => makeRow(i + 1))
  );
  const [expandedVessel, setExpandedVessel] = useState<number | null>(null);
  const [globalMethod, setGlobalMethod] = useState<VesselFlowMethod>('meter');

  const generateList = () => {
    const n = Math.max(1, Math.min(50, +vesselCountInput || vesselCount));
    setVesselCount(n);
    setVesselRows(Array.from({ length: n }, (_, i) => makeRow(i + 1)));
    setListGenerated(true);
    setVesselListOpen(true);
    setSavedVessels(new Set());
    setEditingVessel(null);
  };

  const patchRow = (id: number, patch: Partial<VesselFlowRow>) =>
    setVesselRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r));

  // ── Per-vessel save / edit / delete ─────────────────────────────────────
  // "saved" vessels show a green lock icon and are read-only until Edited.
  const [savedVessels, setSavedVessels] = useState<Set<number>>(new Set());
  const [editingVessel, setEditingVessel] = useState<number | null>(null);

  const saveVessel = (id: number) => {
    setSavedVessels(prev => new Set([...prev, id]));
    setEditingVessel(null);
    setExpandedVessel(null);
  };
  const editVessel = (id: number) => {
    setSavedVessels(prev => { const n = new Set(prev); n.delete(id); return n; });
    setEditingVessel(id);
    setExpandedVessel(id);
  };
  const deleteVessel = (id: number) => {
    setVesselRows(rows => rows.filter(r => r.id !== id));
    setSavedVessels(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (expandedVessel === id) setExpandedVessel(null);
  };

  const applyGlobalMethod = (m: VesselFlowMethod) => {
    setGlobalMethod(m);
    setVesselRows(rows => rows.map(r => ({ ...r, method: m })));
  };

  // ── Volumetric flow Q = ΔV / Δt state (Tab 2 — global) ──────────────────
  const [qPrevMeter, setQPrevMeter] = useState('');
  const [qCurrMeter, setQCurrMeter] = useState('');
  const [qPrevTime,  setQPrevTime]  = useState('');
  const [qCurrTime,  setQCurrTime]  = useState('');

  // ── Comparative analytics state ──────────────────────────────────────────
  const [preCipVol,  setPreCipVol]  = useState('');
  const [postCipVol, setPostCipVol] = useState('');
  const [preCipTds,  setPreCipTds]  = useState('');
  const [postCipTds, setPostCipTds] = useState('');
  const [preCipKpi,  setPreCipKpi]  = useState('');
  const [postCipKpi, setPostCipKpi] = useState('');

  // ── Active section tab ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'vessel' | 'flow' | 'compare'>('vessel');

  // ── Q = ΔV / Δt calc (Tab 2) ─────────────────────────────────────────────
  const deltaV = (qCurrMeter !== '' && qPrevMeter !== '')
    ? +((+qCurrMeter) - (+qPrevMeter)).toFixed(4) : null;
  const deltaT_hr = useMemo(() => {
    if (!qPrevTime || !qCurrTime) return null;
    const diff = (new Date(qCurrTime).getTime() - new Date(qPrevTime).getTime()) / 3600000;
    return diff > 0 ? +diff.toFixed(4) : null;
  }, [qPrevTime, qCurrTime]);
  const flowQ = (deltaV !== null && deltaT_hr !== null && deltaT_hr > 0)
    ? +((deltaV) / deltaT_hr).toFixed(4) : null;

  // ── Comparative analytics calc ────────────────────────────────────────────
  const deltaVolRecovery = (postCipVol !== '' && preCipVol !== '')
    ? +((+postCipVol) - (+preCipVol)).toFixed(4) : null;
  const deltaTds = (postCipTds !== '' && preCipTds !== '')
    ? +((+postCipTds) - (+preCipTds)).toFixed(2) : null;
  const deltaKpi = (postCipKpi !== '' && preCipKpi !== '')
    ? +((+postCipKpi) - (+preCipKpi)).toFixed(2) : null;

  const deltaColor = (val: number | null, lowerIsBetter = false) => {
    if (val === null) return 'text-muted-foreground';
    const good = lowerIsBetter ? val < 0 : val > 0;
    return good ? 'text-accent' : val === 0 ? 'text-muted-foreground' : 'text-danger';
  };
  const deltaSign = (val: number | null) => val === null ? '—' : val > 0 ? `+${val}` : `${val}`;

  const TABS = [
    { key: 'vessel',  label: 'Per-Vessel Flow' },
    { key: 'flow',    label: 'Flow Q=ΔV/Δt'    },
    { key: 'compare', label: 'Comparative'      },
  ] as const;

  return (
    <Card className="p-3 space-y-3">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Volumetric & Analytics</h4>
        <p className="text-2xs text-muted-foreground mt-0.5">Per-vessel flow rate · Global Q=ΔV/Δt · Pre/Post CIP comparison</p>
      </div>

      {/* ── Section tab pills ────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn(
              'text-xs px-3 py-1 rounded-full border font-medium transition-colors',
              activeTab === t.key
                ? 'bg-accent text-accent-foreground border-accent'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB 1 — Per-Vessel Flow Rate ════════════════════════════ */}
      {activeTab === 'vessel' && (
        <div className="space-y-3">

          {/* ── Vessel count prompt ──────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <span className="text-xs font-semibold text-foreground shrink-0">Vessels per train:</span>
            <Input
              type="number" min="1" max="50"
              value={vesselCountInput}
              onChange={e => setVesselCountInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && generateList()}
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

          {/* Global method switcher */}
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

          {/* Formula hint */}
          <div className="rounded-md bg-muted/30 border border-border px-3 py-1.5 text-2xs text-muted-foreground font-mono space-y-0.5">
            {globalMethod === 'meter'
              ? <><span className="text-foreground font-semibold">Q = ΔV ÷ Δt</span>  ·  ΔV = curr − prev meter (m³)  ·  Δt = elapsed time (hr)</>
              : <><span className="text-foreground font-semibold">Q = V_bucket ÷ t_fill</span>  ·  e.g. 20 L ÷ 45 s → L/min → m³/hr</>
            }
          </div>

          {/* Vessel list — foldable ──────────────────────────────── */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Fold/unfold header */}
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
              // Quick Q preview for collapsed state
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
                  {/* Accordion header */}
                  <div className="flex items-center px-3 py-2.5 hover:bg-muted/20 transition-colors">
                    {/* Clickable label area (expands/collapses) */}
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

                    {/* Right side: Q preview + action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {qPreview !== null ? (
                        <span className="text-xs font-bold font-mono-num text-accent">
                          {qPreview} m³/hr
                        </span>
                      ) : (
                        !isSaved && <span className="text-2xs text-muted-foreground/50">not set</span>
                      )}

                      {/* Save button — shown when open and not yet saved */}
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

                      {/* Edit button — shown when saved */}
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

                      {/* Delete button — always visible */}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); deleteVessel(row.id); }}
                        className="h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove this vessel"
                        aria-label="Remove this vessel"
                      >
                        <X className="h-3 w-3" />
                      </button>

                      {/* Expand chevron — hidden when saved */}
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

                  {/* Expanded vessel card — shown when open and not saved */}
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

          {/* All-vessel Q summary strip */}
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
      )}

      {/* ══ TAB 2 — Volumetric Flow Q = ΔV / Δt ════════════════════ */}
      {activeTab === 'flow' && (
        <div className="space-y-3">
          {/* Formula card */}
          <div className="rounded-lg bg-muted/40 border border-border px-3 py-2 space-y-0.5">
            <p className="text-xs font-semibold text-foreground font-mono">Q = ΔV ÷ Δt</p>
            <p className="text-2xs text-muted-foreground">ΔV = Curr meter − Prev meter (m³) &nbsp;·&nbsp; Δt = elapsed time (hr)</p>
          </div>

          {/* Meter readings */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meter Readings (m³)</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cipvolumetric-previous-reading" className="text-xs text-muted-foreground">Previous reading</Label>
                <Input type="number" step="any" value={qPrevMeter} onChange={e => setQPrevMeter(e.target.value)}
                  placeholder="e.g. 1024.50" className="h-9 text-sm" id="cipvolumetric-previous-reading"/>
              </div>
              <div>
                <Label htmlFor="cipvolumetric-current-reading" className="text-xs text-muted-foreground">Current reading</Label>
                <Input type="number" step="any" value={qCurrMeter} onChange={e => setQCurrMeter(e.target.value)}
                  placeholder="e.g. 1087.30" className="h-9 text-sm" id="cipvolumetric-current-reading"/>
              </div>
            </div>
            {/* ΔV result */}
            <div className={cn('rounded-md border px-3 py-2 flex items-center justify-between',
              deltaV !== null ? 'bg-accent-soft border-accent'
                             : 'bg-muted/30 border-border')}>
              <span className="text-xs text-muted-foreground font-medium">ΔV (volume produced)</span>
              <span className={cn('text-sm font-bold font-mono-num', deltaV !== null ? 'text-accent' : 'text-muted-foreground')}>
                {deltaV !== null ? `${deltaV} m³` : '—'}
              </span>
            </div>
          </div>

          {/* Time interval */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time Interval</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="cipvolumetric-previous-date-time" className="text-xs text-muted-foreground">Previous date & time</Label>
                <Input type="datetime-local" value={qPrevTime} onChange={e => setQPrevTime(e.target.value)} className="h-9 text-xs" id="cipvolumetric-previous-date-time"/>
              </div>
              <div>
                <Label htmlFor="cipvolumetric-current-date-time" className="text-xs text-muted-foreground">Current date & time</Label>
                <Input type="datetime-local" value={qCurrTime} onChange={e => setQCurrTime(e.target.value)} className="h-9 text-xs" id="cipvolumetric-current-date-time"/>
              </div>
            </div>
            {/* Δt result */}
            <div className={cn('rounded-md border px-3 py-2 flex items-center justify-between',
              deltaT_hr !== null ? 'bg-muted/40 border-border' : 'bg-muted/20 border-border')}>
              <span className="text-xs text-muted-foreground font-medium">Δt (elapsed)</span>
              <span className="text-sm font-bold font-mono-num text-foreground">
                {deltaT_hr !== null ? `${deltaT_hr} hr` : '—'}
              </span>
            </div>
          </div>

          {/* Q result — hero strip */}
          <div className={cn(
            'rounded-xl border-2 p-3 flex items-center justify-between gap-3',
            flowQ !== null
              ? 'bg-accent-soft border-accent'
              : 'bg-muted/20 border-dashed border-border'
          )}>
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-accent">
                Volumetric Flow Rate
              </p>
              <p className="text-3xs text-muted-foreground font-mono">Q = ΔV ÷ Δt</p>
            </div>
            <div className="text-right">
              <p className={cn('text-2xl font-bold font-mono-num leading-none',
                flowQ !== null ? 'text-accent' : 'text-muted-foreground/40')}>
                {flowQ !== null ? flowQ : '—'}
              </p>
              {flowQ !== null && <p className="text-2xs text-muted-foreground mt-0.5">m³/hr</p>}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB 3 — Comparative Analytics ═══════════════════════════ */}
      {activeTab === 'compare' && (
        <div className="space-y-3">
          <p className="text-2xs text-muted-foreground">Enter pre‑CIP and post‑CIP values — deltas compute automatically.</p>

          {/* ── Δ Volume Recovery ─────────────────────────────────── */}
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

          {/* ── Δ Water Quality (TDS) ─────────────────────────────── */}
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

          {/* ── Δ Cost Impact / Efficiency KPI ───────────────────── */}
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

          {/* ── Summary strip ────────────────────────────────────── */}
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
      )}
    </Card>
  );
}
