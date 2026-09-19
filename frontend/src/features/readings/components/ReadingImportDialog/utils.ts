import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/lib/csv';

export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (line[i] === '"') {
      i++;
      let val = '';
      while (i < len) {
        if (line[i] === '"' && line[i + 1] === '"') {
          val += '"'; i += 2;
        } else if (line[i] === '"') {
          i++; break;
        } else {
          val += line[i++];
        }
      }
      fields.push(val.trim());
      if (i < len && line[i] === ',') i++;
    } else {
      const start = i;
      while (i < len && line[i] !== ',') i++;
      fields.push(line.slice(start, i).trim());
      if (i < len && line[i] === ',') i++;
    }
  }
  if (len > 0 && line[len - 1] === ',') fields.push('');
  return fields;
}

export function parseCSVText(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export function triggerTemplateDownload(filename: string, headers: string[], exampleRows: Record<string, string> | Record<string, string>[]) {
  downloadCSV(filename, Array.isArray(exampleRows) ? exampleRows : [exampleRows]);
}

export function normalizeDatetime(raw: string): string {
  if (!raw?.trim()) return '';
  let s = raw.trim().replace(' ', 'T');
  s = s.replace(/T(\d):/, 'T0$1:');
  return s;
}

async function logReadingImport(entry: {
  user_id: string | null;
  plant_id: string;
  module: string;
  file_name: string;
  row_count: number;
  schema_valid: boolean;
  schema_errors: string[];
  timestamp: string;
}) {
  try {
    await (supabase.from('import_audit_log' as any) as any).insert([entry]);
  } catch { /* silently ignore if table missing */ }
}

export function computeIntraFileDuplicateIndices(rows: Record<string, string>[], module: string): number[] {
  const isPowerModule = module === 'power';
  const seenKeys = new Map<string, number>();
  const intraDups: number[] = [];
  rows.forEach((r, i) => {
    const dtRaw = r.reading_datetime || r.event_date || '';
    const entityName = (r.well_name || r.locator_name || '').trim().toLowerCase();
    let dtKey: string;
    if (!dtRaw) {
      dtKey = `__nodate__${i}`;
    } else {
      const dtNorm = normalizeDatetime(dtRaw);
      dtKey = isPowerModule ? dtNorm.slice(0, 10) : dtNorm.slice(0, 16);
    }
    const powerName = isPowerModule ? (r.plant_name || '').trim().toLowerCase() : '';
    const powerMeter = isPowerModule ? (r.meter_name || '').trim().toLowerCase() : '';
    const key = isPowerModule ? `${powerName}|${powerMeter}|${dtKey}` : `${entityName}|${dtKey}`;
    if (seenKeys.has(key)) intraDups.push(i);
    else seenKeys.set(key, i);
  });
  return intraDups;
}

const _dupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();
let _dupPromptResolver: ((decision: 'overwrite' | 'skip') => void) | null = null;
let _dupShowPrompt: ((label: string, isDateOnly: boolean) => void) | null = null;
let _bulkDupDecision: 'overwrite' | 'skip' | null = null;

export function clearDupDecisions() { _dupDecisions.clear(); }
export function clearBulkDupDecision() { _bulkDupDecision = null; }
export function setBulkDupDecision(decision: 'overwrite' | 'skip') {
  _bulkDupDecision = decision;
}

export function resolveDupPrompt(decision: 'overwrite' | 'skip') {
  _dupPromptResolver?.(decision);
  _dupPromptResolver = null;
}

export function setDupShowPrompt(fn: (label: string, isDateOnly: boolean) => void) {
  _dupShowPrompt = fn;
}

export function clearDupShowPrompt() {
  _dupShowPrompt = null;
  _dupPromptResolver = null;
}

export async function resolveImportDuplicate(key: string, label: string, isDateOnly = false): Promise<'overwrite' | 'skip'> {
  if (_dupDecisions.has(key)) return _dupDecisions.get(key)!;
  if (_bulkDupDecision) {
    _dupDecisions.set(key, _bulkDupDecision);
    return _bulkDupDecision;
  }
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _dupPromptResolver = resolve;
    _dupShowPrompt?.(label, isDateOnly);
  });
  _dupDecisions.set(key, decision);
  return decision;
}

export { logReadingImport };
