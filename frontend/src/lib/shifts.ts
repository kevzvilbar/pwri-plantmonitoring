/**
 * PWRI Shift Monitoring & Handover Definitions
 * ─────────────────────────────────────────────
 * Shift A (Morning):    07:00 – 15:00
 * Shift B (Afternoon):  15:00 – 23:00
 * Shift C (Graveyard):  23:00 – 07:00
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
    timeRange: '07:00 – 15:00',
    startHour: 7,
    endHour: 15,
    tone: 'accent',
  },
  B: {
    code: 'B',
    name: 'Shift B (Afternoon)',
    label: 'Shift B',
    timeRange: '15:00 – 23:00',
    startHour: 15,
    endHour: 23,
    tone: 'accent',
  },
  C: {
    code: 'C',
    name: 'Shift C (Graveyard)',
    label: 'Shift C',
    timeRange: '23:00 – 07:00',
    startHour: 23,
    endHour: 7,
    tone: 'warn',
  },
};

/** Returns the active shift definition based on the given date/time (default: now) */
export function getCurrentShift(date: Date = new Date()): ShiftInfo {
  const hour = date.getHours();
  if (hour >= 7 && hour < 15) {
    return SHIFTS.A;
  } else if (hour >= 15 && hour < 23) {
    return SHIFTS.B;
  } else {
    return SHIFTS.C;
  }
}

/**
 * Returns a unique cycle key for the shift instance (e.g. `2026-08-30_Shift_A`).
 * For Shift C (which spans midnight), times between 00:00 and 06:59 are mapped
 * back to the date the night shift began.
 */
export function getShiftCycleKey(date: Date = new Date()): string {
  const shift = getCurrentShift(date);
  const d = new Date(date);

  // If we are in Shift C before 7 AM, the shift started on previous calendar day
  if (shift.code === 'C' && d.getHours() < 7) {
    d.setDate(d.getDate() - 1);
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  return `${dateKey}_Shift_${shift.code}`;
}

export const MAX_SHIFT_DURATION_HOURS = 8;

/**
 * Checks whether an operator's stored confirmation is expired:
 * - Missing record
 * - Different shift cycle (e.g. moved past 07:00, 15:00, or 23:00)
 * - Different operator ID
 * - More than 8 hours elapsed since last confirmation
 */
export function isShiftConfirmationExpired(
  record: ShiftConfirmationRecord | null,
  currentCycleKey: string,
  currentOperatorId: string,
  now: Date = new Date(),
  maxHours: number = MAX_SHIFT_DURATION_HOURS
): boolean {
  if (!record) return true;
  if (record.cycleKey !== currentCycleKey) return true;
  if (record.operatorId !== currentOperatorId) return true;
  if (!record.confirmedAt) return true;

  const elapsedMs = now.getTime() - new Date(record.confirmedAt).getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  return elapsedHours >= maxHours;
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

