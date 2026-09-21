import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** P5-6: submitting a request must (a) store it against the submitter, because
 *  "My Corrections" finds requests by `submitted_by`, (b) refresh that list, and
 *  (c) tell the operator where to follow it up. */

const h = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  failTable: null as string | null,
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { info: h.toastInfo, error: h.toastError, success: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'op-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = () => ({ error: h.failTable === table ? new Error('denied') : null });
      const b: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return Promise.resolve(result()); },
        update: () => b,
        eq: () => Promise.resolve(result()),
      };
      return b;
    },
  },
}));
vi.mock('@/components/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) => (
    <div><h2>{title}</h2>{children}{footer}</div>
  ),
}));
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const Ctx = React.createContext<(v: string) => void>(() => {});
  type P = { children?: ReactNode };
  return {
    Select: ({ onValueChange, children }: P & { onValueChange: (v: string) => void }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children }: P) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: P) => <div>{children}</div>,
    SelectItem: ({ value, children }: P & { value: string }) => {
      const set = React.useContext(Ctx);
      return <button type="button" onClick={() => set(value)}>{children}</button>;
    },
  };
});

import { CorrectionRequestDialog, type CorrectionTarget } from './CorrectionRequestDialog';

const TARGET: CorrectionTarget = {
  id: 'reading-1', sourceTable: 'well_readings', plantId: 'plant-1', entityName: 'Well 3',
  currentReading: 1234, previousReading: 1200, dailyVolume: 34, readingDatetime: '2026-09-20T06:00:00Z',
};

let path = '';
function Probe() { path = useLocation().pathname; return null; }

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onSubmitted = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/operations']}>
        <CorrectionRequestDialog target={TARGET} onClose={vi.fn()} onSubmitted={onSubmitted} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate, onSubmitted };
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('e.g. 1,234'), { target: { value: '1243' } });
  fireEvent.click(screen.getByRole('button', { name: /meter misread/i }));
  fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
}

describe('CorrectionRequestDialog (P5-6)', () => {
  beforeEach(() => { h.inserts = []; h.failTable = null; h.toastInfo.mockClear(); h.toastError.mockClear(); path = ''; });

  it('stores the request against the submitter: this is what My Corrections filters on', async () => {
    const { onSubmitted } = setup();
    await fillAndSubmit();
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    const cr = h.inserts.find((i) => i.table === 'correction_requests');
    expect(cr?.row).toMatchObject({
      submitted_by: 'op-1', source_table: 'well_readings', source_id: 'reading-1',
      plant_id: 'plant-1', original_value: 1234, proposed_value: 1243, status: 'pending',
    });
  });

  it('refreshes the operator\'s request list', async () => {
    const { invalidate, onSubmitted } = setup();
    await fillAndSubmit();
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['corrections', 'my-requests'] });
  });

  it('tells the operator where to follow it up, and the link goes there', async () => {
    const { onSubmitted } = setup();
    await fillAndSubmit();
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(h.toastInfo).toHaveBeenCalledTimes(1);
    const [message, options] = h.toastInfo.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toMatch(/Well 3: correction request submitted/);
    expect(options.action.label).toBe('View');
    options.action.onClick();
    await waitFor(() => expect(path).toBe('/my-corrections'));
  });

  it('a failed submit reports the error, and neither refreshes the list nor pretends it worked', async () => {
    h.failTable = 'correction_requests';
    const { invalidate, onSubmitted } = setup();
    await fillAndSubmit();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastInfo).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
