import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { OdometerRollerInput, MobileCarousel } from '@/components/OdometerRollerInput';
import { GridPylonIcon } from '@/pages/operations/shared';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { History, Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum } from '@/lib/calculations';

interface NonSolarPowerFormProps {
  isMobile: boolean;
  dt: string;
  setDt: (v: string) => void;
  gridMeterCount: number;
  gridMeterReadings: string[];
  setGridMeterReadings: (v: string[]) => void;
  setGridMeterReading: (idx: number, v: string) => void;
  setReading: (v: string) => void;
  savingMeter: string | null;
  editingId: string | null;
  prevRow: any;
  prevGrid: number | null;
  deltaGrid: number | null;
  effectiveMultiplier: number;
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
}

export function NonSolarPowerForm({
  isMobile,
  dt,
  setDt,
  gridMeterCount,
  gridMeterReadings,
  setGridMeterReadings,
  setGridMeterReading,
  setReading,
  savingMeter,
  editingId,
  prevRow,
  prevGrid,
  deltaGrid,
  effectiveMultiplier,
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
}: NonSolarPowerFormProps) {
  return (
    <div className="space-y-3">
      {/* Date & Time */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="powersection-date-amp-time-ns">Date &amp; Time</Label>
          <Input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)}
            className="h-10 w-full max-w-[260px] min-w-[220px] block text-center sm:text-left bg-muted/30 border-border/70 text-foreground/80" id="powersection-date-amp-time-ns"/>
        </div>
      </div>

      {/* Dynamic grid meter rows — MobileCarousel on mobile, stacked on desktop */}
      <MobileCarousel
        isMobile={isMobile}
        items={Array.from({ length: gridMeterCount }, (_, i) => i)}
        renderItem={(idx: number) => {
          const meterLabel = getGridLabel(idx);
          const val = gridMeterReadings[idx] ?? '';
          const isFirst = idx === 0;
          const handleChange = (v: string) => { setGridMeterReading(idx, v); if (isFirst) setReading(v); };
          const isSavingThis = savingMeter === `grid-${idx}`;
          const mMult = getGridMeterMult(idx);
          const gmrPrevNS = (prevRow as any)?.grid_meter_readings as Record<string, number> | null | undefined;
          const prevMeterValNS = gmrPrevNS?.[String(idx)] ?? (idx === 0 ? prevGrid : null);
          const gridMeterChanged = val !== '' && (prevMeterValNS == null || +val !== prevMeterValNS);
          const perMeterDelta = gridMeterChanged && prevMeterValNS != null ? +val - prevMeterValNS : null;
          const perMeterEffective = perMeterDelta != null ? perMeterDelta * mMult : null;
          return (
            <div key={`grid-ns-${idx}`} className={isMobile ? 'px-4 py-3 space-y-2' : 'space-y-1'}>
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5">
                  <GridPylonIcon className="h-3 w-3 text-info" />
                  {meterLabel}
                  <span className={`text-3xs font-mono px-1 py-0 rounded ${mMult !== 1 ? 'bg-warn-soft text-warn border border-warn' : 'text-muted-foreground/40'}`}
                    title={`CT multiplier for this meter (configured in Plants → Power). Consumption = Δ × ${mMult}`}>
                    ×{mMult}
                  </span>
                  {isFirst && editingId && <span className="text-xs text-highlight ml-1">(editing)</span>}
                </Label>
                {(isAdmin || isManager || isDataAnalyst) && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={() => setReplaceMeterIdx(idx)} title={`Meter replaced — ${meterLabel}`}>
                    <ChangeMeterIcon className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(isAdmin || isManager || isDataAnalyst) && (
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={() => setPowerHistoryOpen({ type: 'grid', idx })} title={`View ${meterLabel} history`}>
                    <History className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {isMobile ? (
                <>
                  <OdometerRollerInput value={val} onChange={handleChange}
                    alertState={gridMeterChanged ? (perMeterDelta != null && perMeterDelta < 0 ? 'warn' : 'ok') : 'neutral'}
                    disabled={isSavingThis}
                    testId={`power-meter-input-${idx}`} />
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="text-muted-foreground">prev: <span className="font-mono-num">{prevMeterValNS != null ? fmtNum(prevMeterValNS) : '—'}</span>
                      {perMeterDelta != null && <span className={`font-mono-num font-medium ml-1 ${perMeterDelta >= 0 ? 'text-info' : 'text-destructive'}`}>Δ {fmtNum(perMeterDelta)}</span>}
                    </span>
                    {perMeterEffective != null && mMult !== 1 && (
                      <span className="font-mono-num text-warn">{fmtNum(perMeterEffective, 2)} kWh eff.</span>
                    )}
                  </div>
                  <Button disabled={isSavingThis || !gridMeterChanged}
                    onClick={() => submitMeter('grid', idx)}
                    className="w-full h-11 text-sm bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary shadow-sm"
                    data-testid={`power-grid-save-ns-${idx}`}>
                    {isSavingThis ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="any" value={val}
                      onChange={e => handleChange(e.target.value)}
                      placeholder="Grid meter reading"
                      className="border-info focus-visible:ring-info"
                      data-testid={`power-meter-input-${idx}`} />
                    <Button size="sm" disabled={isSavingThis || !gridMeterChanged}
                      onClick={() => submitMeter('grid', idx)}
                      className="shrink-0 h-9 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                      data-testid={`power-grid-save-ns-${idx}`}>
                      {isSavingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                    </Button>
                  </div>
                  {prevMeterValNS != null && (() => {
                    const perMeterEffective = perMeterDelta != null ? perMeterDelta * mMult : null;
                    return (
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
                        <span>
                          Previous: <span className="font-mono-num">{fmtNum(prevMeterValNS)}</span>
                          {perMeterDelta != null && <> · Δ <span className="font-mono-num">{fmtNum(perMeterDelta)}</span></>}
                        </span>
                        {perMeterEffective != null && mMult !== 1 && (
                          <div className="inline-flex items-center gap-1.5 ml-2 rounded bg-warn-soft border border-warn px-2 py-0.5">
                            <Zap className="h-3 w-3 text-warn shrink-0" />
                            <span className="font-mono-num font-medium text-warn">{fmtNum(perMeterEffective, 2)} kWh</span>
                            <span className="text-warn/70">effective (×{mMult})</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
