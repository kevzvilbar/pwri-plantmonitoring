import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { registerOfflineMutationDefaults } from './offlineMutations';

describe('offlineMutations defaults registry', () => {
  it('registers mutationFn for all expected offline mutation keys', () => {
    const client = new QueryClient();
    registerOfflineMutationDefaults(client);

    const keys = [
      ['save-locator-reading'],
      ['save-well-reading'],
      ['save-well-power'],
      ['save-well-tds'],
      ['save-well-ntu'],
      ['save-well-pressure'],
      ['save-well-shared-power'],
      ['save-well-gap-reason'],
      ['save-ro-reading'],
      ['save-pretreatment-reading'],
    ];

    for (const key of keys) {
      const defaults = client.getMutationDefaults(key);
      expect(defaults, `Mutation defaults for ${key.join('.')}`).toBeDefined();
      expect(defaults?.mutationFn, `MutationFn for ${key.join('.')}`).toBeTypeOf('function');
    }
  });
});
