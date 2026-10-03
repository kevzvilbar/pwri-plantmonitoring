import { differenceInDays, parseISO } from 'date-fns';

export const SURVEY_INTERVAL_DAYS = 90;

export type HydraulicStatus = 'ok' | 'overdue' | 'incomplete' | 'no_survey';

export interface PmsSurveyRecord {
  id?: string;
  well_id?: string;
  plant_id?: string;
  date_gathered?: string | null;
  drilling_depth_m?: number | null;
  static_water_level_m?: number | null;
  pumping_water_level_m?: number | null;
  pump_setting?: string | null;
  motor_hp?: number | null;
  tds_ppm?: number | null;
  turbidity_ntu?: number | null;
  remarks?: string | null;
  record_type?: string | null;
  created_at?: string | null;
  recorded_by?: string | null;
}

export interface HydraulicCoreField {
  readonly key: string;
  readonly label: string;
  readonly unit?: string;
}

export const CORE_SURVEY_FIELDS: readonly HydraulicCoreField[] = [
  { key: 'drilling_depth_m', label: 'Drilling Depth', unit: 'm' },
  { key: 'static_water_level_m', label: 'Static Level (SWL)', unit: 'm' },
  { key: 'pumping_water_level_m', label: 'Pumping Level (PWL)', unit: 'm' },
  { key: 'pump_setting', label: 'Pump Setting' },
  { key: 'motor_hp', label: 'Motor HP', unit: 'HP' },
  { key: 'tds_ppm', label: 'TDS (PMS)', unit: 'ppm' },
  { key: 'turbidity_ntu', label: 'Turbidity', unit: 'NTU' },
];

/**
 * Calculates Drawdown (PWL − SWL) in meters.
 * Returns null if either value is missing or not a valid finite number.
 */
export function computeDrawdown(
  pwl?: number | string | null,
  swl?: number | string | null,
): number | null {
  if (pwl == null || swl == null || pwl === '' || swl === '') return null;
  const numPwl = typeof pwl === 'number' ? pwl : Number(pwl);
  const numSwl = typeof swl === 'number' ? swl : Number(swl);
  if (!Number.isFinite(numPwl) || !Number.isFinite(numSwl)) return null;
  return +(numPwl - numSwl).toFixed(2);
}

/**
 * Calculates the age of a survey in days compared to reference date (default: now).
 */
export function getSurveyAgeDays(
  dateGathered?: string | Date | null,
  now: Date | string | number = new Date(),
): number | null {
  if (!dateGathered) return null;
  const dateObj = typeof dateGathered === 'string' ? parseISO(dateGathered) : dateGathered;
  if (isNaN(dateObj.getTime())) return null;
  const nowDate = typeof now === 'object' && now instanceof Date ? now : new Date(now);
  return differenceInDays(nowDate, dateObj);
}

/**
 * Checks whether a hydraulic survey is due (> 90 days old by default).
 */
export function isSurveyDue(
  dateGathered?: string | Date | null,
  intervalDays = SURVEY_INTERVAL_DAYS,
  now: Date | string | number = new Date(),
): boolean {
  const age = getSurveyAgeDays(dateGathered, now);
  return age != null && age > intervalDays;
}

/**
 * Identifies missing core survey fields for a well hydraulic record.
 */
export function getMissingCoreFields(
  record?: PmsSurveyRecord | null,
  drillingDepth?: number | string | null,
): { key: string; label: string }[] {
  if (!record) {
    return CORE_SURVEY_FIELDS.map((f) => ({ key: f.key, label: f.label }));
  }

  const effectiveDrillingDepth = record.drilling_depth_m ?? drillingDepth;

  const checks: Record<string, unknown> = {
    drilling_depth_m: effectiveDrillingDepth,
    static_water_level_m: record.static_water_level_m,
    pumping_water_level_m: record.pumping_water_level_m,
    pump_setting: record.pump_setting,
    motor_hp: record.motor_hp,
    tds_ppm: record.tds_ppm,
    turbidity_ntu: record.turbidity_ntu,
  };

  return CORE_SURVEY_FIELDS.filter((f) => {
    const val = checks[f.key];
    return val == null || val === '';
  }).map((f) => ({ key: f.key, label: f.label }));
}

/**
 * Determines the high-level hydraulic compliance status of a well.
 */
export function getHydraulicStatus(
  record?: PmsSurveyRecord | null,
  drillingDepth?: number | string | null,
  now: Date | string | number = new Date(),
): HydraulicStatus {
  if (!record) return 'no_survey';
  const missing = getMissingCoreFields(record, drillingDepth);
  if (missing.length > 0) return 'incomplete';
  if (isSurveyDue(record.date_gathered, SURVEY_INTERVAL_DAYS, now)) return 'overdue';
  return 'ok';
}

export interface HydraulicStatusMeta {
  status: HydraulicStatus;
  label: string;
  badgeClass: string;
  description: string;
}

export function getHydraulicStatusMeta(
  status: HydraulicStatus,
  ageDays?: number | null,
  missingCount?: number,
): HydraulicStatusMeta {
  switch (status) {
    case 'no_survey':
      return {
        status,
        label: 'No Survey Logged',
        badgeClass: 'text-destructive bg-destructive/10 border-destructive/20',
        description: 'No hydraulic survey has been logged yet for this well.',
      };
    case 'incomplete':
      return {
        status,
        label: `Incomplete (${missingCount ?? 1} missing)`,
        badgeClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
        description: 'Core survey measurements are missing.',
      };
    case 'overdue':
      return {
        status,
        label: `Survey Due (${ageDays ?? SURVEY_INTERVAL_DAYS}d ago)`,
        badgeClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
        description: `Last survey was recorded >${SURVEY_INTERVAL_DAYS} days ago.`,
      };
    case 'ok':
      return {
        status,
        label: 'Up to Date',
        badgeClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        description: 'Hydraulic survey is complete and recent.',
      };
  }
}

export interface SurveyDelta {
  swlDelta: number | null;
  pwlDelta: number | null;
  drawdownDelta: number | null;
  tdsDelta: number | null;
  turbidityDelta: number | null;
}

export function computeSurveyDelta(
  latest?: PmsSurveyRecord | null,
  previous?: PmsSurveyRecord | null,
): SurveyDelta {
  if (!latest || !previous) {
    return {
      swlDelta: null,
      pwlDelta: null,
      drawdownDelta: null,
      tdsDelta: null,
      turbidityDelta: null,
    };
  }

  const latestDrawdown = computeDrawdown(latest.pumping_water_level_m, latest.static_water_level_m);
  const prevDrawdown = computeDrawdown(previous.pumping_water_level_m, previous.static_water_level_m);

  const delta = (curr?: number | null, prev?: number | null): number | null => {
    if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev)) return null;
    return +(curr - prev).toFixed(2);
  };

  return {
    swlDelta: delta(latest.static_water_level_m, previous.static_water_level_m),
    pwlDelta: delta(latest.pumping_water_level_m, previous.pumping_water_level_m),
    drawdownDelta: delta(latestDrawdown, prevDrawdown),
    tdsDelta: delta(latest.tds_ppm, previous.tds_ppm),
    turbidityDelta: delta(latest.turbidity_ntu, previous.turbidity_ntu),
  };
}

export interface WellHydraulicSummary {
  wellId: string;
  wellName: string;
  plantId: string;
  plantName: string;
  drillingDepth: number | string | null;
  latestSurvey: PmsSurveyRecord | null;
  previousSurvey: PmsSurveyRecord | null;
  allSurveysCount: number;
  daysSinceSurvey: number | null;
  isSurveyDue: boolean;
  drawdown: number | null;
  swl: number | null;
  pwl: number | null;
  pumpSetting: string | null;
  motorHp: number | null;
  surveyTds: number | null;
  surveyTurbidity: number | null;
  surveyDate: string | null;
  missingCoreFields: { key: string; label: string }[];
  status: HydraulicStatus;
  statusMeta: HydraulicStatusMeta;
  delta: SurveyDelta;
  livePressure: number | null;
  livePressureDate: string | null;
  liveTds: number | null;
  liveTdsDate: string | null;
}
