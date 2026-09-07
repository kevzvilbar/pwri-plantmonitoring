import { format } from 'date-fns';

export function fillDateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso   + 'T00:00:00');
  while (cur <= end) {
    dates.push(format(cur, 'yyyy-MM-dd'));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function fmtDateKey(key: string): string {
  return format(new Date(key + 'T00:00:00'), 'MMM d');
}
