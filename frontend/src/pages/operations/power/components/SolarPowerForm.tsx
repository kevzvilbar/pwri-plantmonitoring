import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import { GridPylonIcon } from '@/pages/operations/shared';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { History, Loader2, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';

interface SolarPowerFormProps {
  isMobile: boolean;
  dt: string;
  setDt: (v: string) => void;
  solarMeterCount: number;
  solarMeterReadings: string[];
  setSolarMeterReadings: (v: string[]) => void;
  setSolarMeterReading: (idx: number, v: string) => void;
  setSolarReading: (v: string) => void;
  gridMeterCount: number;
  gridMeterReadings: string[];
  setGridMeterReadings: (v: string[]) => void;
  setGridMeterReading: (idx: number, v: string) => void;
  setReading: (v: string) => void;
  solarInputMode: 'raw' | 'direct';
  savingMeter: string | null;
  editingId: string | null;
  prevRow: any;
  prevGrid: number | null;
  prevSolar: number | null;
  deltaSolar: number | null;
  deltaGrid: number | null;
  effectiveMultiplier: number;
  powerMeterItems: { type: 'grid' | 'solar'; idx: number }[];
  getSolarLabel: (idx: number) => string;
  getGridLabel: (idx: number) => string;
  getLatestGridReading: (idx: number) => number | null;
  getGridMeterMult: (idx: number) => number;
  configLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isDataAnalyst: boolean;
  submitMeter: (type: 'solar' | 'grid', idx: number) => void;
  setPowerHistoryOpen: (v: { type: 'solar' | 'grid'; idx: number } | null) => void;
  setReplaceMeterIdx: (v: number | null) => void;
  powerAnomaly: any;
  anomalyRemark: string;
  setAnomalyRemark: (v: string) => void;
}

export function SolarPowerForm({
  isMobile,
  dt,
  setDt,
  solarMeterCount,
  solarMeterReadings,
  setSolarMeterReadings,
  setSolarMeterReading,
  setSolarReading,
  gridMeterCount,
  gridMeterReadings,
  setGridMeterReadings,
  setGridMeterReading,
  setReading,
  solarInputMode,
  savingMeter,
  editingId,
  prevRow,
  prevGrid,
  prevSolar,
  deltaSolar,
  deltaGrid,
  effectiveMultiplier,
  powerMeterItems,
  getSolarLabel,
  getGridLabel,
  getLatestGridReading,
  getGridMeterMult,
  configLoading,
  isAdmin,
  isManager,
  isDataAnalyst,
  submitMeter,
  setPowerHistoryOpen,
  setReplaceMeterIdx,
  powerAnomaly,
  anomalyRemark,
  setAnomalyRemark,
}: SolarPowerFormProps) {
  const solarMeterChanged = useCallback((val: string, idx: number) => {
    const solarPrevVal = idx === 0 ? prevSolar : null;
    return val !== '' && (solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal);
  }, [solarInputMode, prevSolar]);

  return (
    <div className="space-y-3">
      {/* Flow-rate anomaly */}
      {powerAnomaly && (
        <AnomalyRemarkBanner
          result={powerAnomaly.result}
          label={powerAnomaly.kind === 'grid' ? getGridLabel(powerAnomaly.idx) : getSolarLabel(powerAnomaly.idx)}
          unit="kwh/hr"
          windowDays={14}
          remark={anomalyRemark}
          onRemarkChange={setAnomalyRemark}
          escalates={false}
        />
      )}

      {/* Date & Time */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="powersection-date-amp-time">Date &amp; Time</Label>
          <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" id="powersection-date-amp-time"/>
        </div>
      </div>

      {/* Desktop 2-column layout */}
      {!isMobile && (
        <div className="grid grid-cols-2 gap-4 items-start">
          {/* Solar column */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 pb-1 border-b border-warn">
              <Sun className="h-3.5 w-3.5 text-warn shrink-0" />
              <span className="text-xs font-semibold text-warn uppercase tracking-wide">Solar</span>
              <span className="text-2xs text-muted-foreground ml-auto">{solarMeterCount} meter{solarMeterCount !== 1 ? 's' : ''}</span>
            </div>
            {Array.from({ length: solarMeterCount }).map((_, idx) => {
              const meterLabel = getSolarLabel(idx);
              const val = solarMeterReadings[idx] ?? '';
              const isFirst = idx === 0;
              const handleChange = (v: string) => {
                setSolarMeterReading(idx, v);
                if (isFirst) setSolarReading(v);
              };
              const meterKey = `solar-${idx}`;
              const isSavingThis = savingMeter === meterKey;
              const solarPrevVal = idx === 0 ? prevSolar : null;
              const solarMeterChanged = val !== '' && (solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal);
              return (
                <div key={`solar-${idx}`}>
                  <Label htmlFor="powersection-solar-${idx}" className="flex items-center gap-1 text-xs">
                    <Sun className="h-3 w-3 text-warn shrink-0" />
                    {meterLabel}
                    {isFirst && editingId && <span className="text-2xs text-warn ml-1">(editing)</span>}
                    {prevRow?.is_estimated && (
                      <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40 ml-1" title="Latest reading is system-generated / backfilled">Est.</span>
                    )}
                    {(isAdmin || isManager || isDataAnalyst) && (
                      <button type="button" title={`View ${meterLabel} history`} aria-label={`View ${meterLabel} history`}
                        onClick={() => setPowerHistoryOpen({ type: 'solar', idx })}
                        className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <History className="h-3 w-3" />
                      </button>
                    )}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="any" value={val}
                      onChange={e => handleChange(e.target.value)}
                      placeholder={solarInputMode === 'direct' ? 'Daily kWh' : 'Solar reading'}
                      className="border-warn focus-visible:ring-warn"
                      data-testid={`power-solar-input-${idx}`} id={`powersection-solar-${idx}`}/>
                    <Button size="sm" disabled={isSavingThis || !solarMeterChanged}
                      onClick={() => submitMeter('solar', idx)}
                      className="shrink-0 h-9 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      data-testid={`power-solar-save-${idx}`}>
                      {isSavingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                  {isFirst && (
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      Mode: <span className="font-medium text-warn">{solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}</span>
                      <span className="opacity-60 ml-1">(configure in Plants → Energy Sources)</span>
                    </p>
                  )}
                  {isFirst && solarInputMode === 'raw' && prevSolar != null && (
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      prev: <span className="font-mono-num">{fmtNum(prevSolar)}</span>
                      {val && deltaSolar != null && (
                        <span className={`font-mono-num font-medium ml-1 ${deltaSolar >= 0 ? 'text-warn' : 'text-destructive'}`}>Δ {fmtNum(deltaSolar)} kWh</span>
                      )}
                      {val && prevSolar != null && deltaSolar == null && (
                        <span className="ml-1 text-muted-foreground/60">(enter value to compute Δ)</span>
                      )}
                    </p>
                  )}
                  {isFirst && solarInputMode === 'raw' && prevSolar == null && val && (
                    <p className="text-2xs text-muted-foreground mt-0.5">No previous solar reading — Δ will be available after next entry.</p>
                  )}
                  {isFirst && solarInputMode === 'direct' && val && (
                    <p className="text-2xs text-warn font-mono-num mt-0.5">→ {fmtNum(+val)} kWh will be saved as daily production</p>
                  )}
                </div>
              );
            })}
            {solarInputMode === 'raw' && deltaSolar != null && solarMeterCount > 1 && (
              <div className="rounded border border-warn bg-warn-soft/60 px-2 py-1 text-xs flex items-center gap-1.5 mt-1">
                <Sun className="h-3 w-3 text-warn shrink-0" />
                <span className="text-muted-foreground">Total Δ</span>
                <span className={`font-mono-num font-semibold ml-auto ${deltaSolar >= 0 ? 'text-warn' : 'text-destructive'}`}>{fmtNum(deltaSolar)} kWh</span>
              </div>
            )}
          </div>

          {/* Grid column */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 pb-1 border-b border-info">
              <GridPylonIcon className="h-3 w-3 text-info" />
              <span className="text-xs font-semibold text-info uppercase tracking-wide">Grid</span>
              <span className="text-2xs text-muted-foreground ml-auto">{gridMeterCount} meter{gridMeterCount !== 1 ? 's' : ''}</span>
            </div>
            {Array.from({ length: gridMeterCount }).map((_, idx) => {
              const meterLabel = getGridLabel(idx);
              const val = gridMeterReadings[idx] ?? '';
              const isFirst = idx === 0;
              const handleChange = (v: string) => {
                setGridMeterReading(idx, v);
                if (isFirst) setReading(v);
              };
              const meterKey = `grid-${idx}`;
              const isSavingThis = savingMeter === meterKey;
              const mMult = getGridMeterMult(idx);
              const prevMeterValSL = getLatestGridReading(idx);
              const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
              return (
                <div key={`grid-${idx}`}>
                  <Label htmlFor={`powersection-grid-${idx}`} className="flex items-center gap-1 text-xs">
                    <GridPylonIcon className="h-2.5 w-2.5 text-info" />
                    {meterLabel}
                    <span className={`text-3xs font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-warn-soft text-warn border border-warn' : 'text-muted-foreground/40'}`}
                      title={configLoading ? 'Loading CT multiplier from config…' : `CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}>
                      {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                    </span>
                    {isFirst && editingId && <span className="text-2xs text-warn ml-1">(editing)</span>}
                    {prevRow?.is_estimated && (
                      <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40 ml-1" title="Latest reading is system-generated / backfilled">Est.</span>
                    )}
                    {(isAdmin || isManager || isDataAnalyst) && (
                      <button type="button" title={`Meter replaced — ${meterLabel}`} aria-label={`Meter replaced — ${meterLabel}`}
                        onClick={() => setReplaceMeterIdx(idx)}
                        className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <ChangeMeterIcon className="h-3 w-3" />
                      </button>
                    )}
                    {(isAdmin || isManager || isDataAnalyst) && (
                      <button type="button" title={`View ${meterLabel} history`} aria-label={`View ${meterLabel} history`}
                        onClick={() => setPowerHistoryOpen({ type: 'grid', idx })}
                        className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <History className="h-3 w-3" />
                      </button>
                    )}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="any" value={val}
                      onChange={e => handleChange(e.target.value)}
                      placeholder="Grid reading"
                      className="border-info focus-visible:ring-info"
                      data-testid={`power-meter-input-${idx}`} id={`powersection-grid-${idx}`}/>
                    <Button size="sm" disabled={isSavingThis || !gridMeterChanged || configLoading}
                      title={configLoading ? 'Loading meter config — please wait' : undefined}
                      onClick={() => submitMeter('grid', idx)}
                      className="shrink-0 h-9 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      data-testid={`power-grid-save-${idx}`}>
                      {isSavingThis || configLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                  {(() => {
                    const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
                    const prevMeterVal = gmrPrev?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
                    if (prevMeterVal == null) return null;
                    const perMeterDelta = gridMeterChanged ? +val - prevMeterVal : null;
                    return (
                      <p className="text-2xs text-muted-foreground mt-0.5">
                        prev: <span className="font-mono-num">{fmtNum(prevMeterVal)}</span>
                        {perMeterDelta != null && (
                          <span className={`font-mono-num font-medium ml-1 ${perMeterDelta >= 0 ? 'text-info' : 'text-destructive'}`}>Δ {fmtNum(perMeterDelta)}</span>
                        )}
                      </p>
                    );
                  })()}
                </div>
              );
            })}
            {gridMeterCount > 1 && (() => {
              const gmrPrev = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
              let totalDelta = 0;
              let hasAny = false;
              for (let mi = 0; mi < gridMeterCount; mi++) {
                const currVal = gridMeterReadings[mi];
                const prevVal = gmrPrev?.[String(mi)] ?? (mi === 0 ? prevGrid : null);
                if (currVal && prevVal != null) {
                  totalDelta += (+currVal - prevVal) * getGridMeterMult(mi);
                  hasAny = true;
                }
              }
              if (!hasAny) return null;
              return (
                <div className="rounded border border-info bg-info-soft/60 px-2 py-1 text-xs flex items-center gap-1.5 mt-1">
                  <GridPylonIcon className="h-3 w-3 text-info shrink-0" />
                  <span className="text-muted-foreground">Total Δ</span>
                  <span className={`font-mono-num font-semibold ml-auto ${totalDelta >= 0 ? 'text-info' : 'text-destructive'}`}>{fmtNum(totalDelta)} kWh</span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Mobile carousel */}
      {isMobile && (
        <MobileCarousel
          isMobile={true}
          items={powerMeterItems}
          renderItem={(item: { type: 'grid' | 'solar'; idx: number }) => {
            if (item.type === 'grid') {
              const meterLabel = getGridLabel(item.idx);
              const val = gridMeterReadings[item.idx] ?? '';
              const isFirst = item.idx === 0;
              const handleChange = (v: string) => { setGridMeterReading(item.idx, v); if (isFirst) setReading(v); };
              const isSavingThis = savingMeter === `grid-${item.idx}`;
              const mMult = getGridMeterMult(item.idx);
              const prevMeterValSL = getLatestGridReading(item.idx);
              const gridMeterChanged = val !== '' && (prevMeterValSL == null || +val !== prevMeterValSL);
              const perMeterDelta = gridMeterChanged && prevMeterValSL != null ? +val - prevMeterValSL : null;
              return (
                <div key={`grid-card-${item.idx}`} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <GridPylonIcon className="h-3 w-3 text-info" />
                      {meterLabel}
                      <span className={`text-3xs font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-warn-soft text-warn border border-warn' : 'text-muted-foreground/40'}`}>
                        {configLoading ? <Loader2 className="h-2 w-2 animate-spin inline" /> : `×${mMult}`}
                      </span>
                      {isFirst && editingId && <span className="text-2xs text-warn">(editing)</span>}
                      {prevRow?.is_estimated && (
                        <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Latest reading is system-generated / backfilled">Est.</span>
                      )}
                    </Label>
                    {(isAdmin || isManager || isDataAnalyst) && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={() => setReplaceMeterIdx(item.idx)} title={`Meter replaced — ${meterLabel}`}>
                        <ChangeMeterIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {(isAdmin || isManager || isDataAnalyst) && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={() => setPowerHistoryOpen({ type: 'grid', idx: item.idx })} title={`View ${meterLabel} history`}>
                        <History className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <OdometerRollerInput value={val} onChange={handleChange}
                    alertState={gridMeterChanged ? (perMeterDelta != null && perMeterDelta < 0 ? 'warn' : 'ok') : 'neutral'}
                    disabled={isSavingThis || configLoading}
                    testId={`power-meter-input-${item.idx}`} />
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValSL != null ? fmtNum(prevMeterValSL) : '—'}</span></span>
                    {perMeterDelta != null && (
                      <span className={`font-mono-num font-medium ${perMeterDelta >= 0 ? 'text-info' : 'text-destructive'}`}>Δ {fmtNum(perMeterDelta)} kWh</span>
                    )}
                  </div>
                  <Button disabled={isSavingThis || !gridMeterChanged || configLoading}
                    title={configLoading ? 'Loading meter config — please wait' : undefined}
                    onClick={() => submitMeter('grid', item.idx)}
                    className="w-full h-11 text-sm bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary shadow-sm"
                    data-testid={`power-grid-save-${item.idx}`}>
                    {isSavingThis || configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId && isFirst ? 'Update' : 'Save'}
                  </Button>
                </div>
              );
            }
            const meterLabel = getSolarLabel(item.idx);
            const val = solarMeterReadings[item.idx] ?? '';
            const isFirst = item.idx === 0;
            const handleChange = (v: string) => { setSolarMeterReading(item.idx, v); if (isFirst) setSolarReading(v); };
            const isSavingThis = savingMeter === `solar-${item.idx}`;
            const solarPrevVal = item.idx === 0 ? prevSolar : null;
            const solarMeterChanged = val !== '' && (solarInputMode === 'direct' || solarPrevVal == null || +val !== solarPrevVal);
            const solarDeltaThis = solarInputMode === 'raw' && solarMeterChanged && solarPrevVal != null ? +val - solarPrevVal : null;
            return (
              <div key={`solar-card-${item.idx}`} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-sm">
                    <span className="text-warn">☀</span>
                    {meterLabel}
                    {isFirst && editingId && <span className="text-2xs text-warn">(editing)</span>}
                    {prevRow?.is_estimated && (
                      <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Latest reading is system-generated / backfilled">Est.</span>
                    )}
                  </Label>
                  {(isAdmin || isManager || isDataAnalyst) && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                      onClick={() => setPowerHistoryOpen({ type: 'solar', idx: item.idx })} title={`View ${meterLabel} history`}>
                      <History className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {isFirst && (
                  <p className="text-2xs text-muted-foreground -mt-1">
                    Mode: <span className="font-medium text-warn">{solarInputMode === 'direct' ? 'Direct kWh' : 'Raw Meter'}</span>
                    <span className="opacity-60 ml-1">(Plants → Energy Sources)</span>
                  </p>
                )}
                {solarInputMode === 'raw' ? (
                  <>
                    <OdometerRollerInput value={val} onChange={handleChange}
                      alertState={solarMeterChanged ? (solarDeltaThis != null && solarDeltaThis < 0 ? 'warn' : 'ok') : 'neutral'}
                      disabled={isSavingThis}
                      testId={`power-solar-input-${item.idx}`} />
                    {isFirst && (
                      <div className="flex items-center justify-between text-xs px-0.5">
                        <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevSolar != null ? fmtNum(prevSolar) : '—'}</span></span>
                        {solarDeltaThis != null && <span className={`font-mono-num font-medium ${solarDeltaThis >= 0 ? 'text-warn' : 'text-destructive'}`}>Δ {fmtNum(solarDeltaThis)} kWh</span>}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Input type="number" step="any" value={val}
                      onChange={e => handleChange(e.target.value)}
                      placeholder="Daily kWh"
                      className="border-warn focus-visible:ring-warn"
                      data-testid={`power-solar-input-${item.idx}`} />
                    {isFirst && val && <p className="text-2xs text-warn font-mono-num">→ {fmtNum(+val)} kWh daily production</p>}
                  </>
                )}
                <Button disabled={isSavingThis || !solarMeterChanged}
                  onClick={() => submitMeter('solar', item.idx)}
                  className="w-full h-11 text-sm bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary shadow-sm"
                  data-testid={`power-solar-save-${item.idx}`}>
                  {isSavingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            );
          }}
        />
      )}

      {/* Energy Source Breakdown */}
      <div className="flex items-center gap-1.5 rounded border bg-muted/20 px-2.5 py-1.5 text-xs">
        <span className="text-muted-foreground/60 font-medium uppercase tracking-wide shrink-0">Breakdown</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="text-warn shrink-0">☀</span>
        <span className={deltaSolar != null ? 'font-mono-num font-medium text-warn' : 'text-muted-foreground/50'}>
          {deltaSolar != null ? `${fmtNum(deltaSolar)} kWh` : '—'}
        </span>
        <span className="text-muted-foreground/40 mx-0.5">|</span>
        <GridPylonIcon className="h-3 w-3 text-info shrink-0" />
        <span className={deltaGrid != null ? 'font-mono-num font-medium text-info' : 'text-muted-foreground/50'}>
          {deltaGrid != null ? `${fmtNum(deltaGrid * effectiveMultiplier)} kWh` : '—'}
        </span>
        {effectiveMultiplier !== 1 && deltaGrid != null && (
          <span className="text-2xs text-warn ml-0.5">×{effectiveMultiplier}</span>
        )}
        <span className="text-muted-foreground/30 text-2xs ml-auto">auto · read-only</span>
      </div>
    </div>
  );
}
