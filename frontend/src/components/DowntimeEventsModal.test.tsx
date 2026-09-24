import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DowntimeEventsModal } from './DowntimeEventsModal';

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (...args: any[]) => toastError(...args),
    success: (...args: any[]) => toastSuccess(...args),
    info: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, isManager: true, user: { id: 'u1' } }),
}));

vi.mock('@/hooks/usePlants', () => ({
  usePlants: () => ({
    data: [
      { id: 'p1', name: 'Mambaling' },
      { id: 'p2', name: 'Umapad' },
    ],
  }),
}));

const insertFn = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        gt: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      insert: (payload: any) => insertFn(payload),
    }),
  },
}));

function renderModal(props: { open?: boolean; plantId?: string; plantName?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DowntimeEventsModal
        open={props.open ?? true}
        onClose={() => {}}
        plantId={props.plantId}
        plantName={props.plantName}
      />
    </QueryClientProvider>,
  );
}

describe('DowntimeEventsModal regression tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal and opens add form without defaulting to plants[0]', async () => {
    renderModal();
    // Click Record Downtime button in top bar
    const recordBtn = screen.getByRole('button', { name: /log downtime/i });
    fireEvent.click(recordBtn);

    expect(screen.getByText('Record Downtime Event')).toBeInTheDocument();

    // Fill duration
    const durationInput = screen.getByPlaceholderText(/e\.g\. 3\.5/i);
    fireEvent.change(durationInput, { target: { value: '2.5' } });

    // Try submitting without selecting a plant
    const saveBtn = screen.getByRole('button', { name: /save event/i });
    fireEvent.click(saveBtn);

    expect(toastError).toHaveBeenCalledWith('Please select a plant');
    expect(insertFn).not.toHaveBeenCalled();
  }, 15_000);

  it('pre-populates plantId when passed as initialPlantId', async () => {
    renderModal({ plantId: 'p2', plantName: 'Umapad' });

    const recordBtn = screen.getByRole('button', { name: /log downtime/i });
    fireEvent.click(recordBtn);

    const durationInput = screen.getByPlaceholderText(/e\.g\. 3\.5/i);
    fireEvent.change(durationInput, { target: { value: '4' } });

    const saveBtn = screen.getByRole('button', { name: /save event/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          plant_id: 'p2',
          duration_hrs: 4,
          subsystem: 'RO Trains',
        }),
      );
      expect(toastSuccess).toHaveBeenCalledWith('Downtime event recorded successfully');
    });
  }, 15_000);
});

