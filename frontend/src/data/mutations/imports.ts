/**
 * data/mutations/imports.ts — Smart import mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * import operations (batch insert, validate, etc).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ImportTypeConfig, ParsedRow } from '@/components/smart-import/registry';

export interface ImportBatchResult {
  inserted: number;
  errors: string[];
  log: string[];
}

export interface ImportOptions {
  config: ImportTypeConfig;
  plantId: string;
  userId: string | null;
  rows: ParsedRow[];
  skipInvalid: boolean;
  entityNameToId: Record<string, string>;
}

/** Batch import rows into the target table */
export async function batchImportRows(options: ImportOptions): Promise<ImportBatchResult> {
  const { config, plantId, userId, rows, skipInvalid, entityNameToId } = options;
  
  const targetRows = skipInvalid ? rows.filter(r => r.valid) : rows;
  if (!targetRows.length) {
    return { inserted: 0, errors: ['No valid rows to import'], log: [] };
  }

  const log: string[] = [];
  let inserted = 0;
  const batchSize = 50;

  for (let i = 0; i < targetRows.length; i += batchSize) {
    const batch = targetRows.slice(i, i + batchSize);
    const insertBatch: Record<string, unknown>[] = [];
    const batchErrors: string[] = [];

    for (const r of batch) {
      const obj: Record<string, unknown> = {
        plant_id: plantId,
        recorded_by: userId,
        ...(config.extraInsertFields ?? {}),
      };

      // Handle entity lookup (locator, well, meter, train)
      if (config.entityTable && config.entityNameKey && config.entityIdKey) {
        const rawName = r.data[config.entityNameKey]?.trim() ?? '';
        const entityId = entityNameToId[rawName.toLowerCase()];
        if (!entityId) {
          batchErrors.push(`Row ${r.rowIndex + 1}: ${config.entityNameKey?.replace(/_/g, ' ')} "${rawName}" not found in plant — skipped`);
          continue;
        }
        obj[config.entityIdKey] = entityId;
      }

      // Map columns
      for (const col of config.columns) {
        if (col.key === config.entityNameKey) continue;
        if (config.skipColumns?.includes(col.key)) continue;
        const raw = r.data[col.key] ?? '';
        if (!raw) continue;
        if (col.type === 'number') {
          const n = parseFloat(raw);
          if (!isNaN(n)) obj[col.key] = n;
        } else {
          obj[col.key] = raw;
        }
      }

      // Special handling for locator_readings direct mode
      if (config.id === 'locator_readings') {
        const isDirect = (r.data['input_mode'] ?? '').toLowerCase() === 'direct';
        if (isDirect) {
          const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : 0;
          obj['current_reading'] = prev;
          obj['previous_reading'] = prev || null;
        }
      }

      // Compute daily_volume if configured
      if (config.computeDailyVolume) {
        const cur = parseFloat(r.data['current_reading'] ?? '');
        const prev = r.data['previous_reading'] ? parseFloat(r.data['previous_reading']) : null;
        if (!isNaN(cur)) {
          const delta = prev != null && !isNaN(prev) ? Math.max(0, cur - prev) : null;
          if (delta != null) obj['daily_volume'] = delta;
        }
      }

      // Special handling for well_readings solar meter
      if (config.id === 'well_readings' && !r.data['solar_meter_reading']?.trim()) {
        delete obj['solar_meter_reading'];
      }

      insertBatch.push(obj);
    }

    batchErrors.forEach(e => log.push(`⚠ ${e}`));

    if (insertBatch.length > 0) {
      const { error } = await (supabase.from(config.table as any) as any).insert(insertBatch);
      inserted += insertBatch.length;

      if (error) {
        log.push(`❌ Batch insert failed: ${error.message}`);
        return { inserted, errors: [error.message, ...batchErrors], log };
      }
      log.push(`✅ Inserted ${insertBatch.length} row(s)`);
    }
  }

  return { inserted, errors: [], log };
}

export type { ImportTypeConfig, ParsedRow };