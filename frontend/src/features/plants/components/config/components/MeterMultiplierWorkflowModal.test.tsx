import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  submitMock: vi.fn().mockResolvedValue({ error: null }),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/data/mutations/meterMultiplier', () => ({
  submitMeterMultiplierWorkflow: (...args: unknown[]) => h.submitMock(...args),
}));

import { MeterMultiplierWorkflowModal, type MeterWorkflowTarget } from './MeterMultiplierWorkflowModal';

describe('MeterMultiplierWorkflowModal starting reading requirement', () => {
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

  const target: MeterWorkflowTarget = {
    id: 'target-1',
    name: 'Well Alpha',
    type: 'well',
    meter_serial: 'SN-OLD-1',
    meter_multiplier: 1,
    multiplier_enabled: false,
    last_reading: 500,
  };

  it('allows blank starting reading on multiplier cutover and submits with newReadingValue: null', async () => {
    render(
      <QueryClientProvider client={qc}>
        <MeterMultiplierWorkflowModal
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

    // Inline warning should be visible
    expect(
      screen.getByText(/Leaving this blank skips the reset boundary for this cutover/)
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Apply Multiplier Configuration/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(h.submitMock).toHaveBeenCalledTimes(1);
    });

    const params = h.submitMock.mock.calls[0][0];
    expect(params.newReadingValue).toBeNull();
    expect(params.eventType).toBe('multiplier_cutover');
  });

  it('rejects blank starting reading on physical replacement', async () => {
    render(
      <QueryClientProvider client={qc}>
        <MeterMultiplierWorkflowModal
          open={true}
          onOpenChange={vi.fn()}
          plantId="plant-1"
          target={target}
          eventType="physical_replacement"
        />
      </QueryClientProvider>
    );

    const readingInput = screen.getByLabelText(/New Meter Initial Dial Reading/);
    fireEvent.change(readingInput, { target: { value: '' } });

    const form = document.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith('Valid new starting reading is required');
    });

    expect(h.submitMock).not.toHaveBeenCalled();
  });
});
