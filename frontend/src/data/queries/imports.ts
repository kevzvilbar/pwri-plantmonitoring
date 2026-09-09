/**
 * data/queries/imports.ts — Smart import query functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure query functions for
 * import-related operations (entity lookups, plant entities).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ImportTypeConfig } from '@/components/smart-import/registry';

/** Fetch entity name-to-ID mapping for a plant and config */
export async function fetchEntityNameMap(
  config: ImportTypeConfig,
  plantId: string
): Promise<Record<string, string>> {
  if (!config.entityTable || !config.entityNameKey || !config.entityIdKey) {
    return {};
  }

  const { data: entities, error } = await (supabase
    .from(config.entityTable as any) as any)
    .select('id, name')
    .eq('plant_id', plantId);

  if (error) throw error;

  const entityNameToId: Record<string, string> = {};
  (entities ?? []).forEach((e: any) => {
    entityNameToId[e.name.trim().toLowerCase()] = e.id;
  });
  return entityNameToId;
}

/** Fetch entity names for CSV template generation */
export async function fetchEntityNamesForTemplate(
  config: ImportTypeConfig,
  plantId: string
): Promise<string[]> {
  if (!config.entityTable || !config.entityNameKey) {
    return [];
  }

  const { data: entities, error } = await (supabase
    .from(config.entityTable as any) as any)
    .select('name')
    .eq('plant_id', plantId)
    .limit(5);

  if (error) return [];
  return (entities ?? []).map((e: any) => e.name);
}

/** Get current session user ID */
export async function getCurrentUserId(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user.id ?? null;
}

export type { ImportTypeConfig };