import { describe, it, expect } from 'vitest';
import { buildNavConfig } from '@/navConfig';

const items = buildNavConfig(() => true).flatMap((g) => g.items);

describe('nav badges', () => {
  it('Alerts carries the alerts badge; Admin Console carries the approvals badge', () => {
    expect(items.find((i) => i.id === 'alerts')?.badge).toBe('alerts');
    expect(items.find((i) => i.id === 'admin')?.badge).toBe('approvals');
  });

  it('no other item has a badge', () => {
    const badged = items.filter((i) => i.badge).map((i) => i.id).sort();
    expect(badged).toEqual(['admin', 'alerts']);
  });
});
