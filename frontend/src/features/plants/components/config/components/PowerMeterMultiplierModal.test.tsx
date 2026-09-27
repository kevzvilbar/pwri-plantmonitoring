import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ error: null }),
  insertMock: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'pmc-1' }, error: null }),
    }),
  }),
  selectMock: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          grid_meter_count: 1,
          grid_meter_multipliers: [1],
          grid_meter_multipliers_enabled: [true],
        },
        error: null,
      }),
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'plant_power_config') {
        return {
          select: h.selectMock,
          upsert: h.upsertMock,
        };
      }
      if (table === 'power_meter_changes') {
        return {
          insert: h.insertMock,
        };
      }
      return {
        select: h.selectMock,
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'reading-1' }, error: null }),
          }),
        }),
      };
    },
  },
}));

import { PowerMeterMultiplierModal, type PowerMeterWorkflowTarget } from './PowerMeterMultiplierModal';

describe('PowerMeterMultiplierModal', () => {
  let qc: QueryClient;

  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  const target: PowerMeterWorkflowTarget = {
    name: 'Main Grid Meter',
    powerKind: 'grid',
    meterIndex: 0,
    meter_multiplier: 1,
    multiplier_enabled: false,
    last_reading: 2500,
  };

  it('allows blank starting reading on multiplier cutover and submits correctly', async () => {
    render(
      <QueryClientProvider client={qc}>
        <PowerMeterMultiplierModal
          open={true}
          onOpenChange={vi.fn()}
          plantId="plant-1"
          target={target}
          eventType="multiplier_cutover"
        />
      </QueryClientProvider>
    );

    const readingInput = screen.getByLabelText(/New Starting Raw Reading/);
    fireEvent.change(readingInput, { target: { value: '' } });

    // Inline warning should be displayed
    expect(
      screen.getByText(/Leaving this blank skips the reset boundary for this cutover/)
    ).toBeInTheDocument();

    const multInput = screen.getByLabelText(/Multiplier Factor/);
    fireEvent.change(multInput, { target: { value: '120' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(h.insertMock).toHaveBeenCalledTimes(1);
    });

    const insertCall = h.insertMock.mock.calls[0][0];
    expect(insertCall.event_type).toBe('multiplier_cutover');
    expect(insertCall.power_kind).toBe('grid');
    expect(insertCall.new_multiplier).toBe(120);
    expect(insertCall.new_meter_initial_reading).toBeNull();
  });

  it('requires both old final and new initial reading on physical replacement', async () => {
    render(
      <QueryClientProvider client={qc}>
        <PowerMeterMultiplierModal
          open={true}
          onOpenChange={vi.fn()}
          plantId="plant-1"
          target={target}
          eventType="physical_replacement"
        />
      </QueryClientProvider>
    );

    const oldReadingInput = screen.getByLabelText(/Old Meter Final Reading/);
    fireEvent.change(oldReadingInput, { target: { value: '' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("Old meter's final reading is required for physical replacement");
    });

    expect(h.insertMock).not.toHaveBeenCalled();
  });

  it('submits physical replacement when valid readings are supplied', async () => {
    render(
      <QueryClientProvider client={qc}>
        <PowerMeterMultiplierModal
          open={true}
          onOpenChange={vi.fn()}
          plantId="plant-1"
          target={target}
          eventType="physical_replacement"
        />
      </QueryClientProvider>
    );

    const oldReadingInput = screen.getByLabelText(/Old Meter Final Reading/);
    fireEvent.change(oldReadingInput, { target: { value: '3450' } });

    const newReadingInput = screen.getByLabelText(/New Meter Initial Reading/);
    fireEvent.change(newReadingInput, { target: { value: '10' } });

    const multInput = screen.getByLabelText(/Multiplier Factor/);
    fireEvent.change(multInput, { target: { value: '240' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(h.insertMock).toHaveBeenCalledTimes(1);
    });

    const insertCall = h.insertMock.mock.calls[0][0];
    expect(insertCall.event_type).toBe('physical_replacement');
    expect(insertCall.old_meter_final_reading).toBe(3450);
    expect(insertCall.new_meter_initial_reading).toBe(10);
    expect(insertCall.new_multiplier).toBe(240);
  });
});
