/**
 * CSV export helper with protection against CSV Formula Injection (CWE-1236).
 * Produces a downloadable .csv from rows of records.
 */

export function escapeCSVField(v: any): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);

  // Prevent spreadsheet formula execution if string starts with formula triggers (=, +, -, @, tab, CR)
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows || rows.length === 0) {
    const blob = new Blob([''], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, filename);
    return;
  }
  const headerSet = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);

  const csv = [
    headers.map(escapeCSVField).join(','),
    ...rows.map((r) => headers.map((h) => escapeCSVField(r[h])).join(',')),
  ].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
