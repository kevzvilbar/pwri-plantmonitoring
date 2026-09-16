/**
 * data/mutations/plantTopology.ts — Plant topology mutation functions.
 *
 * Roadmap Phase 3: the data-access layer. Pure mutation functions for
 * plant topology operations (saving links, custom nodes, etc).
 * Components wrap them with React Query via the hooks in src/data/hooks/.
 */
import { supabase } from '@/integrations/supabase/client';

/** Save topology links to database */
export async function saveTopologyLinks(plantId: string, links: { from_id: string; to_id: string }[]): Promise<void> {
  if (!links.length) {
    // Delete all links for this plant
    const { error } = await (supabase.from('plant_topology_links' as any) as any)
      .delete().eq('plant_id', plantId);
    if (error) throw error;
    return;
  }

  // Upsert links
  const linksWithPlant = links.map(l => ({ ...l, plant_id: plantId }));
  const { error } = await (supabase.from('plant_topology_links' as any) as any)
    .upsert(linksWithPlant, { onConflict: 'plant_id,from_id,to_id' });
  if (error) throw error;
}

/** Delete a single topology link */
export async function deleteTopologyLink(plantId: string, fromId: string, toId: string): Promise<void> {
  const { error } = await (supabase.from('plant_topology_links' as any) as any)
    .delete().eq('plant_id', plantId).eq('from_id', fromId).eq('to_id', toId);
  if (error) throw error;
}

export interface TopologyConfigPayload {
  customNodes: any[];
  customColumns: any[];
  positionOverrides: Record<string, any>;
  columnWidths: Record<string, number>;
  paletteItems: any[];
}

/** Save topology layout configuration (custom nodes, custom columns, column widths, overrides) to database */
export async function saveTopologyConfig(plantId: string, payload: TopologyConfigPayload): Promise<void> {
  const row = {
    plant_id: plantId,
    custom_nodes: payload.customNodes,
    custom_columns: payload.customColumns,
    position_overrides: payload.positionOverrides,
    column_widths: payload.columnWidths,
    palette_items: payload.paletteItems,
    updated_at: new Date().toISOString(),
  };

  const { error } = await (supabase.from('plant_topology_config' as any) as any)
    .upsert(row, { onConflict: 'plant_id' });
  if (error) throw error;
}

/** Save custom node (placeholder for future DB table) */
export async function saveCustomNode(node: any): Promise<void> {
  // Currently stored in localStorage, but could be moved to DB
  console.log('saveCustomNode called', node);
}

/** Delete custom node (placeholder for future DB table) */
export async function deleteCustomNode(nodeId: string): Promise<void> {
  // Currently stored in localStorage
  console.log('deleteCustomNode called', nodeId);
}

export type { };