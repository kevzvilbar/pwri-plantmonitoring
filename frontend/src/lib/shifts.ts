/**
 * PWRI Shift Monitoring & Handover Definitions
 * ─────────────────────────────────────────────
 * Shift A (Morning):    06:00 – 14:00
 * Shift B (Afternoon):  14:00 – 22:00
 * Shift C (Graveyard):  22:00 – 06:00
 */

export type ShiftCode = 'A' | 'B' | 'C';

export interface ShiftInfo {
  code: ShiftCode;
  name: string;
  label: string;
  timeRange: string;
  startHour: number;
  endHour: number;
  tone: 'accent' | 'warn';
}

export const SHIFTS: Record<ShiftCode, ShiftInfo> = {
  A: {
    code: 'A',
    name: 'Shift A (Morning)',
    label: 'Shift A',
    timeRange: '06:00 – 14:00',
    startHour: 6,
    endHour: 14,
    tone: 'accent',
  },
  B: {
    code: 'B',
    name: 'Shift B (Afternoon)',
    label: 'Shift B',
    timeRange: '14:00 – 22:00',
    startHour: 14,
    endHour: 22,
    tone: 'accent',
  },
  C: {
    code: 'C',
    name: 'Shift C (Graveyard)',
    label: 'Shift C',
    timeRange: '22:00 – 06:00',
    startHour: 22,
    endHour: 6,
    tone: 'warn',
  },
};

/** Returns the active shift definition based on the given date/time (default: now) */
export function getCurrentShift(date: Date = new Date()): ShiftInfo {
  const hour = date.getHours();
  if (hour >= 6 && hour < 14) {
    return SHIFTS.A;
  } else if (hour >= 14 && hour < 22) {
    return SHIFTS.B;
  } else {
    return SHIFTS.C;
  }
}

/**
 * Returns a unique cycle key for the shift instance (e.g. `2026-08-30_Shift_A`).
 * For Shift C (which spans midnight), times between 00:00 and 05:59 are mapped
 * back to the date the night shift began.
 */
export function getShiftCycleKey(date: Date = new Date()): string {
  const shift = getCurrentShift(date);
  const d = new Date(date);

  // If we are in Shift C before 6 AM, the shift started on previous calendar day
  if (shift.code === 'C' && d.getHours() < 6) {
    d.setDate(d.getDate() - 1);
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  return `${dateKey}_Shift_${shift.code}`;
}

export interface ShiftConfirmationRecord {
  cycleKey: string;
  operatorId: string;
  confirmedAt: string;
  confirmedBy: string;
}

const STORAGE_PREFIX = 'pwri_shift_confirmation_';

export function getStoredShiftConfirmation(userId: string, operatorId?: string): ShiftConfirmationRecord | null {
  try {
    if (operatorId) {
      const rawOp = localStorage.getItem(`${STORAGE_PREFIX}${userId}_${operatorId}`);
      if (rawOp) return JSON.parse(rawOp);
    }
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveShiftConfirmation(userId: string, record: ShiftConfirmationRecord): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(record));
    if (record.operatorId) {
      localStorage.setItem(`${STORAGE_PREFIX}${userId}_${record.operatorId}`, JSON.stringify(record));
    }
  } catch {
    /* ignore storage errors */
  }
}

