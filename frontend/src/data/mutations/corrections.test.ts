import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createSupabaseQueryMock } from '@/test/mocks/supabaseMock';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  approveCorrectionRequest,
  rejectCorrectionRequest,
  createCorrectionRequest,
  updateCorrectionRequest,
  insertReadingNormalization,
} from './corrections';

const fromMock = vi.mocked(supabase).from as unknown as Mock<
  (table: string) => ReturnType<typeof createSupabaseQueryMock>
>;
const rpcMock = vi.mocked(supabase.rpc);

let rows: Record<string, unknown[]> = {};

describe('data/mutations/corrections', () => {
  beforeEach(() => {
    rows = {};
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => createSupabaseQueryMock(rows[table] ?? []));
  });

  describe('approveCorrectionRequest', () => {
    it('calls fn_approve_correction_request RPC with correct parameters', async () => {
      rpcMock.mockResolvedValueOnce({
        data: { success: true, applied: true, request_id: 'req-1' },
        error: null,
      } as any);

      const res = await approveCorrectionRequest('req-1', 'rev-1', 'Looks good');

      expect(rpcMock).toHaveBeenCalledWith('fn_approve_correction_request', {
        p_request_id: 'req-1',
        p_reviewer_id: 'rev-1',
        p_note: 'Looks good',
      });
      expect(res).toEqual({ success: true, applied: true, request_id: 'req-1' });
    });

    it('throws when RPC returns an error', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: new Error('Database error'),
      } as any);

      await expect(approveCorrectionRequest('req-1', 'rev-1')).rejects.toThrow('Database error');
    });
  });

  describe('rejectCorrectionRequest', () => {
    it('calls fn_reject_correction_request RPC with correct parameters', async () => {
      rpcMock.mockResolvedValueOnce({
        data: { success: true, applied: false, request_id: 'req-2' },
        error: null,
      } as any);

      const res = await rejectCorrectionRequest('req-2', 'rev-1', 'Value out of bounds');

      expect(rpcMock).toHaveBeenCalledWith('fn_reject_correction_request', {
        p_request_id: 'req-2',
        p_reviewer_id: 'rev-1',
        p_note: 'Value out of bounds',
      });
      expect(res).toEqual({ success: true, applied: false, request_id: 'req-2' });
    });

    it('throws when RPC returns an error', async () => {
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: new Error('Request already processed'),
      } as any);

      await expect(rejectCorrectionRequest('req-2', 'rev-1', 'Rejected')).rejects.toThrow(
        'Request already processed'
      );
    });
  });

  describe('createCorrectionRequest', () => {
    it('inserts a correction request and returns its id', async () => {
      rows.correction_requests = [{ id: 'new-req-id' }];

      const res = await createCorrectionRequest({
        source_table: 'well_readings',
        source_id: 'well-reading-1',
        plant_id: 'plant-1',
        original_value: 100,
        proposed_value: 150,
        reason: 'Typo in meter dial',
      });

      expect(fromMock).toHaveBeenCalledWith('correction_requests');
      expect(res).toEqual({ id: 'new-req-id' });
    });
  });

  describe('updateCorrectionRequest', () => {
    it('updates a correction request by id', async () => {
      await updateCorrectionRequest('req-1', {
        status: 'pending',
      });

      expect(fromMock).toHaveBeenCalledWith('correction_requests');
    });
  });

  describe('insertReadingNormalization', () => {
    it('inserts a reading normalization audit row', async () => {
      await insertReadingNormalization({
        source_table: 'well_readings',
        source_id: 'reading-1',
        action: 'normalize',
        original_value: 100,
        adjusted_value: 150,
        note: 'Approved correction',
        performed_role: 'Admin',
      });

      expect(fromMock).toHaveBeenCalledWith('reading_normalizations');
    });
  });
});
