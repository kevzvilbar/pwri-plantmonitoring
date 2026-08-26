import { supabase } from '@/integrations/supabase/client';
import { downloadCSV } from '@/lib/csv';

export function parseCSVText(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export function triggerTemplateDownload(filename: string, _headers: string[], exampleRow: Record<string, string>) {
  downloadCSV(filename, [exampleRow]);
}

// ─── Import audit logger ─────────────────────────────────────────────────────

export async function logBillingImport(entry: {
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

// ─── Duplicate decision state (module-level, reset each import run) ──────────

const _billingDupDecisions: Map<string, 'overwrite' | 'skip'> = new Map();
export function clearBillingDupDecisions() { _billingDupDecisions.clear(); }

let _billingDupPromptResolver: ((d: 'overwrite' | 'skip') => void) | null = null;
let _billingDupShowPrompt: ((label: string, isDateOnly: boolean) => void) | null = null;
let _billingBulkDupDecision: 'overwrite' | 'skip' | null = null;
export function clearBillingBulkDupDecision() { _billingBulkDupDecision = null; }

// 2026-08-22 (god-component extraction): these three used to be plain
// module-level `let`s that ImportReadingsDialog (now a separate file)
// reassigned directly — worked when everything lived in one file, but ES
// module imports are read-only bindings, so a direct `import { X } from
// './importHelpers'; X = ...` doesn't work once split. Wrapped as setters
// instead; behavior is identical to the pre-split version.
export function setBillingDupPromptHandler(handler: ((label: string, isDateOnly: boolean) => void) | null) {
  _billingDupShowPrompt = handler;
}
export function resolveBillingDupPrompt(decision: 'overwrite' | 'skip') {
  _billingDupPromptResolver?.(decision);
  _billingDupPromptResolver = null;
}
export function setBillingBulkDupDecision(decision: 'overwrite' | 'skip' | null) {
  _billingBulkDupDecision = decision;
}

export async function resolveBillingDuplicate(key: string, label: string, isDateOnly = false): Promise<'overwrite' | 'skip'> {
  if (_billingDupDecisions.has(key)) return _billingDupDecisions.get(key)!;
  if (_billingBulkDupDecision) {
    _billingDupDecisions.set(key, _billingBulkDupDecision);
    return _billingBulkDupDecision;
  }
  const decision = await new Promise<'overwrite' | 'skip'>((resolve) => {
    _billingDupPromptResolver = resolve;
    _billingDupShowPrompt?.(label, isDateOnly);
  });
  _billingDupDecisions.set(key, decision);
  return decision;
}

