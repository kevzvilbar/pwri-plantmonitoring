import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnomalyRemarkBanner } from '@/components/AnomalyRemarkBanner';
import { PowerFormHeader } from './components/PowerFormHeader';
import { SolarPowerForm } from './components/SolarPowerForm';
import { NonSolarPowerForm } from './components/NonSolarPowerForm';
import { PowerFormDialogs } from './components/PowerFormDialogs';
import { GridPylonIcon, invalidatePowerDash } from '../shared';
import { usePowerFormState } from './hooks/usePowerFormState';
import { usePowerFormActions } from './hooks/usePowerFormActions';

export function PowerForm() {
  const state = usePowerFormState();
  const actions = usePowerFormActions(state);

  const {
    plantId,
    reading, setReading,
    solarReading, setSolarReading,
    dt, setDt,
    editingId, setEditingId,
    powerHistoryOpen, setPowerHistoryOpen,
    replaceMeterIdx, setReplaceMeterIdx,
    importOpen, setImportOpen,
    gridMeterReadings, setGridMeterReadings,
    solarMeterReadings, setSolarMeterReadings,
    solarInputMode, setSolarInputMode,
    powerAnomaly, setPowerAnomaly,
    anomalyRemark, setAnomalyRemark,
    savingMeter, setSavingMeter,
    setGridMeterReading,
    setSolarMeterReading,
    configLoading, powerConfig,
    gapReasonToday, todayDateStr,
    plant, showSolar,
    solarMeterCount, gridMeterCount,
    getSolarLabel, getGridLabel,
    powerMeterItems,
    configMultiplierArr, getGridMeterMult, effectiveMultiplier,
    deltaGrid, deltaSolar,
    prevGrid, prevSolar, prevRow,
    getLatestGridReading,
    isMobile,
    isAdmin, isManager, isDataAnalyst,
    user,
    plants,
    gridMeterNames,
    qc,
  } = state;

  const { submitMeter, handlePlantChange } = actions;

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-4">
        <PowerFormHeader
          plantId={plantId}
          handlePlantChange={handlePlantChange}
          gapReasonToday={gapReasonToday}
          setGapDialogOpen={() => state.setGapDialogOpen(true)}
          setImportOpen={setImportOpen}
          isAdmin={isAdmin}
          isManager={isManager}
          isDataAnalyst={isDataAnalyst}
          prevRow={prevRow}
        />

        {plantId && (
          <p className="text-xs text-muted-foreground">
            Meter count &amp; names are configured in <strong className="text-foreground/70">Plants → Power</strong>.
          </p>
        )}

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

        {showSolar ? (
          <SolarPowerForm
            isMobile={isMobile}
            dt={dt} setDt={setDt}
            solarMeterCount={solarMeterCount}
            solarMeterReadings={solarMeterReadings}
            setSolarMeterReadings={setSolarMeterReadings}
            setSolarMeterReading={setSolarMeterReading}
            setSolarReading={setSolarReading}
            gridMeterCount={gridMeterCount}
            gridMeterReadings={gridMeterReadings}
            setGridMeterReadings={setGridMeterReadings}
            setGridMeterReading={setGridMeterReading}
            setReading={setReading}
            solarInputMode={solarInputMode}
            savingMeter={savingMeter}
            editingId={editingId}
            prevRow={prevRow}
            prevGrid={prevGrid}
            prevSolar={prevSolar}
            deltaSolar={deltaSolar}
            deltaGrid={deltaGrid}
            effectiveMultiplier={effectiveMultiplier}
            powerMeterItems={powerMeterItems}
            getSolarLabel={getSolarLabel}
            getGridLabel={getGridLabel}
            getLatestGridReading={getLatestGridReading}
            getGridMeterMult={getGridMeterMult}
            configLoading={configLoading}
            isAdmin={isAdmin}
            isManager={isManager}
            isDataAnalyst={isDataAnalyst}
            submitMeter={submitMeter}
            setPowerHistoryOpen={setPowerHistoryOpen}
            setReplaceMeterIdx={setReplaceMeterIdx}
            powerAnomaly={powerAnomaly}
            anomalyRemark={anomalyRemark}
            setAnomalyRemark={setAnomalyRemark}
          />
        ) : (
          <NonSolarPowerForm
            isMobile={isMobile}
            dt={dt} setDt={setDt}
            gridMeterCount={gridMeterCount}
            gridMeterReadings={gridMeterReadings}
            setGridMeterReadings={setGridMeterReadings}
            setGridMeterReading={setGridMeterReading}
            setReading={setReading}
            savingMeter={savingMeter}
            editingId={editingId}
            prevRow={prevRow}
            prevGrid={prevGrid}
            deltaGrid={deltaGrid}
            effectiveMultiplier={effectiveMultiplier}
            getGridLabel={getGridLabel}
            getLatestGridReading={getLatestGridReading}
            getGridMeterMult={getGridMeterMult}
            configLoading={configLoading}
            isAdmin={isAdmin}
            isManager={isManager}
            isDataAnalyst={isDataAnalyst}
            submitMeter={submitMeter}
            setPowerHistoryOpen={setPowerHistoryOpen}
            setReplaceMeterIdx={setReplaceMeterIdx}
          />
        )}

        {editingId && (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => {
              setEditingId(null);
              setReading('');
              setSolarReading('');
              setGridMeterReadings(['', '', '', '', '']);
              setSolarMeterReadings(['', '', '', '', '']);
              setSolarInputMode('raw');
            }}>
              Cancel edit
            </Button>
          </div>
        )}
      </Card>

      <PowerFormDialogs
        importOpen={importOpen} setImportOpen={setImportOpen}
        powerHistoryOpen={powerHistoryOpen} setPowerHistoryOpen={setPowerHistoryOpen}
        replaceMeterIdx={replaceMeterIdx} setReplaceMeterIdx={setReplaceMeterIdx}
        gapDialogOpen={state.gapDialogOpen} setGapDialogOpen={state.setGapDialogOpen}
        gapSaving={state.gapSaving} setGapSaving={state.setGapSaving}
        plantId={plantId}
        plant={plant}
        gridMeterCount={gridMeterCount}
        gridMeterNames={gridMeterNames}
        configMultiplierArr={configMultiplierArr}
        configLoading={configLoading}
        effectiveMultiplier={effectiveMultiplier}
        solarInputMode={solarInputMode}
        plants={plants}
        powerConfig={powerConfig}
        todayDateStr={todayDateStr}
        userId={user?.id ?? null}
        qc={qc}
      />
    </div>
  );
}
