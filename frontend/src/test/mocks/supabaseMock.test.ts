import { describe, it, expect } from 'vitest';
import { createSupabaseQueryMock, createSupabaseClientMock } from './supabaseMock';

describe('Supabase Mocks', () => {
  describe('createSupabaseQueryMock', () => {
    it('should be chainable', () => {
      const queryMock = createSupabaseQueryMock([{ id: 1 }]);
      expect(queryMock.select()).toBe(queryMock);
      expect(queryMock.eq()).toBe(queryMock);
      expect(queryMock.order()).toBe(queryMock);
      expect(queryMock.limit()).toBe(queryMock);
    });

    it('should resolve data as an array when used as a promise', async () => {
      const data = [{ id: 1 }, { id: 2 }];
      const queryMock = createSupabaseQueryMock(data);
      const result = await (queryMock as any);
      expect(result.data).toEqual(data);
      expect(result.error).toBeNull();
    });

    it('should resolve single item with .single()', async () => {
      const data = [{ id: 1 }, { id: 2 }];
      const queryMock = createSupabaseQueryMock(data);
      const result = await queryMock.single();
      expect(result.data).toEqual({ id: 1 });
      expect(result.error).toBeNull();
    });

    it('should resolve single item with .maybeSingle()', async () => {
      const data = { id: 1 };
      const queryMock = createSupabaseQueryMock(data);
      const result = await queryMock.maybeSingle();
      expect(result.data).toEqual({ id: 1 });
      expect(result.error).toBeNull();
    });
  });

  describe('createSupabaseClientMock', () => {
    it('should return query mock with table data via .from()', async () => {
      const client = createSupabaseClientMock({ users: [{ id: 'user-1' }] });
      const result = await client.from('users');
      expect(result.data).toEqual([{ id: 'user-1' }]);
    });

    it('should return empty array for unknown table via .from()', async () => {
      const client = createSupabaseClientMock();
      const result = await client.from('unknown');
      expect(result.data).toEqual([]);
    });

    it('should mock .rpc() returning null data', async () => {
      const client = createSupabaseClientMock();
      const result = await client.rpc('some_func');
      expect(result.data).toBeNull();
      expect(result.error).toBeNull();
    });

    it('should mock auth methods', async () => {
      const client = createSupabaseClientMock();
      const sessionResult = await client.auth.getSession();
      expect(sessionResult.data.session).toBeNull();
      
      const userResult = await client.auth.getUser();
      expect(userResult.data.user).toBeNull();

      const authChangeResult = client.auth.onAuthStateChange();
      expect(authChangeResult.data.subscription.unsubscribe).toBeDefined();
    });

    it('should mock channel methods', () => {
      const client = createSupabaseClientMock();
      const channel = client.channel('test');
      expect(channel.on()).toBe(channel);
      expect(channel.subscribe()).toBe(channel);
      expect(channel.unsubscribe()).toBe(channel);
    });
  });
});
