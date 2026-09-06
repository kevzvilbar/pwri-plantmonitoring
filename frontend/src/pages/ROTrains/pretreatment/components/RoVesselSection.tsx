import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ComputedInput } from '@/components/ComputedInput';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { RawWaterIcon, PermeateIcon, RejectIcon } from '@/components/icons/water-icons';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { evaluateROMeterSpike } from '@/lib/roReadingGuards';
import { calc, ALERTS } from '@/lib/calculations';

export interface RoVesselSectionProps {
  train: any;
  showFeedMeter: boolean;
  showPermeateMeter: boolean;
  showRejectMeter: boolean;
  showPowerMeter: boolean;
  isSharedPowerMeter: boolean;
  sharedPowerGroup: string | null;
  siblingTrains: any[];
  roValues: Record<string, string>;
  onFieldChange: (key: string) => { value: string; onChange: (e: any) => void };
  autoDurationMin: number | null;
  prevFeedMeter: number | null;
  prevPermMeter: number | null;
  prevRejMeter: number | null;
  feedNegWarn: boolean;
  permNegWarn: boolean;
  rejNegWarn: boolean;
  feedSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  permSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  rejSpike: ReturnType<typeof evaluateROMeterSpike> | null;
  feedNeedsRemark: boolean;
  permNeedsRemark: boolean;
  rejNeedsRemark: boolean;
  anomalyRemarkFeed: string;
  setAnomalyRemarkFeed: (v: string) => void;
  anomalyRemarkPerm: string;
  setAnomalyRemarkPerm: (v: string) => void;
  anomalyRemarkRej: string;
  setAnomalyRemarkRej: (v: string) => void;
  feedInferred: boolean;
  permInferred: boolean;
  rejInferred: boolean;
  effFeedFlow: number | null;
  effPermFlow: number | null;
  effRejFlow: number | null;
  permVol: number | null;
  rejVol: number | null;
  feedVol: number | null;
  feedFlowMeter: number | null;
  permFlowMeter: number | null;
  rejFlowMeter: number | null;
  recovery: number | null;
  recWarn: boolean;
  dp: number | null;
  dpAlert: boolean;
  pwrDelta: number | null;
  pwrKw: number | null;
  secEnergy: number | null;
  prevPowerMeter: number | null;
  productionLabel: string;
  remarks: string;
  setRemarks: (v: string) => void;
  meterCfg: {
    ro_production_source?: string;
    permeate_is_production?: boolean;
  };
  emEntered: number;
  emFeedInferred: boolean;
  emPermInferred: boolean;
  emRejInferred: boolean;
  phWarn: boolean;
  rejection: number | null;
  saltPassage: number | null;
}

export function RoVesselSection({
  train,
  showFeedMeter,
  showPermeateMeter,
  showRejectMeter,
  showPowerMeter,
  isSharedPowerMeter,
  sharedPowerGroup,
  siblingTrains,
  roValues,
  onFieldChange,
  autoDurationMin,
  prevFeedMeter,
  prevPermMeter,
  prevRejMeter,
  feedNegWarn,
  permNegWarn,
  rejNegWarn,
  feedSpike,
  permSpike,
  rejSpike,
  feedNeedsRemark,
  permNeedsRemark,
  rejNeedsRemark,
  anomalyRemarkFeed,
  setAnomalyRemarkFeed,
  anomalyRemarkPerm,
  setAnomalyRemarkPerm,
  anomalyRemarkRej,
  setAnomalyRemarkRej,
  feedInferred,
  permInferred,
  rejInferred,
  effFeedFlow,
  effPermFlow,
  effRejFlow,
  permVol,
  rejVol,
  feedVol,
  feedFlowMeter,
  permFlowMeter,
  rejFlowMeter,
  recovery,
  recWarn,
  dp,
  dpAlert,
  pwrDelta,
  pwrKw,
  secEnergy,
  prevPowerMeter,
  productionLabel,
  remarks,
  setRemarks,
  meterCfg,
  emEntered,
  emFeedInferred,
  emPermInferred,
  emRejInferred,
  phWarn,
  rejection,
  saltPassage,
}: RoVesselSectionProps) {
  const f = (k: string) => onFieldChange(k);

  const activeMeters = [showFeedMeter, showPermeateMeter, showRejectMeter].filter(Boolean).length;
  const meterGridClass = activeMeters === 3 ? 'grid-cols-3' : activeMeters === 2 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <>
      <Card className="p-3 space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">RO Vessel</h4>

        {/* Column headers */}
        <div className={cn('grid gap-2', meterGridClass)}>
          {showFeedMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-info-soft border border-info px-2 py-1.5">
              <RawWaterIcon className="h-3.5 w-3.5 text-info shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-info">Feed / Raw</span>
            </div>
          )}
          {showPermeateMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-accent-soft border border-accent px-2 py-1.5">
              <PermeateIcon className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-accent">{productionLabel}</span>
            </div>
          )}
          {showRejectMeter && (
            <div className="flex items-center gap-1.5 rounded-md bg-muted border border-border px-2 py-1.5">
              <RejectIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
              <span className="text-xs font-semibold text-muted-foreground">Reject / Concentrate</span>
            </div>
          )}
        </div>

        {/* ── Water Meter ─────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Water Meter</p>
            <p className="text-2xs text-muted-foreground/60 italic">
              {(!showFeedMeter || !showRejectMeter) ? 'Missing meter auto-inferred' : 'Leave one stream blank — it will be inferred'}
            </p>
          </div>
          {/* Auto-computed duration from datetime diff */}
          <div className="flex items-center gap-2 mb-1">
            <Label htmlFor="pretreat-duration-min" className="text-xs text-muted-foreground shrink-0">Duration (min)</Label>
            <ComputedInput
              value={autoDurationMin != null ? String(autoDurationMin) : ''}
              className="h-7 text-xs w-28"
            id="pretreat-duration-min"/>
            {autoDurationMin == null && (
              <span className="text-2xs text-muted-foreground/60 italic">— no prior reading found</span>
            )}
          </div>
          {/* Inferred-meter notice banner */}
          {(!showFeedMeter || !showRejectMeter) && (
            <div className="rounded-md bg-info-soft border border-info px-2.5 py-1.5 text-2xs text-info mb-1">
              {!showFeedMeter && showPermeateMeter && showRejectMeter && 'Feed meter disabled — feed volume auto-inferred as permeate + reject.'}
              {showFeedMeter && !showRejectMeter && 'Reject meter disabled — reject volume auto-inferred as feed − permeate.'}
              {!showFeedMeter && !showRejectMeter && 'Feed and reject meters disabled — only permeate logged.'}
            </div>
          )}
          {/* current / prev (auto) / Δ / flow columns — only configured meters */}
          <div className={cn('grid gap-2', meterGridClass)}>
            {/* Feed */}
            {showFeedMeter && (
            <div className="space-y-1">
              <div>
                <Label htmlFor="pretreat-previous-feed-meter-reading" className="text-xs text-muted-foreground">Previous Feed Meter Reading</Label>
                {prevFeedMeter != null
                  ? <ComputedInput value={String(prevFeedMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-feed-meter-reading"/>
                  : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                      <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                    </div>
                }
              </div>
              <div>
                <Label htmlFor="pretreat-feed-meter-reading" className="text-xs text-muted-foreground">Feed Meter Reading</Label>
                <Input type="number" step="any" {...f('feed_meter_curr')} placeholder="Input current feed reading" className={cn(
                  "placeholder:text-2xs placeholder:text-muted-foreground/50",
                  feedNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                  !feedNegWarn && feedSpike && feedSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                  !feedNegWarn && feedSpike && feedSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                )} id="pretreat-feed-meter-reading"/>
                {feedNegWarn && (
                  <p className="text-xs text-danger flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Reading ({Number(roValues.feed_meter_curr)}) is below previous ({prevFeedMeter}) — meter rollback or typo.
                  </p>
                )}
                {feedNeedsRemark && feedSpike && (
                  <div className="mt-1">
                    <AnomalyRemarkBanner
                      result={feedSpike}
                      label="Feed"
                      unit="m3/hr"
                      windowDays={10}
                      remark={anomalyRemarkFeed}
                      onRemarkChange={setAnomalyRemarkFeed}
                    />
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="pretreat-feed-volume-m" className={cn('text-xs', feedInferred ? 'text-info' : 'text-muted-foreground')}>
                  Feed Volume{feedInferred ? ' (inferred)' : ''} (m³)
                </Label>
                <ComputedInput value={feedVol != null ? String(feedVol) : ''} className={cn(feedInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium', feedVol != null && feedVol < 0 && 'border-destructive bg-destructive/10 text-destructive font-semibold')} id="pretreat-feed-volume-m"/>
              </div>
              <div>
                <Label htmlFor="pretreat-feed-flowrate-m-hr" className="text-xs text-muted-foreground">Feed Flowrate (m³/hr)</Label>
                <ComputedInput value={feedFlowMeter != null ? String(feedFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-feed-flowrate-m-hr"/>
              </div>
            </div>
            )}
            {/* Permeate */}
            {showPermeateMeter && (
            <div className="space-y-1">
              <div>
                <Label htmlFor="pretreat-previous-permeate-meter-reading" className="text-xs text-muted-foreground">Previous Permeate Meter Reading</Label>
                {prevPermMeter != null
                  ? <ComputedInput value={String(prevPermMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-permeate-meter-reading"/>
                  : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                      <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                    </div>
                }
              </div>
              <div>
                <Label htmlFor="pretreat-permeate-meter-reading" className="text-xs text-muted-foreground">Permeate Meter Reading</Label>
                <Input type="number" step="any" {...f('permeate_meter_curr')} placeholder="Input current permeate reading" className={cn(
                  "placeholder:text-2xs placeholder:text-muted-foreground/50",
                  permNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                  !permNegWarn && permSpike && permSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                  !permNegWarn && permSpike && permSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                )} id="pretreat-permeate-meter-reading"/>
                {permNegWarn && (
                  <p className="text-xs text-danger flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Reading ({Number(roValues.permeate_meter_curr)}) is below previous ({prevPermMeter}) — meter rollback or typo.
                  </p>
                )}
                {permNeedsRemark && permSpike && (
                  <div className="mt-1">
                    <AnomalyRemarkBanner
                      result={permSpike}
                      label="Permeate"
                      unit="m3/hr"
                      windowDays={10}
                      remark={anomalyRemarkPerm}
                      onRemarkChange={setAnomalyRemarkPerm}
                    />
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="pretreat-m" className={cn('text-xs', permInferred ? 'text-info' : 'text-muted-foreground')}>
                  {meterCfg.ro_production_source === 'permeate' ? 'Production (Permeate)' : 'Permeate Volume'}{permInferred ? ' (inferred)' : ''} (m³)
                </Label>
                <ComputedInput value={permVol != null ? String(permVol) : ''} className={cn(permInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium', permVol != null && permVol < 0 && 'border-destructive bg-destructive/10 text-destructive font-semibold')} id="pretreat-m"/>
              </div>
              <div>
                <Label htmlFor="pretreat-permeate-flowrate-m-hr" className="text-xs text-muted-foreground">Permeate Flowrate (m³/hr)</Label>
                <ComputedInput value={permFlowMeter != null ? String(permFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-permeate-flowrate-m-hr"/>
              </div>
            </div>
            )}
            {/* Reject */}
            {showRejectMeter && (
            <div className="space-y-1">
              <div>
                <Label htmlFor="pretreat-previous-reject-meter-reading" className="text-xs text-muted-foreground">Previous Reject Meter Reading</Label>
                {prevRejMeter != null
                  ? <ComputedInput value={String(prevRejMeter)} className="text-foreground font-semibold bg-muted/40" id="pretreat-previous-reject-meter-reading"/>
                  : <div className="h-9 rounded-md border border-dashed border-border/50 px-3 flex items-center">
                      <span className="text-xs text-muted-foreground/50 italic">No prior reading</span>
                    </div>
                }
              </div>
              <div>
                <Label htmlFor="pretreat-reject-meter-reading" className="text-xs text-muted-foreground">Reject Meter Reading</Label>
                <Input type="number" step="any" {...f('reject_meter_curr')} placeholder="Input current reject reading" className={cn(
                  "placeholder:text-2xs placeholder:text-muted-foreground/50",
                  rejNegWarn && "border-danger bg-danger-soft text-danger focus-visible:ring-danger",
                  !rejNegWarn && rejSpike && rejSpike.tier === 'critical' && "border-destructive bg-destructive/10 focus-visible:ring-destructive",
                  !rejNegWarn && rejSpike && rejSpike.tier === 'needs_remark' && "border-warn bg-warn-soft focus-visible:ring-warn"
                )} id="pretreat-reject-meter-reading"/>
                {rejNegWarn && (
                  <p className="text-xs text-danger flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    Reading ({Number(roValues.reject_meter_curr)}) is below previous ({prevRejMeter}) — meter rollback or typo.
                  </p>
                )}
                {rejNeedsRemark && rejSpike && (
                  <div className="mt-1">
                    <AnomalyRemarkBanner
                      result={rejSpike}
                      label="Reject"
                      unit="m3/hr"
                      windowDays={10}
                      remark={anomalyRemarkRej}
                      onRemarkChange={setAnomalyRemarkRej}
                    />
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="pretreat-reject-volume-m" className={cn('text-xs', rejInferred ? 'text-info' : 'text-muted-foreground')}>
                  Reject Volume{rejInferred ? ' (inferred)' : ''} (m³)
                </Label>
                <ComputedInput value={rejVol != null ? String(rejVol) : ''} className={cn(rejInferred ? 'border-info text-info font-medium' : 'text-foreground font-medium', rejVol != null && rejVol < 0 && 'border-destructive bg-destructive/10 text-destructive font-semibold')} id="pretreat-reject-volume-m"/>
              </div>
              <div>
                <Label htmlFor="pretreat-reject-flowrate-m-hr" className="text-xs text-muted-foreground">Reject Flowrate (m³/hr)</Label>
                <ComputedInput value={rejFlowMeter != null ? String(rejFlowMeter) : ''} className="text-foreground font-medium" id="pretreat-reject-flowrate-m-hr"/>
              </div>
            </div>
            )}
          </div>
        </div>

        {/* ── Pressure row ────────────────────────────────────────────── */}
        <div className="space-y-0.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Pressure (psi)</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <div>
                <Label htmlFor="pretreat-suction" className="text-xs text-muted-foreground">Suction</Label>
                <Input type="number" step="any" {...f('suction_pressure_psi')}
                  placeholder="Suction pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-suction"/>
              </div>
              <div>
                <Label htmlFor="pretreat-feed" className="text-xs text-muted-foreground">Feed</Label>
                <Input type="number" step="any" {...f('feed_pressure_psi')}
                  placeholder="Feed pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed"/>
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <Label htmlFor="pretreat-p-feed-reject" className="text-xs text-muted-foreground">ΔP (feed − reject)</Label>
              <ComputedInput value={dp ?? ''} className={dpAlert ? 'border-danger text-danger font-semibold' : 'text-foreground font-medium'} id="pretreat-p-feed-reject"/>
            </div>
            <div className="flex flex-col justify-end">
              <Label htmlFor="pretreat-reject" className="text-xs text-muted-foreground">Reject</Label>
              <Input type="number" step="any" {...f('reject_pressure_psi')}
                placeholder="Reject pressure" className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject"/>
            </div>
          </div>
        </div>

        {/* ── EM flow override ────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">
              Electromagnetic Flowmeter (m³/hr)
            </p>
            <p className="text-2xs text-muted-foreground/60 italic">
              {emEntered === 0 && 'Enter any two — third auto-computes'}
              {emEntered === 1 && 'Enter one more — third will be computed'}
              {emEntered === 2 && 'One value computed from the other two'}
              {emEntered === 3 && 'All three manually entered'}
            </p>
          </div>
          <div className={cn('grid gap-2', meterGridClass)}>
            {/* Feed EM */}
            {showFeedMeter && (
            <div className="space-y-1">
              <Label htmlFor="pretreat-feed-flowrate" className={cn('text-xs', emFeedInferred ? 'text-info' : 'text-muted-foreground')}>
                Feed Flowrate{emFeedInferred ? ' (computed)' : ''}
              </Label>
              {emFeedInferred ? (
                <ComputedInput
                  value={effFeedFlow != null ? String(effFeedFlow) : ''}
                  className="border-info text-info font-semibold"
                />
              ) : (
                <Input type="number" step="any" {...f('feed_flow')}
                  placeholder={feedFlowMeter != null ? `≈ ${feedFlowMeter} (meter)` : 'EM reading'}
                  className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-feed-flowrate"/>
              )}
            </div>
            )}
            {/* Permeate EM */}
            {showPermeateMeter && (
            <div className="space-y-1">
              <Label htmlFor="pretreat-field-3" className={cn('text-xs', emPermInferred ? 'text-info' : 'text-muted-foreground')}>
                {meterCfg.ro_production_source === 'permeate' ? 'Production Flowrate' : 'Permeate Flowrate'}{emPermInferred ? ' (computed)' : ''}
              </Label>
              {emPermInferred ? (
                <ComputedInput
                  value={effPermFlow != null ? String(effPermFlow) : ''}
                  className="border-info text-info font-semibold"
                />
              ) : (
                <Input type="number" step="any" {...f('permeate_flow')}
                  placeholder={permFlowMeter != null ? `≈ ${permFlowMeter} (meter)` : 'EM reading'}
                  className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-field-3"/>
              )}
              <div className="mt-1">
                <Label htmlFor="pretreat-recovery" className={cn('text-xs', recWarn ? 'text-warn' : 'text-muted-foreground')}>
                  Recovery %{recWarn ? ' ⚠' : ''}
                </Label>
                <ComputedInput value={recovery != null ? String(recovery) : ''} className={recWarn ? 'border-warn text-warn-foreground font-semibold' : 'text-foreground font-medium'} id="pretreat-recovery"/>
              </div>
            </div>
            )}
            {/* Reject EM */}
            {showRejectMeter && (
            <div className="space-y-1">
              <Label htmlFor="pretreat-reject-flowrate" className={cn('text-xs', emRejInferred ? 'text-info' : 'text-muted-foreground')}>
                Reject Flowrate{emRejInferred ? ' (computed)' : ''}
              </Label>
              {emRejInferred ? (
                <ComputedInput
                  value={effRejFlow != null ? String(effRejFlow) : ''}
                  className="border-info text-info font-semibold"
                />
              ) : (
                <Input type="number" step="any" {...f('reject_flow')}
                  placeholder={rejFlowMeter != null ? `≈ ${rejFlowMeter} (meter)` : 'EM reading'}
                  className="placeholder:text-2xs placeholder:text-muted-foreground/50" id="pretreat-reject-flowrate"/>
              )}
            </div>
            )}
          </div>
        </div>

        {/* ── TDS row ──────────────────────────────────────────────────── */}
        <div className="space-y-0.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">TDS (ppm)</p>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="pretreat-feed-tds" className="text-xs text-muted-foreground">Feed TDS</Label><Input type="number" step="any" {...f('feed_tds')} id="pretreat-feed-tds"/></div>
            <div><Label htmlFor="pretreat-permeate-tds" className="text-xs text-muted-foreground">Permeate TDS</Label><Input type="number" step="any" {...f('permeate_tds')} id="pretreat-permeate-tds"/></div>
            <div><Label htmlFor="pretreat-reject-tds" className="text-xs text-muted-foreground">Reject TDS</Label><Input type="number" step="any" {...f('reject_tds')} id="pretreat-reject-tds"/></div>
          </div>
          {/* Rejection + Salt Passage in their own row below TDS inputs */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <Label htmlFor="pretreat-salt-rejection" className="text-xs text-muted-foreground">Salt Rejection %</Label>
              <ComputedInput value={rejection ?? ''} className="text-foreground font-medium" id="pretreat-salt-rejection"/>
            </div>
            <div>
              <Label htmlFor="pretreat-salt-passage" className="text-xs text-muted-foreground">Salt Passage %</Label>
              <ComputedInput value={saltPassage ?? ''} className="text-foreground font-medium" id="pretreat-salt-passage"/>
            </div>
          </div>
        </div>

        {/* ── pH row ───────────────────────────────────────────────────── */}
        <div className="space-y-0.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">pH</p>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="pretreat-feed-ph" className="text-xs text-muted-foreground">Feed pH</Label><Input type="number" step="any" {...f('feed_ph')} id="pretreat-feed-ph"/></div>
            <div><Label htmlFor="pretreat-permeate-ph" className="text-xs text-muted-foreground">Permeate pH</Label><Input type="number" step="any" {...f('permeate_ph')} className={phWarn ? 'border-warn' : ''} id="pretreat-permeate-ph"/></div>
            <div><Label htmlFor="pretreat-reject-ph" className="text-xs text-muted-foreground">Reject pH</Label><Input type="number" step="any" {...f('reject_ph')} id="pretreat-reject-ph"/></div>
          </div>
        </div>

        {/* ── Product quality / ambient ────────────────────────────────── */}
        <div className="space-y-0.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">Product Quality</p>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="pretreat-product-turbidity-ntu" className="text-xs text-muted-foreground">Product Turbidity (NTU)</Label><Input type="number" step="any" {...f('turbidity_ntu')} id="pretreat-product-turbidity-ntu"/></div>
            <div><Label htmlFor="pretreat-product-temperature-c" className="text-xs text-muted-foreground">Product Temperature (°C)</Label><Input type="number" step="any" {...f('temperature_c')} id="pretreat-product-temperature-c"/></div>
            <div><Label htmlFor="pretreat-product-chlorine-residual-mg-l" className="text-xs text-muted-foreground">Product Chlorine Residual (mg/L)</Label><Input type="number" step="any" min="0" {...f('chlorine_residual_mg_l')} id="pretreat-product-chlorine-residual-mg-l"/></div>
          </div>
        </div>
      </Card>

      {/* ── Power Meter ──────────────────────────────────────────────────── */}
      {/* Show when per-train electricity meter is enabled in meter config.
          When disabled, plant-level power is tracked via Operations → Power tab instead. */}
      {showPowerMeter && (
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Power Meter (per train)</h4>
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/70">
            <span>Duration:</span>
            <span className="font-mono font-medium">{autoDurationMin != null ? `${autoDurationMin} min` : '—'}</span>
          </div>
        </div>

        {/* Shared meter warning banner */}
        {isSharedPowerMeter && (
          <div className="rounded-md bg-warn-soft border border-warn px-2.5 py-2 text-xs text-warn space-y-0.5">
            <div className="flex items-center gap-1.5 font-semibold">
              <span>⚡ Shared power meter</span>
              <span className="font-mono text-2xs bg-warn-soft px-1.5 py-0.5 rounded">
                group: {sharedPowerGroup}
              </span>
            </div>
            <p className="opacity-80">
              This train shares one physical meter with{' '}
              {siblingTrains?.length
                ? siblingTrains.map((t: any) => `Train ${t.train_number}${t.name ? ` (${t.name})` : ''}`).join(', ')
                : 'other trains in this group'}.
              Enter the <strong>same meter reading</strong> on each train.
              The full kWh delta is saved here — volume-weighted allocation happens in reports.
            </p>
            <p className="opacity-60 italic">
              Specific energy shown below is an estimate (full meter ÷ this train's permeate only).
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="pretreat-prev-reading-kwh" className="text-xs text-muted-foreground">
              Prev reading (kWh){prevPowerMeter != null ? ' — auto' : ' — enter manually (first reading)'}
            </Label>
            <ComputedInput value={prevPowerMeter != null ? String(prevPowerMeter) : ''} className="text-foreground font-medium" id="pretreat-prev-reading-kwh"/>
          </div>
          <div>
            <Label htmlFor="pretreat-current-reading-kwh" className="text-xs text-muted-foreground">Current reading (kWh)</Label>
            <Input type="number" step="any" {...f('power_meter_curr')} placeholder="e.g. 12456.8" id="pretreat-current-reading-kwh"/>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="pretreat-consumption-kwh" className="text-xs text-muted-foreground">Δ Consumption (kWh)</Label>
            <ComputedInput value={pwrDelta ?? ''} className="text-foreground font-medium" id="pretreat-consumption-kwh"/>
          </div>
          <div>
            <Label htmlFor="pretreat-avg-power-kw" className="text-xs text-muted-foreground">Avg power (kW)</Label>
            <ComputedInput value={pwrKw ?? ''} className="text-foreground font-medium" id="pretreat-avg-power-kw"/>
          </div>
          <div>
            <Label htmlFor="pretreat-specific-energy-kwh-m" className={cn('text-xs', isSharedPowerMeter ? 'text-warn' : 'text-muted-foreground')}>
              Specific energy (kWh/m³){isSharedPowerMeter ? ' ≈ est.' : ''}
            </Label>
            <ComputedInput
              value={secEnergy ?? ''}
              className={isSharedPowerMeter ? 'border-warn text-warn font-medium' : 'text-foreground font-medium'}
            id="pretreat-specific-energy-kwh-m"/>
          </div>
        </div>
      </Card>
      )}
      {!showPowerMeter && (
      <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        ⚡ Per-train power meter not configured for this plant — energy consumption is tracked plant-wide in the <strong className="font-medium">Power tab</strong>.
      </div>
      )}

      <Card className="p-3 space-y-2">
        <Label htmlFor="pretreat-remarks" className="text-xs text-muted-foreground">Remarks</Label>
        <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Any observations..." id="pretreat-remarks"/>
      </Card>
    </>
  );
}
