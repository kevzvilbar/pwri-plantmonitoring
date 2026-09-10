import React from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CorrectionReasonField } from '@/components/CorrectionReasonField';
import { OdometerRollerInput, type OdometerAlertState } from '@/components/OdometerRollerInput';
import { Loader2, Zap } from 'lucide-react';
import { fmtNum } from '@/lib/calculations';
import { isReasonComplete } from '@/lib/correctionReasons';
import { cn } from '@/lib/utils';

interface WellRowInputsProps {
  well: any;
  plantId: string;
  isMobile: boolean;
  reading: string;
  onReadingChange: (v: string) => void;
  saving: boolean;
  atLimit: boolean;
  meterChanged: boolean;
  odometerAlert: OdometerAlertState;
  onSave: () => void;
  editingId: string | null;
  editReason: string;
  editCustomReason: string;
  onEditReasonChange: (v: string) => void;
  onEditCustomReasonChange: (v: string) => void;
  meterReplacePending: { newInitialReading: number | null; replacementId: string | null } | null;
  onMeterReplaceToggle: (v: boolean) => void;
  onShowReplaceMeter: () => void;
  previousMeter: number | null;
  dailyVol: number | null;
  powerReading: string;
  onPowerReadingChange: (v: string) => void;
  savingPower: boolean;
  onSavePower: () => void;
  showDedicatedPower: boolean;
  previousPower: number | null;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  sharedPowerReading: string;
  onSharedPowerReadingChange: (v: string) => void;
  savingSharedPower: boolean;
  onSaveSharedPower: () => void;
  tdsReading: string;
  onTdsReadingChange: (v: string) => void;
  savingTds: boolean;
  onSaveTds: () => void;
  ntuReading: string;
  onNtuReadingChange: (v: string) => void;
  savingNtu: boolean;
  onSaveNtu: () => void;
  pressureReading: string;
  onPressureReadingChange: (v: string) => void;
  savingPressure: boolean;
  onSavePressure: () => void;
  showAnomalyBanner: boolean;
  anomalyRemarkRequired: boolean;
}

export function WellRowInputs({
  well, plantId, isMobile, reading, onReadingChange, saving, atLimit, meterChanged,
  odometerAlert, onSave, editingId, editReason, editCustomReason,
  onEditReasonChange, onEditCustomReasonChange,
  meterReplacePending, onMeterReplaceToggle, onShowReplaceMeter,
  previousMeter, dailyVol,
  powerReading, onPowerReadingChange, savingPower, onSavePower, showDedicatedPower, previousPower,
  sharedPower, sharedPowerReading, onSharedPowerReadingChange, savingSharedPower, onSaveSharedPower,
  tdsReading, onTdsReadingChange, savingTds, onSaveTds,
  ntuReading, onNtuReadingChange, savingNtu, onSaveNtu,
  pressureReading, onPressureReadingChange, savingPressure, onSavePressure,
  showAnomalyBanner, anomalyRemarkRequired,
}: WellRowInputsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
      <div className="px-3.5 py-3 space-y-2.5">
        {isMobile ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">Water Meter</p>
              <span className="text-3xs text-muted-foreground">Swipe digits or tap Type</span>
            </div>
            <OdometerRollerInput
              value={reading}
              onChange={(v) => { onReadingChange(v); }}
              alertState={odometerAlert}
              disabled={saving || atLimit}
              testId={`well-meter-input-${well.id}`}
            />
            <div className="flex items-center justify-between text-xs px-1 py-0.5 rounded-md bg-muted/40 border border-border/40">
              <span className="text-muted-foreground text-2xs">
                prev: <span className="font-mono-num font-semibold text-foreground">
                  {previousMeter != null ? fmtNum(previousMeter) : '—'}
                </span>
              </span>
              {dailyVol != null && (
                <span className={cn("font-mono-num font-bold text-2xs", dailyVol < 0 ? "text-destructive" : "text-primary")}>
                  Δ {fmtNum(dailyVol)} m³
                </span>
              )}
            </div>
            <Button
              onClick={onSave} disabled={Boolean(saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason)))}
              className={cn(
                'w-full h-11 text-sm font-bold shadow-sm rounded-xl transition-all',
                meterChanged
                  ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
              )}
              title="Save water meter reading">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Update Meter' : 'Save Water Meter'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0">Water Meter</p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={reading} onChange={e => { onReadingChange(e.target.value); }}
              placeholder={previousMeter != null ? `Prev: ${fmtNum(previousMeter)}` : 'Enter reading'}
              className="h-8 flex-1 min-w-0 text-xs border-border/70 bg-background focus-visible:ring-ring/30 font-mono-num placeholder:text-muted-foreground/50"
              data-testid={`well-meter-input-${well.id}`}
            />
            <Button
              onClick={onSave} disabled={Boolean(saving || !meterChanged || atLimit || (showAnomalyBanner && anomalyRemarkRequired) || (editingId && !isReasonComplete(editReason, editCustomReason)))}
              size="sm"
              className={cn(
                'h-8 px-3.5 shrink-0 text-xs font-semibold shadow-sm transition-all',
                meterChanged
                  ? 'bg-primary hover:bg-primary/90 active:bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground/60 border border-border/40 hover:bg-muted cursor-not-allowed',
              )}
              title="Save water meter reading">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingId ? 'Update' : 'Save'}
            </Button>
          </div>
        )}

        {editingId && (
          <div className="pt-1">
            <CorrectionReasonField
              reason={editReason} onReasonChange={onEditReasonChange}
              customReason={editCustomReason} onCustomReasonChange={onEditCustomReasonChange}
              label="Reason for this edit"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-2xs text-muted-foreground cursor-pointer select-none pt-1">
          <Checkbox
            checked={!!meterReplacePending}
            onCheckedChange={(v) => {
              if (v === true) onShowReplaceMeter();
              else onMeterReplaceToggle(false);
            }}
          />
          <span>Meter replaced</span>
          {meterReplacePending && <span className="text-primary font-bold">— logged</span>}
        </label>

        {showDedicatedPower && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
              <Zap className="h-3 w-3 text-warn" />Grid Meter
            </p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={powerReading} onChange={e => onPowerReadingChange(e.target.value)}
              placeholder={previousPower != null ? `Prev: ${fmtNum(previousPower)}` : 'kWh reading'}
              className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
              data-testid={`well-power-input-${well.id}`}
            />
            <Button
              onClick={onSavePower} disabled={savingPower || !powerReading}
              size="sm"
              className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
              title="Save power meter reading">
              {savingPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        )}

        {sharedPower && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <p className="text-2xs font-bold text-muted-foreground w-24 shrink-0 flex items-center gap-1">
              <Zap className="h-3 w-3 text-warn" />Shared Power
            </p>
            <Input
              type="number" step="any" inputMode="decimal"
              value={sharedPowerReading} onChange={e => onSharedPowerReadingChange(e.target.value)}
              placeholder={sharedPower.previousPower != null ? `Prev: ${fmtNum(sharedPower.previousPower)}` : 'kWh reading'}
              className="h-8 sm:h-7 flex-1 min-w-0 text-xs border-warn/60 bg-warn-soft/30 font-mono-num focus-visible:ring-warn/30 placeholder:text-muted-foreground/50"
              data-testid={`shared-power-input-${sharedPower.primaryWellId}`}
            />
            <Button
              onClick={onSaveSharedPower} disabled={savingSharedPower || !sharedPowerReading}
              size="sm"
              className="h-8 sm:h-7 px-3 shrink-0 bg-warn hover:bg-warn/90 text-white text-xs font-semibold shadow-sm border-0"
              title="Save shared power meter reading">
              {savingSharedPower ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
        )}
      </div>

      <div className="px-3.5 py-3 space-y-2.5 bg-muted/10 sm:bg-transparent">
        <p className="text-3xs font-bold uppercase tracking-wider text-muted-foreground sm:hidden">
          Water Quality &amp; Pressure Telemetry
        </p>

        <div className="flex items-center gap-2">
          <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">TDS</p>
          <div className="relative flex-1 min-w-0">
            <Input
              type="number" step="any" inputMode="decimal"
              value={tdsReading} onChange={e => onTdsReadingChange(e.target.value)}
              placeholder="Enter TDS"
              className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
              data-testid={`well-tds-input-${well.id}`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">ppm</span>
          </div>
          <Button
            onClick={onSaveTds} disabled={savingTds || !tdsReading}
            size="sm" variant="outline"
            className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
            title="Save TDS reading">
            {savingTds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">NTU</p>
          <div className="relative flex-1 min-w-0">
            <Input
              type="number" step="any" inputMode="decimal"
              value={ntuReading} onChange={e => onNtuReadingChange(e.target.value)}
              placeholder="Enter NTU"
              className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
              data-testid={`well-ntu-input-${well.id}`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">NTU</span>
          </div>
          <Button
            onClick={onSaveNtu} disabled={savingNtu || !ntuReading}
            size="sm" variant="outline"
            className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
            title="Save turbidity (NTU) reading">
            {savingNtu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-2xs font-bold text-muted-foreground w-16 shrink-0">Pressure</p>
          <div className="relative flex-1 min-w-0">
            <Input
              type="number" step="any" inputMode="decimal"
              value={pressureReading} onChange={e => onPressureReadingChange(e.target.value)}
              placeholder="Enter pressure"
              className="h-8 sm:h-7 text-xs pr-10 border-border/70 bg-background focus-visible:ring-ring/20 font-mono-num placeholder:text-muted-foreground/40"
              data-testid={`well-pressure-input-${well.id}`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-3xs font-semibold text-muted-foreground pointer-events-none">psi</span>
          </div>
          <Button
            onClick={onSavePressure} disabled={savingPressure || !pressureReading}
            size="sm" variant="outline"
            className="h-8 sm:h-7 px-3 text-xs shrink-0 font-semibold border-border/70"
            title="Save pressure reading">
            {savingPressure ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
