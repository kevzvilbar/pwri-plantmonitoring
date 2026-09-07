import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useWellRowActions } from './WellRow/useWellRowActions';
import { WellRowHeader } from './WellRow/WellRowHeader';
import { WellRowInputs } from './WellRow/WellRowInputs';
import { WellRowAlerts } from './WellRow/WellRowAlerts';
import { WellRowDialogs } from './WellRow/WellRowDialogs';
import { cn } from '@/lib/utils';

export function WellRow({
  well, plantId, previousMeter, previousPower, previousDt, freshDt, avgVol, todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, canAutoApprove, isInSharedPowerGroup,
  sharedPower, gapReason, onGapReasonSaved, rowRef, pulsing,
}: {
  well: any; plantId: string;
  previousMeter: number | null; previousPower: number | null;
  previousDt: string | null; avgVol: number | null;
  freshDt?: string | null;
  todayReadings: any[]; userId: string | undefined;
  isBlending: boolean; onSaved: () => void;
  isManagerOrAdmin: boolean;
  canAutoApprove: boolean;
  isInSharedPowerGroup: boolean;
  sharedPower?: { groupName: string; primaryWellId: string; previousPower: number | null };
  gapReason?: any | null;
  onGapReasonSaved?: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  pulsing?: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const actions = useWellRowActions({
    well, plantId, previousMeter, previousPower, previousDt, freshDt, avgVol,
    todayReadings, userId, isBlending, onSaved, isManagerOrAdmin, canAutoApprove,
    isInSharedPowerGroup, sharedPower, gapReason, onGapReasonSaved,
  });

  return (
    <div
      ref={rowRef}
      className={cn(
        'instrument-housing overflow-hidden shadow-xs transition-all border border-border/80 rounded-2xl mb-3',
        pulsing ? 'ring-2 ring-accent ring-inset' : '',
      )}
      data-testid={`well-row-${well.id}`}
    >
      <WellRowHeader
        well={well} plantId={plantId}
        todayCount={actions.todayCount} atLimit={actions.atLimit}
        customDt={actions.customDt} onCustomDtChange={actions.setCustomDt}
        dtInputRef={actions.dtInputRef}
        editingId={actions.editingId} lastToday={actions.lastToday}
        onStartEdit={actions.onStartEdit} onCancelEdit={actions.onCancelEdit}
        onShowHistory={() => actions.setShowHistory(true)}
        isManagerOrAdmin={isManagerOrAdmin}
        isBlending={isBlending}
        isInSharedPowerGroup={isInSharedPowerGroup}
        gapReason={gapReason} onGapReasonClick={() => actions.setGapDialogOpen(true)}
        freshDt={freshDt}
        navigate={navigate}
        pulsing={pulsing}
      />
      <WellRowInputs
        well={well} plantId={plantId} isMobile={isMobile}
        reading={actions.reading} onReadingChange={actions.setReading}
        saving={actions.saving} atLimit={actions.atLimit} meterChanged={actions.meterChanged}
        odometerAlert={actions.odometerAlert}
        onSave={actions.save}
        editingId={actions.editingId}
        editReason={actions.editReason} editCustomReason={actions.editCustomReason}
        onEditReasonChange={actions.setEditReason}
        onEditCustomReasonChange={actions.setEditCustomReason}
        meterReplacePending={actions.meterReplacePending}
        onMeterReplaceToggle={(v) => actions.setMeterReplacePending(v ? { newInitialReading: null, replacementId: null } : null)}
        onShowReplaceMeter={() => actions.setShowReplaceMeter(true)}
        previousMeter={previousMeter}
        dailyVol={actions.dailyVol}
        powerReading={actions.powerReading} onPowerReadingChange={actions.setPowerReading}
        savingPower={actions.savingPower} onSavePower={actions.savePower}
        showDedicatedPower={actions.showDedicatedPower}
        previousPower={previousPower}
        sharedPower={sharedPower}
        sharedPowerReading={actions.sharedPowerReading}
        onSharedPowerReadingChange={actions.setSharedPowerReading}
        savingSharedPower={actions.savingSharedPower}
        onSaveSharedPower={actions.saveSharedPower}
        tdsReading={actions.tdsReading} onTdsReadingChange={actions.setTdsReading}
        savingTds={actions.savingTds} onSaveTds={actions.saveTds}
        ntuReading={actions.ntuReading} onNtuReadingChange={actions.setNtuReading}
        savingNtu={actions.savingNtu} onSaveNtu={actions.saveNtu}
        pressureReading={actions.pressureReading} onPressureReadingChange={actions.setPressureReading}
        savingPressure={actions.savingPressure} onSavePressure={actions.savePressure}
        showAnomalyBanner={actions.showAnomalyBanner}
        anomalyRemarkRequired={actions.anomalyRemarkRequired}
      />
      <WellRowAlerts
        reading={actions.reading} belowPrev={actions.belowPrev}
        isRollover={actions.isRollover} onIsRolloverChange={actions.setIsRollover}
        rolloverMax={actions.rolloverMax} onRolloverMaxChange={actions.setRolloverMax}
        defaultRolloverMax={actions.defaultRolloverMax}
        well={well}
        highVol={actions.highVol}
        showAnomalyBanner={actions.showAnomalyBanner}
        anomalyRemark={actions.anomalyRemark}
        onAnomalyRemarkChange={actions.setAnomalyRemark}
        deviationWell={actions.deviationWell}
      />
      <WellRowDialogs
        showHistory={actions.showHistory} onCloseHistory={() => actions.setShowHistory(false)}
        showReplaceMeter={actions.showReplaceMeter} onCloseReplaceMeter={() => actions.setShowReplaceMeter(false)}
        gapDialogOpen={actions.gapDialogOpen} onCloseGapDialog={actions.setGapDialogOpen}
        gapSaving={actions.gapSaving} onSaveGapReason={actions.saveGapReason}
        well={well} plantId={plantId} userId={userId}
        reading={actions.reading} previousMeter={previousMeter}
        onSetReading={actions.setReading}
        meterReplacePending={actions.meterReplacePending}
        onMeterReplacePendingChange={actions.setMeterReplacePending}
      />
    </div>
  );
}
