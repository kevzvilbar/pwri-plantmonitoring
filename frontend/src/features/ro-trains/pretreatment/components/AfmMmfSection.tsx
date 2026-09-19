import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/ui/date-picker';
import { ComputedInput } from '@/components/ComputedInput';
import { cn } from '@/lib/utils';
import { AfmRow, AFM_REASON_OPTIONS, getUnitReasonText } from '../types';
import { PerUnitReasonRow } from './PerUnitReasonRow';

export interface AfmMmfSectionProps {
  train: any;
  isSynchronized: boolean;
  afmmf: Record<number, AfmRow>;
  setAfmmfField: (u: number, patch: Partial<AfmRow>) => void;
  syncBwOn: boolean;
  setSyncBwOn: (v: boolean) => void;
  syncBwStart: string;
  setSyncBwStart: (v: string) => void;
  syncBwEnd: string;
  setSyncBwEnd: (v: string) => void;
  syncMeterStart: string;
  setSyncMeterStart: (v: string) => void;
  syncMeterEnd: string;
  setSyncMeterEnd: (v: string) => void;
  prevMeterEndByUnit: Record<number, number | null>;
  afmSectionStarted: boolean;
  setAfmSectionStarted: (v: boolean) => void;
  afmReasonNeeded: boolean;
  setAfmReasonNeeded: (v: boolean) => void;
  afmUnitReasons: Record<number, { reason: string; custom: string }>;
  setAfmUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
}

export function AfmMmfSection({
  train,
  isSynchronized,
  afmmf,
  setAfmmfField,
  syncBwOn,
  setSyncBwOn,
  syncBwStart,
  setSyncBwStart,
  syncBwEnd,
  setSyncBwEnd,
  syncMeterStart,
  setSyncMeterStart,
  syncMeterEnd,
  setSyncMeterEnd,
  prevMeterEndByUnit,
  afmSectionStarted,
  setAfmSectionStarted,
  afmReasonNeeded,
  setAfmReasonNeeded,
  afmUnitReasons,
  setAfmUnitReasons,
}: AfmMmfSectionProps) {
  return (
    <>
      {isSynchronized && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox id="sync-bw" checked={syncBwOn} onCheckedChange={(c) => setSyncBwOn(!!c)} className="shrink-0 h-4 w-4" />
            <Label htmlFor="sync-bw" className="text-sm font-semibold cursor-pointer">Train Backwash Performed?</Label>
          </div>
          {syncBwOn && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="pretreat-started" className="text-xs font-medium text-muted-foreground">Started</Label>
                  <DateTimePicker
                    value={syncBwStart}
                    onChange={(val) => setSyncBwStart(val)}
                    placeholder="Select start time..."
                    size="sm"
                    className="w-full font-mono-num"
                    id="pretreat-started"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pretreat-ended" className="text-xs font-medium text-muted-foreground">Ended</Label>
                  <DateTimePicker
                    value={syncBwEnd}
                    onChange={(val) => setSyncBwEnd(val)}
                    placeholder="Select end time..."
                    size="sm"
                    className="w-full font-mono-num"
                    id="pretreat-ended"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="pretreat-meter-reading-start" className="text-xs text-muted-foreground">Meter Reading Start</Label>
                  <Input type="number" step="any" value={syncMeterStart}
                    onChange={(e) => setSyncMeterStart(e.target.value)}
                    placeholder="From Previous Backwash End" id="pretreat-meter-reading-start"/>
                </div>
                <div>
                  <Label htmlFor="pretreat-meter-reading-end" className="text-xs text-muted-foreground">Meter Reading End</Label>
                  <Input type="number" step="any" value={syncMeterEnd} onChange={(e) => setSyncMeterEnd(e.target.value)} id="pretreat-meter-reading-end"/>
                </div>
              </div>
              <p className="text-2xs text-muted-foreground">All AFM/MMF Units Share These Values During Backwash. Start Value Pre-Filled From Previous Backwash End — Edit If Needed.</p>
            </>
          )}
        </Card>
      )}

      {train.num_afm > 0 && (
        <Card className="p-3 space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">AFM/MMF Units ({train.num_afm})</h4>
          <div className="space-y-2">
            {Array.from({ length: train.num_afm }, (_, i) => i + 1).map((u) => {
              const row = afmmf[u] ?? { unit: u, bw: false, bwStart: '', bwEnd: '', meterStart: '', meterEnd: '', pressureIn: '', pressureOut: '' };
              const pIn = row.pressureIn ? +row.pressureIn : null;
              const pOut = row.pressureOut ? +row.pressureOut : null;
              const afmDp = pIn !== null && pOut !== null ? (pIn - pOut).toFixed(2) : '';
              const dpWarn = afmDp && +afmDp >= 40;
              const bwOngoing = isSynchronized ? syncBwOn : row.bw;
              const prevEnd = prevMeterEndByUnit[u];
              const meterStartValue = row.meterStart !== '' ? row.meterStart : (prevEnd != null ? String(prevEnd) : '');
              const msVal = isSynchronized ? (row.meterStart || syncMeterStart) : row.meterStart;
              const meVal = isSynchronized ? (row.meterEnd || syncMeterEnd) : row.meterEnd;
              const isUnitComplete = bwOngoing ? !!(msVal && meVal) : !!(row.pressureIn && row.pressureOut);
              return (
                <div key={u} className="border rounded-md p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">AFM/MMF {u}</div>
                    {!isSynchronized && (
                      <div className="flex items-center gap-2">
                        <Checkbox id={`bw-${u}`} checked={row.bw} onCheckedChange={(c) => setAfmmfField(u, { bw: !!c })} className="shrink-0 h-4 w-4" />
                        <Label htmlFor={`bw-${u}`} className="text-xs cursor-pointer">Backwash On</Label>
                      </div>
                    )}
                  </div>

                  {bwOngoing ? (
                    <div className="space-y-2 bg-muted/30 rounded p-2">
                      {!isSynchronized && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor={`pretreat-started-u${u}`} className="text-xs font-medium text-muted-foreground">Started</Label>
                            <DateTimePicker
                              value={row.bwStart}
                              onChange={(val) => setAfmmfField(u, { bwStart: val })}
                              placeholder="Select start time..."
                              size="sm"
                              className="w-full font-mono-num"
                              id={`pretreat-started-u${u}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`pretreat-ended-u${u}`} className="text-xs font-medium text-muted-foreground">Ended</Label>
                            <DateTimePicker
                              value={row.bwEnd}
                              onChange={(val) => setAfmmfField(u, { bwEnd: val })}
                              placeholder="Select end time..."
                              size="sm"
                              className="w-full font-mono-num"
                              id={`pretreat-ended-u${u}`}
                            />
                          </div>
                        </div>
                      )}
                      {isSynchronized ? (
                        <p className="text-2xs text-muted-foreground">
                          Train-Wide Backwash {syncBwStart || '—'} → {syncBwEnd || '—'} · Meter {syncMeterStart || '—'} → {syncMeterEnd || '—'}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <Label htmlFor="pretreat-meter-reading-start-2" className="text-xs text-muted-foreground">Meter Reading Start</Label>
                            <Input type="number" step="any" value={meterStartValue}
                              onChange={(e) => setAfmmfField(u, { meterStart: e.target.value })}
                              placeholder={prevEnd != null ? String(prevEnd) : 'From Previous Backwash End'} id="pretreat-meter-reading-start-2"/>
                            {prevEnd != null && (
                              <p className="text-2xs text-muted-foreground mt-0.5">Previous End: {prevEnd} (Editable)</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="pretreat-meter-reading-end-2" className="text-xs text-muted-foreground">Meter Reading End</Label>
                            <Input type="number" step="any" value={row.meterEnd}
                              onChange={(e) => setAfmmfField(u, { meterEnd: e.target.value })} id="pretreat-meter-reading-end-2"/>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label htmlFor="pretreat-pressure-in-psi" className="text-xs text-muted-foreground">Pressure In (psi)</Label>
                        <Input type="number" step="any" value={row.pressureIn}
                          onChange={(e) => setAfmmfField(u, { pressureIn: e.target.value })} id="pretreat-pressure-in-psi"/>
                      </div>
                      <div>
                        <Label htmlFor="pretreat-pressure-out-psi" className="text-xs text-muted-foreground">Pressure Out (psi)</Label>
                        <Input type="number" step="any" value={row.pressureOut}
                          onChange={(e) => setAfmmfField(u, { pressureOut: e.target.value })} id="pretreat-pressure-out-psi"/>
                      </div>
                      <div>
                        <Label htmlFor="pretreat-pressure" className="text-xs text-muted-foreground">ΔPressure</Label>
                        <ComputedInput value={afmDp} className={dpWarn ? 'border-danger text-danger font-semibold' : 'text-foreground font-medium'} id="pretreat-pressure"/>
                      </div>
                    </div>
                  )}

                  {afmReasonNeeded && !isUnitComplete && (
                    <PerUnitReasonRow
                      unitLabel={`AFM/MMF ${u}`}
                      options={AFM_REASON_OPTIONS}
                      value={afmUnitReasons[u]?.reason}
                      customValue={afmUnitReasons[u]?.custom}
                      onChange={(val) => setAfmUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                        ...prev,
                        [u]: { reason: val, custom: val === 'Other' ? (prev[u]?.custom || '') : '' }
                      }))}
                      onCustomChange={(val) => setAfmUnitReasons((prev: Record<number, { reason: string; custom: string }>) => ({
                        ...prev,
                        [u]: { reason: prev[u]?.reason || 'Other', custom: val }
                      }))}
                      onApplyAll={() => {
                        const cur = afmUnitReasons[u];
                        if (!cur?.reason) {
                          toast.error(`Select a reason for AFM/MMF ${u} first before applying to all.`);
                          return;
                        }
                        const next = { ...afmUnitReasons };
                        Array.from({ length: train.num_afm }, (_, i) => i + 1).forEach((idx) => {
                          const r = afmmf[idx];
                          const bw = isSynchronized ? syncBwOn : r?.bw;
                          const ms = isSynchronized ? (r?.meterStart || syncMeterStart) : r?.meterStart;
                          const me = isSynchronized ? (r?.meterEnd || syncMeterEnd) : r?.meterEnd;
                          const isComplete = bw ? !!(ms && me) : !!(r?.pressureIn && r?.pressureOut);
                          if (!isComplete) {
                            next[idx] = { ...cur };
                          }
                        });
                        setAfmUnitReasons(next);
                        toast.success('Applied reason to all incomplete AFM/MMF units.');
                      }}
                      applyAllLabel="Apply reason to all incomplete AFM/MMFs"
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!afmSectionStarted && (
            <div className="pt-1 border-t border-border/40">
              <Button
                type="button"
                size="sm"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                onClick={() => {
                  if (train.num_afm > 0) {
                    const incompleteUnits: number[] = [];
                    const unreasonedUnits: number[] = [];

                    Array.from({ length: train.num_afm }, (_, i) => i + 1).forEach((u) => {
                      const row = afmmf[u];
                      const bwOn = isSynchronized ? syncBwOn : row?.bw;
                      const msVal = isSynchronized ? (row?.meterStart || syncMeterStart) : row?.meterStart;
                      const meVal = isSynchronized ? (row?.meterEnd || syncMeterEnd) : row?.meterEnd;
                      const isComplete = bwOn ? !!(msVal && meVal) : !!(row?.pressureIn && row?.pressureOut);
                      if (!isComplete) {
                        incompleteUnits.push(u);
                        const reasonTxt = getUnitReasonText(afmUnitReasons[u]);
                        if (!reasonTxt) {
                          unreasonedUnits.push(u);
                        }
                      }
                    });

                    if (incompleteUnits.length > 0) {
                      setAfmReasonNeeded(true);
                      if (unreasonedUnits.length > 0) {
                        toast.error(
                          `AFM/MMF unit(s) ${unreasonedUnits.join(', ')} missing reading: please specify a reason for each incomplete unit.`,
                        );
                        return;
                      }
                      toast.error(
                        `AFM/MMF unit(s) ${incompleteUnits.join(', ')} incomplete.`,
                      );
                      return;
                    }
                  }
                  setAfmSectionStarted(true);
                }}
              >
                Proceed to Booster Pump and HPP →
              </Button>
              <p className="text-2xs text-muted-foreground text-center mt-1">
                Fill in every AFM/MMF field above, or provide a reason for incomplete units to proceed.
              </p>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
