import { describe, it, expect } from 'vitest';
import {
  computeDrawdown,
  getSurveyAgeDays,
  isSurveyDue,
  getMissingCoreFields,
  getHydraulicStatus,
  getHydraulicStatusMeta,
  computeSurveyDelta,
  SURVEY_INTERVAL_DAYS,
} from './hydraulics';

describe('hydraulics library', () => {
  describe('computeDrawdown', () => {
    it('returns difference when PWL and SWL are valid numbers', () => {
      expect(computeDrawdown(35.5, 12.2)).toBe(23.3);
      expect(computeDrawdown('40.0', '10.5')).toBe(29.5);
      expect(computeDrawdown(15, 15)).toBe(0);
    });

    it('returns null if either or both are null, undefined or empty string', () => {
      expect(computeDrawdown(null, 10)).toBeNull();
      expect(computeDrawdown(20, null)).toBeNull();
      expect(computeDrawdown(undefined, undefined)).toBeNull();
      expect(computeDrawdown('', 10)).toBeNull();
      expect(computeDrawdown('abc', 10)).toBeNull();
    });
  });

  describe('getSurveyAgeDays and isSurveyDue', () => {
    const refDate = new Date('2026-06-01T00:00:00Z');

    it('returns accurate age in days', () => {
      expect(getSurveyAgeDays('2026-05-22', refDate)).toBe(10);
      expect(getSurveyAgeDays('2026-03-03', refDate)).toBe(90);
      expect(getSurveyAgeDays('2026-01-01', refDate)).toBe(151);
    });

    it('handles null/invalid dates gracefully', () => {
      expect(getSurveyAgeDays(null)).toBeNull();
      expect(getSurveyAgeDays('')).toBeNull();
      expect(getSurveyAgeDays('invalid-date')).toBeNull();
      expect(isSurveyDue(null)).toBe(false);
      expect(isSurveyDue('invalid-date')).toBe(false);
    });

    it('determines survey due threshold accurately (> 90 days)', () => {
      expect(isSurveyDue('2026-03-03', SURVEY_INTERVAL_DAYS, refDate)).toBe(false); // 90 days is not > 90
      expect(isSurveyDue('2026-03-02', SURVEY_INTERVAL_DAYS, refDate)).toBe(true); // 91 days is > 90
      expect(isSurveyDue('2026-05-01', SURVEY_INTERVAL_DAYS, refDate)).toBe(false); // 31 days
    });
  });

  describe('getMissingCoreFields', () => {
    it('identifies missing fields when record is null or missing items', () => {
      const allMissing = getMissingCoreFields(null);
      expect(allMissing.length).toBe(7);

      const partial = {
        drilling_depth_m: 100,
        static_water_level_m: 12,
        pumping_water_level_m: 25,
        pump_setting: '40m',
        motor_hp: 15,
      };
      const missing = getMissingCoreFields(partial);
      expect(missing.map((m) => m.key)).toEqual(['tds_ppm', 'turbidity_ntu']);
    });

    it('uses fallback drilling depth from well if record lacks it', () => {
      const record = {
        static_water_level_m: 12,
        pumping_water_level_m: 25,
        pump_setting: '40m',
        motor_hp: 15,
        tds_ppm: 350,
        turbidity_ntu: 1.2,
      };
      // with well fallback drilling depth
      expect(getMissingCoreFields(record, 120)).toEqual([]);
      // without fallback
      expect(getMissingCoreFields(record, null).map((m) => m.key)).toEqual(['drilling_depth_m']);
    });
  });

  describe('getHydraulicStatus and getHydraulicStatusMeta', () => {
    const refDate = new Date('2026-06-01T00:00:00Z');

    it('identifies no_survey', () => {
      expect(getHydraulicStatus(null)).toBe('no_survey');
      const meta = getHydraulicStatusMeta('no_survey');
      expect(meta.label).toBe('No Survey Logged');
    });

    it('identifies incomplete surveys', () => {
      const incomplete = {
        date_gathered: '2026-05-15',
        static_water_level_m: 15,
      };
      expect(getHydraulicStatus(incomplete, 100, refDate)).toBe('incomplete');
      const meta = getHydraulicStatusMeta('incomplete', null, 5);
      expect(meta.label).toContain('Incomplete (5 missing)');
    });

    it('identifies overdue surveys', () => {
      const overdue = {
        date_gathered: '2026-01-01', // > 90 days
        drilling_depth_m: 100,
        static_water_level_m: 10,
        pumping_water_level_m: 30,
        pump_setting: '45m',
        motor_hp: 20,
        tds_ppm: 250,
        turbidity_ntu: 0.8,
      };
      expect(getHydraulicStatus(overdue, null, refDate)).toBe('overdue');
      const meta = getHydraulicStatusMeta('overdue', 151);
      expect(meta.label).toContain('Survey Due (151d ago)');
    });

    it('identifies ok / up to date surveys', () => {
      const upToDate = {
        date_gathered: '2026-05-10', // 22 days ago
        drilling_depth_m: 100,
        static_water_level_m: 10,
        pumping_water_level_m: 30,
        pump_setting: '45m',
        motor_hp: 20,
        tds_ppm: 250,
        turbidity_ntu: 0.8,
      };
      expect(getHydraulicStatus(upToDate, null, refDate)).toBe('ok');
      const meta = getHydraulicStatusMeta('ok');
      expect(meta.label).toBe('Up to Date');
    });
  });

  describe('computeSurveyDelta', () => {
    it('computes correct differences between latest and previous survey', () => {
      const latest = {
        static_water_level_m: 15.5,
        pumping_water_level_m: 35.0,
        tds_ppm: 420,
        turbidity_ntu: 1.5,
      };
      const prev = {
        static_water_level_m: 14.0,
        pumping_water_level_m: 32.0,
        tds_ppm: 400,
        turbidity_ntu: 1.2,
      };

      const delta = computeSurveyDelta(latest, prev);
      expect(delta.swlDelta).toBe(1.5);
      expect(delta.pwlDelta).toBe(3.0);
      expect(delta.drawdownDelta).toBe(1.5); // latest dd = 19.5, prev dd = 18.0 => +1.5
      expect(delta.tdsDelta).toBe(20);
      expect(delta.turbidityDelta).toBe(0.3);
    });

    it('returns all nulls if latest or previous is missing', () => {
      expect(computeSurveyDelta(null, null)).toEqual({
        swlDelta: null,
        pwlDelta: null,
        drawdownDelta: null,
        tdsDelta: null,
        turbidityDelta: null,
      });
    });
  });
});
