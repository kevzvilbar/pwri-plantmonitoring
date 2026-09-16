import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveTopologyConfig, TopologyConfigPayload } from '@/data/mutations/plantTopology';
import { supabase } from '@/integrations/supabase/client';
import {
  loadCustomNodes,
  saveCustomNodes,
  loadCustomColumns,
  saveCustomColumns,
  loadPosOverrides,
  savePosOverrides,
  loadColWidths,
  saveColWidths,
  loadPaletteItems,
  savePaletteItems,
} from './shared';

describe('Plant Topology Layout Persistence & Offline Sync (Tier 3)', () => {
  const PLANT_ID = 'test-plant-uuid-123';

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saveTopologyConfig formats payload correctly and executes upsert on plant_topology_config', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const fromSpy = vi.spyOn(supabase, 'from').mockReturnValue({
      upsert: upsertSpy,
    } as any);

    const payload: TopologyConfigPayload = {
      customNodes: [{ id: 'custom-1', label: 'Filter Test', type: 'mediaFilter', status: 'Active' }],
      customColumns: [{ id: 'col-1', label: 'Secondary Filter', insertAfter: 'rawTank' }],
      positionOverrides: { 'custom-1': { colKey: 'col-1', rowIdx: 0 } },
      columnWidths: { 'col-1': 260 },
      paletteItems: [{ id: 'palette-1', label: 'Spare Pump' }],
    };

    await saveTopologyConfig(PLANT_ID, payload);

    expect(fromSpy).toHaveBeenCalledWith('plant_topology_config');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        plant_id: PLANT_ID,
        custom_nodes: payload.customNodes,
        custom_columns: payload.customColumns,
        position_overrides: payload.positionOverrides,
        column_widths: payload.columnWidths,
        palette_items: payload.paletteItems,
        updated_at: expect.any(String),
      }),
      { onConflict: 'plant_id' }
    );
  });

  it('throws error when supabase upsert fails', async () => {
    vi.spyOn(supabase, 'from').mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: new Error('Permission denied') }),
    } as any);

    const payload: TopologyConfigPayload = {
      customNodes: [],
      customColumns: [],
      positionOverrides: {},
      columnWidths: {},
      paletteItems: [],
    };

    await expect(saveTopologyConfig(PLANT_ID, payload)).rejects.toThrow('Permission denied');
  });

  it('local storage helpers support offline layout caching and retrieval', () => {
    const mockNodes = [{ id: 'node-a', label: 'Custom Node A', type: 'well', status: 'Active' } as any];
    const mockCols = [{ id: 'col-a', label: 'Lane A', insertAfter: 'well' }];
    const mockOverrides = { 'node-a': { colKey: 'col-a', rowIdx: 1 } };
    const mockWidths = { well: 240, 'col-a': 280 };
    const mockPalette = [{ id: 'pal-a', label: 'Custom Item' }];

    saveCustomNodes(PLANT_ID, mockNodes);
    saveCustomColumns(PLANT_ID, mockCols);
    savePosOverrides(PLANT_ID, mockOverrides);
    saveColWidths(PLANT_ID, mockWidths);
    savePaletteItems(PLANT_ID, mockPalette);

    expect(loadCustomNodes(PLANT_ID)).toEqual(mockNodes);
    expect(loadCustomColumns(PLANT_ID)).toEqual(mockCols);
    expect(loadPosOverrides(PLANT_ID)).toEqual(mockOverrides);
    expect(loadColWidths(PLANT_ID)).toEqual(mockWidths);
    expect(loadPaletteItems(PLANT_ID)).toEqual(mockPalette);
  });
});

