import { AfmMmfSection } from './AfmMmfSection';
import { BoosterPumpSection } from './BoosterPumpSection';
import { PretreatmentSection } from './PretreatmentSection';
import { usePretreatmentFormState } from '../hooks/usePretreatmentFormState';
import { usePretreatmentData } from '../hooks/usePretreatmentData';

export interface PretreatmentStagesContainerProps {
  train: any;
  isSynchronized: boolean;
  form: ReturnType<typeof usePretreatmentFormState>;
  data: ReturnType<typeof usePretreatmentData>;
  boosterConfig: any;
  cartridgeHousingLabel: string;
  changedElementLabel: string;
}

export function PretreatmentStagesContainer({
  train,
  isSynchronized,
  form,
  data,
  boosterConfig,
  cartridgeHousingLabel,
  changedElementLabel,
}: PretreatmentStagesContainerProps) {
  return (
    <>
      <AfmMmfSection
        train={train}
        isSynchronized={isSynchronized}
        afmmf={form.afmmf}
        setAfmmfField={form.setAfmmfField}
        syncBwOn={form.syncBwOn}
        setSyncBwOn={form.setSyncBwOn}
        syncBwStart={form.syncBwStart}
        setSyncBwStart={form.setSyncBwStart}
        syncBwEnd={form.syncBwEnd}
        setSyncBwEnd={form.setSyncBwEnd}
        syncMeterStart={form.syncMeterStart}
        setSyncMeterStart={form.setSyncMeterStart}
        syncMeterEnd={form.syncMeterEnd}
        setSyncMeterEnd={form.setSyncMeterEnd}
        prevMeterEndByUnit={data.prevMeterEndByUnit}
        afmSectionStarted={form.afmSectionStarted}
        setAfmSectionStarted={form.setAfmSectionStarted}
        afmReasonNeeded={form.afmReasonNeeded}
        setAfmReasonNeeded={form.setAfmReasonNeeded}
        afmUnitReasons={form.afmUnitReasons}
        setAfmUnitReasons={form.setAfmUnitReasons}
      />
      {(form.afmSectionStarted || train.num_afm === 0) && (
        <BoosterPumpSection
          train={train}
          numBoosterPumps={train.num_booster_pumps}
          boosters={form.boosters}
          setBoosters={form.setBoosters}
          boosterConfig={boosterConfig}
          boosterPrefPsi={form.boosterPrefPsi}
          setBoosterPrefPsi={form.setBoosterPrefPsi}
          BOOSTER_MODE_KEY={form.BOOSTER_MODE_KEY}
          hppTarget={form.hppTarget}
          setHppTarget={form.setHppTarget}
          bagsChanged={form.bagsChanged}
          setBagsChanged={form.setBagsChanged}
          boosterHppSectionStarted={form.boosterHppSectionStarted}
          setBoosterHppSectionStarted={form.setBoosterHppSectionStarted}
          boosterReasonNeeded={form.boosterReasonNeeded}
          setBoosterReasonNeeded={form.setBoosterReasonNeeded}
          boosterUnitReasons={form.boosterUnitReasons}
          setBoosterUnitReasons={form.setBoosterUnitReasons}
          hppUnitReason={form.hppUnitReason}
          setHppUnitReason={form.setHppUnitReason}
        />
      )}
      {form.boosterHppSectionStarted && (
        <PretreatmentSection
          train={train}
          numCartridgeFilters={train.num_cartridge_filters}
          numFilterHousings={train.num_filter_housings}
          cartridgeHousings={form.cartridgeHousings}
          setCartridgeHousings={form.setCartridgeHousings}
          housings={form.housings}
          setHousings={form.setHousings}
          cartridgeHousingLabel={cartridgeHousingLabel}
          changedElementLabel={changedElementLabel}
          bagsChanged={form.bagsChanged}
          setBagsChanged={form.setBagsChanged}
          cartridgeSectionStarted={form.cartridgeSectionStarted}
          setCartridgeSectionStarted={form.setCartridgeSectionStarted}
          housingReasonNeeded={form.housingReasonNeeded}
          setHousingReasonNeeded={form.setHousingReasonNeeded}
          cartridgeUnitReasons={form.cartridgeUnitReasons}
          setCartridgeUnitReasons={form.setCartridgeUnitReasons}
          housingUnitReasons={form.housingUnitReasons}
          setHousingUnitReasons={form.setHousingUnitReasons}
        />
      )}
    </>
  );
}
