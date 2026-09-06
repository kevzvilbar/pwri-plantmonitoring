export type AfmRow = {
  unit: number;
  bw: boolean;
  bwStart: string;
  bwEnd: string;
  meterStart: string;
  meterEnd: string;
  pressureIn: string;
  pressureOut: string;
};

export const AFM_REASON_OPTIONS = [
  'Pressure gauge broken / unreadable',
  'Unit isolated / in bypass',
  'Unit in standby / offline',
  'Under maintenance / media replacement',
  'Differential pressure gauge faulty',
  'Other',
];

export const BOOSTER_REASON_OPTIONS = [
  'Pump in standby / not running',
  'Ammeter broken / unreadable',
  'VFD fault / tripped',
  'Under maintenance / isolated',
  'Pressure transmitter offline',
  'Other',
];

export const STANDARD_OFFLINE_REASONS = [
  'Scheduled Maintenance',
  'Membrane Replacement',
  'CIP In Progress',
  'Power Outage',
  'High Pressure Trip',
  'Low Feed Flow',
  'Instrumentation Fault',
  'Pump Failure',
  'Feedwater Quality Issue',
  'Operator Shutdown',
  'Peak/Off-Peak Program',
];

export const HPP_REASON_OPTIONS = [
  'HPP pressure gauge broken / unreadable',
  'HPP in standby / not running',
  'Pressure transmitter fault',
  'Under maintenance',
  'Other',
];

export const HOUSING_REASON_OPTIONS = [
  'Pressure gauge broken / stuck',
  'Housing bypassed / isolated',
  'Housing in standby',
  'Under maintenance / filter change in progress',
  'Other',
];

export function getUnitReasonText(entry?: { reason: string; custom: string } | string | null) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry.trim();
  if (entry.reason === 'Other') return entry.custom?.trim() || 'Other';
  return entry.reason?.trim() || '';
}
