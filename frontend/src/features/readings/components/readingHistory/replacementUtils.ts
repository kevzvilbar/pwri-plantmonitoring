/* eslint-disable @typescript-eslint/no-explicit-any */
export function numOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = +v;
  return isNaN(n) ? null : n;
}

export function strOrNull(v: any): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

export function meterTypeLabel(meterType: string): string {
  const t = String(meterType);
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} meter`;
}
