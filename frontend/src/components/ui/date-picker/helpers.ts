import { format, parseISO, isValid, isSameDay, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, startOfDay, setHours, setMinutes } from 'date-fns';

export function parseDateValue(val?: string | Date | null): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return isValid(val) ? val : undefined;
  try {
    const parsed = val.includes('T') || val.includes(' ')
      ? new Date(val.replace(' ', 'T'))
      : parseISO(val);
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function formatDateToIso(d?: Date | null): string {
  if (!d || !isValid(d)) return '';
  return format(d, 'yyyy-MM-dd');
}

export function formatDateTimeToIso(d?: Date | null): string {
  if (!d || !isValid(d)) return '';
  return format(d, "yyyy-MM-dd'T'HH:mm");
}
