/**
 * CSV export helper with protection against CSV Formula Injection (CWE-1236).
 * Produces a downloadable .csv from rows of records or structured headers/data.
 */

export function escapeCSVField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);

  // Prevent spreadsheet formula execution if string starts with formula triggers (=, +, -, @, tab, CR, pipe, percent)
  if (/^[=+\-@\t\r|%]/.test(s)) {
    s = `'${s}`;
  }

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateCSVString(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const headerLine = headers.map(escapeCSVField).join(',');
  const rowLines = rows.map((r) => r.map(escapeCSVField).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

export function downloadCSVMatrix(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): void {
  const csv = generateCSVString(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows || rows.length === 0) {
    const blob = new Blob([''], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, filename);
    return;
  }
  const headerSet = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);

  const dataRows = rows.map((r) => headers.map((h) => r[h] as string | number | boolean | null | undefined));
  downloadCSVMatrix(filename, headers, dataRows);
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
