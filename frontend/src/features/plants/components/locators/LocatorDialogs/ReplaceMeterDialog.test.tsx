import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  selectResults: {} as Record<string, unknown>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError, info: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, activeOperator: { id: 'op-1' } }),
}));
vi.mock('@/data/queries/readingHistory', () => ({
  resyncLocatorChain: vi.fn().mockResolvedValue(undefined),
  resyncWellChain: vi.fn().mockResolvedValue(undefined),
  resyncProductMeterChain: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: (_cols: string) => b,
        eq: (_col: string, _val: unknown) => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        single: () => Promise.resolve({ data: { id: 'generated-id' }, error: null }),
        maybeSingle: () => {
          if (h.selectResults[table]) {
            return Promise.resolve({ data: h.selectResults[table], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        insert: (row: Record<string, unknown>) => {
          h.inserts.push({ table, row });
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'inserted-repl-id' }, error: null }),
            }),
            ...Promise.resolve({ data: { id: 'inserted-row' }, error: null }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          h.updates.push({ table, patch });
          return b;
        },
      };
      return b;
    },
  },
}));

import { ReplaceMeterDialog } from './ReplaceMeterDialog';

describe('ReplaceMeterDialog multiplier support', () => {
  beforeEach(() => {
    h.inserts = [];
    h.updates = [];
    h.selectResults = {};
    vi.clearAllMocks();
  });

  it('prefills multiplier from live entity in create mode and persists on save', async () => {
    h.selectResults['wells'] = { meter_multiplier: 10, multiplier_enabled: true };

    render(
      <ReplaceMeterDialog
        kind="well"
        assetId="well-1"
        plantId="plant-1"
        oldSerial="SN-OLD-1"
        onClose={vi.fn()}
      />
    );

    // Wait for the live entity multiplier to load
    await waitFor(() => {
      expect(screen.getByText(/Current multiplier:/)).toHaveTextContent('×10 (Active)');
    });

    const multInput = screen.getByLabelText(/Multiplier Factor/);
    expect(multInput).toHaveValue(10);

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/Old meter's final reading \*/), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/New serial \*/), { target: { value: 'SN-NEW-99' } });
    fireEvent.change(screen.getByLabelText(/New meter's initial reading \*/), { target: { value: '0' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Save replacement/ }));

    await waitFor(() => {
      expect(h.inserts.length).toBeGreaterThanOrEqual(1);
    });

    // Check replacement record payload
    const replInsert = h.inserts.find((i) => i.table === 'well_meter_replacements');
    expect(replInsert).toBeDefined();
    expect(replInsert?.row.old_multiplier).toBe(10);
    expect(replInsert?.row.old_multiplier_enabled).toBe(true);
    expect(replInsert?.row.new_multiplier).toBe(10);
    expect(replInsert?.row.new_multiplier_enabled).toBe(true);

    // Check asset entity update
    const entityUpdate = h.updates.find((u) => u.table === 'wells');
    expect(entityUpdate).toBeDefined();
    expect(entityUpdate?.patch.meter_multiplier).toBe(10);
    expect(entityUpdate?.patch.multiplier_enabled).toBe(true);

    // Check reading rows have multiplier_at_reading set
    const readingInserts = h.inserts.filter((i) => i.table === 'well_readings');
    expect(readingInserts.length).toBe(2);
    // Old final reading row
    const oldFinalRow = readingInserts.find((r) => r.row.is_meter_replacement === false);
    expect(oldFinalRow?.row.multiplier_at_reading).toBe(10);
    // New initial reading row
    const newInitialRow = readingInserts.find((r) => r.row.is_meter_replacement === true);
    expect(newInitialRow?.row.multiplier_at_reading).toBe(10);
  });

  it('sources old and new multiplier fields from the initial record in edit mode without live fetch', async () => {
    // Live entity might have changed in the meantime (e.g. x100)
    h.selectResults['locators'] = { meter_multiplier: 100, multiplier_enabled: true };

    const initial = {
      id: 'repl-123',
      replacementDate: '2026-09-20T08:00',
      oldFinal: '500',
      newBrand: 'BrandX',
      newSize: '2 inch',
      newSerial: 'SN-456',
      newInitial: '10',
      installedDate: '2026-09-20T08:05',
      remarks: 'Replaced earlier',
      rawOldSerial: 'SN-123',
      oldMultiplier: 5,
      oldMultiplierEnabled: true,
      newMultiplier: 10,
      newMultiplierEnabled: true,
    };

    render(
      <ReplaceMeterDialog
        kind="locator"
        assetId="loc-1"
        plantId="plant-1"
        oldSerial="SN-CURRENT"
        initial={initial}
        onClose={vi.fn()}
      />
    );

    // Displays the oldMultiplier from the initial snapshot, not the live 100
    expect(screen.getByText(/Current multiplier:/)).toHaveTextContent('×5 (Active)');
    expect(screen.getByLabelText(/Multiplier Factor/)).toHaveValue(10);

    // Submit edit
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));

    await waitFor(() => {
      expect(h.updates.length).toBeGreaterThanOrEqual(1);
    });

    const replUpdate = h.updates.find((u) => u.table === 'locator_meter_replacements');
    expect(replUpdate).toBeDefined();
    expect(replUpdate?.patch.old_multiplier).toBe(5);
    expect(replUpdate?.patch.old_multiplier_enabled).toBe(true);
    expect(replUpdate?.patch.new_multiplier).toBe(10);
    expect(replUpdate?.patch.new_multiplier_enabled).toBe(true);
  });
});
