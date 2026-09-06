import { vi } from 'vitest';

export function createSupabaseQueryMock(defaultData: unknown = []) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: Array.isArray(defaultData) ? defaultData[0] : defaultData, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: Array.isArray(defaultData) ? defaultData[0] : defaultData, error: null }),
    then: vi.fn().mockImplementation((resolve) => Promise.resolve({ data: defaultData, error: null }).then(resolve)),
  };
  return queryBuilder;
}

export function createSupabaseClientMock(tableDataMap: Record<string, unknown> = {}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      const data = tableDataMap[table] ?? [];
      return createSupabaseQueryMock(data);
    }),
    rpc: vi.fn().mockImplementation((_fnName: string, _args?: unknown) => {
      return Promise.resolve({ data: null, error: null });
    }),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn().mockReturnThis(),
    }),
  };
}
