import { useState } from 'react';
import { AfmRow } from '../types';

export interface PretreatmentFormState {
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
  hppTarget: string;
  setHppTarget: (v: string) => void;
  bagsChanged: string;
  setBagsChanged: (v: string) => void;
  remarks: string;
  setRemarks: (v: string) => void;
  anomalyRemarkFeed: string;
  setAnomalyRemarkFeed: (v: string) => void;
  anomalyRemarkPerm: string;
  setAnomalyRemarkPerm: (v: string) => void;
  anomalyRemarkRej: string;
  setAnomalyRemarkRej: (v: string) => void;
  trainOnline: boolean;
  setTrainOnline: (v: boolean) => void;
  offlineStart: string;
  setOfflineStart: (v: string) => void;
  offlineEnd: string;
  setOfflineEnd: (v: string) => void;
  offlineReason: string;
  setOfflineReason: (v: string) => void;
  offlineReasonOther: string;
  setOfflineReasonOther: (v: string) => void;
  confirmBackOnline: boolean;
  setConfirmBackOnline: (v: boolean) => void;
  roValues: Record<string, string>;
  setRoValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  afmSectionStarted: boolean;
  setAfmSectionStarted: (v: boolean) => void;
  boosterHppSectionStarted: boolean;
  setBoosterHppSectionStarted: (v: boolean) => void;
  cartridgeSectionStarted: boolean;
  setCartridgeSectionStarted: (v: boolean) => void;
  afmReasonNeeded: boolean;
  setAfmReasonNeeded: (v: boolean) => void;
  afmUnitReasons: Record<number, { reason: string; custom: string }>;
  setAfmUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  boosterReasonNeeded: boolean;
  setBoosterReasonNeeded: (v: boolean) => void;
  boosterUnitReasons: Record<number, { reason: string; custom: string }>;
  setBoosterUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  hppUnitReason: { reason: string; custom: string };
  setHppUnitReason: (v: { reason: string; custom: string } | ((prev: { reason: string; custom: string }) => { reason: string; custom: string })) => void;
  housingReasonNeeded: boolean;
  setHousingReasonNeeded: (v: boolean) => void;
  cartridgeUnitReasons: Record<number, { reason: string; custom: string }>;
  setCartridgeUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  housingUnitReasons: Record<number, { reason: string; custom: string }>;
  setHousingUnitReasons: (v: Record<number, { reason: string; custom: string }> | ((prev: Record<number, { reason: string; custom: string }>) => Record<number, { reason: string; custom: string }>)) => void;
  roReasonNeeded: boolean;
  setRoReasonNeeded: (v: boolean) => void;
  roIncompleteReason: string;
  setRoIncompleteReason: (v: string) => void;
  afmmf: Record<number, AfmRow>;
  setAfmmf: (v: Record<number, AfmRow>) => void;
  setAfmmfField: (u: number, patch: Partial<AfmRow>) => void;
  boosters: Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>;
  setBoosters: (v: Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>) => void;
  housings: Record<number, { inP: string; outP: string }>;
  setHousings: (v: Record<number, { inP: string; outP: string }>) => void;
  cartridgeHousings: Record<number, { inP: string; outP: string }>;
  setCartridgeHousings: (v: Record<number, { inP: string; outP: string }>) => void;
  boosterPrefPsi: boolean;
  setBoosterPrefPsi: (v: boolean) => void;
  BOOSTER_MODE_KEY: string;
}

const EMPTY_RO_VALUES = {
  feed_pressure_psi: '', reject_pressure_psi: '',
  feed_flow: '', permeate_flow: '', reject_flow: '',
  feed_tds: '', permeate_tds: '', reject_tds: '',
  feed_ph: '', permeate_ph: '', reject_ph: '',
  turbidity_ntu: '', temperature_c: '', suction_pressure_psi: '',
  chlorine_residual_mg_l: '',
  feed_meter_curr: '',
  permeate_meter_curr: '',
  reject_meter_curr: '',
  power_meter_curr: '',
};

export function usePretreatmentFormState(_trainId: string, _train: any): PretreatmentFormState {
  const [syncBwOn, setSyncBwOn] = useState(false);
  const [syncBwStart, setSyncBwStart] = useState('');
  const [syncBwEnd, setSyncBwEnd] = useState('');
  const [syncMeterStart, setSyncMeterStart] = useState('');
  const [syncMeterEnd, setSyncMeterEnd] = useState('');
  const [hppTarget, setHppTarget] = useState('');
  const [bagsChanged, setBagsChanged] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [anomalyRemarkFeed, setAnomalyRemarkFeed] = useState('');
  const [anomalyRemarkPerm, setAnomalyRemarkPerm] = useState('');
  const [anomalyRemarkRej, setAnomalyRemarkRej] = useState('');
  const [trainOnline, setTrainOnline] = useState(true);
  const [offlineStart, setOfflineStart] = useState('');
  const [offlineEnd, setOfflineEnd] = useState('');
  const [offlineReason, setOfflineReason] = useState('');
  const [offlineReasonOther, setOfflineReasonOther] = useState('');
  const [confirmBackOnline, setConfirmBackOnline] = useState(false);
  const [roValues, setRoValues] = useState<Record<string, string>>(EMPTY_RO_VALUES);
  const [afmSectionStarted, setAfmSectionStarted] = useState(false);
  const [boosterHppSectionStarted, setBoosterHppSectionStarted] = useState(false);
  const [cartridgeSectionStarted, setCartridgeSectionStarted] = useState(false);
  const [afmReasonNeeded, setAfmReasonNeeded] = useState(false);
  const [afmUnitReasons, setAfmUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [boosterReasonNeeded, setBoosterReasonNeeded] = useState(false);
  const [boosterUnitReasons, setBoosterUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [hppUnitReason, setHppUnitReason] = useState<{ reason: string; custom: string }>({ reason: '', custom: '' });
  const [housingReasonNeeded, setHousingReasonNeeded] = useState(false);
  const [cartridgeUnitReasons, setCartridgeUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [housingUnitReasons, setHousingUnitReasons] = useState<Record<number, { reason: string; custom: string }>>({});
  const [roReasonNeeded, setRoReasonNeeded] = useState(false);
  const [roIncompleteReason, setRoIncompleteReason] = useState('');
  const [afmmf, setAfmmf] = useState<Record<number, AfmRow>>({});
  const [boosters, setBoosters] = useState<Record<number, { hz: string; target: string; amp: string; psiMode: boolean }>>({});
  const [housings, setHousings] = useState<Record<number, { inP: string; outP: string }>>({});
  const [cartridgeHousings, setCartridgeHousings] = useState<Record<number, { inP: string; outP: string }>>({});
  const BOOSTER_MODE_KEY = 'pwri_booster_target_psi_mode';
  const [boosterPrefPsi, setBoosterPrefPsi] = useState<boolean>(() => {
    try { return localStorage.getItem(BOOSTER_MODE_KEY) !== 'false'; } catch { return true; }
  });

  const setAfmmfField = (u: number, patch: Partial<AfmRow>) => setAfmmf((p) => ({
    ...p,
    [u]: {
      unit: u, bw: false, bwStart: '', bwEnd: '',
      meterStart: '', meterEnd: '', pressureIn: '', pressureOut: '',
      ...(p[u] ?? {}), ...patch,
    },
  }));

  return {
    syncBwOn, setSyncBwOn,
    syncBwStart, setSyncBwStart,
    syncBwEnd, setSyncBwEnd,
    syncMeterStart, setSyncMeterStart,
    syncMeterEnd, setSyncMeterEnd,
    hppTarget, setHppTarget,
    bagsChanged, setBagsChanged,
    remarks, setRemarks,
    anomalyRemarkFeed, setAnomalyRemarkFeed,
    anomalyRemarkPerm, setAnomalyRemarkPerm,
    anomalyRemarkRej, setAnomalyRemarkRej,
    trainOnline, setTrainOnline,
    offlineStart, setOfflineStart,
    offlineEnd, setOfflineEnd,
    offlineReason, setOfflineReason,
    offlineReasonOther, setOfflineReasonOther,
    confirmBackOnline, setConfirmBackOnline,
    roValues, setRoValues,
    afmSectionStarted, setAfmSectionStarted,
    boosterHppSectionStarted, setBoosterHppSectionStarted,
    cartridgeSectionStarted, setCartridgeSectionStarted,
    afmReasonNeeded, setAfmReasonNeeded,
    afmUnitReasons, setAfmUnitReasons,
    boosterReasonNeeded, setBoosterReasonNeeded,
    boosterUnitReasons, setBoosterUnitReasons,
    hppUnitReason, setHppUnitReason,
    housingReasonNeeded, setHousingReasonNeeded,
    cartridgeUnitReasons, setCartridgeUnitReasons,
    housingUnitReasons, setHousingUnitReasons,
    roReasonNeeded, setRoReasonNeeded,
    roIncompleteReason, setRoIncompleteReason,
    afmmf, setAfmmf, setAfmmfField,
    boosters, setBoosters,
    housings, setHousings,
    cartridgeHousings, setCartridgeHousings,
    boosterPrefPsi, setBoosterPrefPsi,
    BOOSTER_MODE_KEY,
  };
}
