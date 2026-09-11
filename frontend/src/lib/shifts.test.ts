import { describe, it, expect } from 'vitest';
import {
  SHIFTS,
  getCurrentShift,
  getShiftCycleKey,
  isShiftConfirmationExpired,
  type ShiftConfirmationRecord,
} from './shifts';

describe('Shift Monitoring & Handover Definitions (shifts.ts)', () => {
  describe('SHIFTS definitions', () => {
    it('defines Shift A as 07:00 – 15:00', () => {
      expect(SHIFTS.A.startHour).toBe(7);
      expect(SHIFTS.A.endHour).toBe(15);
      expect(SHIFTS.A.timeRange).toBe('07:00 – 15:00');
      expect(SHIFTS.A.name).toBe('Shift A (Morning)');
    });

    it('defines Shift B as 15:00 – 23:00', () => {
      expect(SHIFTS.B.startHour).toBe(15);
      expect(SHIFTS.B.endHour).toBe(23);
      expect(SHIFTS.B.timeRange).toBe('15:00 – 23:00');
      expect(SHIFTS.B.name).toBe('Shift B (Afternoon)');
    });

    it('defines Shift C as 23:00 – 07:00', () => {
      expect(SHIFTS.C.startHour).toBe(23);
      expect(SHIFTS.C.endHour).toBe(7);
      expect(SHIFTS.C.timeRange).toBe('23:00 – 07:00');
      expect(SHIFTS.C.name).toBe('Shift C (Graveyard)');
    });
  });

  describe('getCurrentShift', () => {
    it('returns Shift A for times between 07:00 and 14:59', () => {
      const at0700 = new Date('2026-09-12T07:00:00');
      const at1130 = new Date('2026-09-12T11:30:00');
      const at1459 = new Date('2026-09-12T14:59:59');

      expect(getCurrentShift(at0700).code).toBe('A');
      expect(getCurrentShift(at1130).code).toBe('A');
      expect(getCurrentShift(at1459).code).toBe('A');
    });

    it('returns Shift B for times between 15:00 and 22:59', () => {
      const at1500 = new Date('2026-09-12T15:00:00');
      const at1830 = new Date('2026-09-12T18:30:00');
      const at2259 = new Date('2026-09-12T22:59:59');

      expect(getCurrentShift(at1500).code).toBe('B');
      expect(getCurrentShift(at1830).code).toBe('B');
      expect(getCurrentShift(at2259).code).toBe('B');
    });

    it('returns Shift C for night hours (23:00 to 06:59)', () => {
      const at2300 = new Date('2026-09-12T23:00:00');
      const atMidnight = new Date('2026-09-13T00:00:00');
      const at0330 = new Date('2026-09-13T03:30:00');
      const at0659 = new Date('2026-09-13T06:59:59');

      expect(getCurrentShift(at2300).code).toBe('C');
      expect(getCurrentShift(atMidnight).code).toBe('C');
      expect(getCurrentShift(at0330).code).toBe('C');
      expect(getCurrentShift(at0659).code).toBe('C');
    });
  });

  describe('getShiftCycleKey', () => {
    it('generates correct cycle key for Shift A and B on the same calendar day', () => {
      const at0800 = new Date(2026, 8, 12, 8, 0, 0); // 2026-09-12 08:00
      const at1600 = new Date(2026, 8, 12, 16, 0, 0); // 2026-09-12 16:00

      expect(getShiftCycleKey(at0800)).toBe('2026-09-12_Shift_A');
      expect(getShiftCycleKey(at1600)).toBe('2026-09-12_Shift_B');
    });

    it('generates correct cycle key for Shift C spanning midnight to 06:59', () => {
      // 23:30 on Sept 12 -> 2026-09-12_Shift_C
      const at2330 = new Date(2026, 8, 12, 23, 30, 0);
      expect(getShiftCycleKey(at2330)).toBe('2026-09-12_Shift_C');

      // 02:15 on Sept 13 (before 07:00 AM) -> maps back to Sept 12
      const at0215 = new Date(2026, 8, 13, 2, 15, 0);
      expect(getShiftCycleKey(at0215)).toBe('2026-09-12_Shift_C');

      // 06:59 on Sept 13 -> maps back to Sept 12
      const at0659 = new Date(2026, 8, 13, 6, 59, 0);
      expect(getShiftCycleKey(at0659)).toBe('2026-09-12_Shift_C');

      // 07:00 on Sept 13 -> new shift A on Sept 13
      const at0700 = new Date(2026, 8, 13, 7, 0, 0);
      expect(getShiftCycleKey(at0700)).toBe('2026-09-13_Shift_A');
    });
  });

  describe('isShiftConfirmationExpired', () => {
    const cycleKey = '2026-09-12_Shift_A';
    const operatorId = 'op-123';
    const baseDate = new Date('2026-09-12T07:00:00Z');

    it('returns true if no record exists', () => {
      expect(isShiftConfirmationExpired(null, cycleKey, operatorId, baseDate)).toBe(true);
    });

    it('returns true if the shift cycle key changed (e.g. shift transition)', () => {
      const record: ShiftConfirmationRecord = {
        cycleKey: '2026-09-11_Shift_C',
        operatorId,
        confirmedAt: new Date(baseDate.getTime() - 1000 * 60 * 30).toISOString(),
        confirmedBy: 'user@pwri.com',
      };
      expect(isShiftConfirmationExpired(record, cycleKey, operatorId, baseDate)).toBe(true);
    });

    it('returns true if operatorId does not match current active operator', () => {
      const record: ShiftConfirmationRecord = {
        cycleKey,
        operatorId: 'different-operator',
        confirmedAt: new Date(baseDate.getTime() - 1000 * 60 * 30).toISOString(),
        confirmedBy: 'user@pwri.com',
      };
      expect(isShiftConfirmationExpired(record, cycleKey, operatorId, baseDate)).toBe(true);
    });

    it('returns true if more than 8 hours have elapsed since confirmation', () => {
      // 8 hours and 1 minute later
      const confirmedAt = new Date('2026-09-12T07:00:00Z').toISOString();
      const checkTime = new Date('2026-09-12T15:01:00Z');

      const record: ShiftConfirmationRecord = {
        cycleKey,
        operatorId,
        confirmedAt,
        confirmedBy: 'user@pwri.com',
      };
      expect(isShiftConfirmationExpired(record, cycleKey, operatorId, checkTime)).toBe(true);
    });

    it('returns false if record is valid within the 8-hour window and same shift/operator', () => {
      // 4 hours later in the same shift
      const confirmedAt = new Date('2026-09-12T07:00:00Z').toISOString();
      const checkTime = new Date('2026-09-12T11:00:00Z');

      const record: ShiftConfirmationRecord = {
        cycleKey,
        operatorId,
        confirmedAt,
        confirmedBy: 'user@pwri.com',
      };
      expect(isShiftConfirmationExpired(record, cycleKey, operatorId, checkTime)).toBe(false);
    });
  });
});
