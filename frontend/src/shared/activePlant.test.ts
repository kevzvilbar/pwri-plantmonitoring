import { describe, it, expect } from 'vitest';
import { resolveActivePlant, isStaleSelection } from './activePlant';

const A = { id: 'a', name: 'Alpha' };
const B = { id: 'b', name: 'Bravo' };
const C = { id: 'c', name: 'Charlie' };

describe('resolveActivePlant', () => {
  it('returns the selected plant when the user can see it', () => {
    expect(resolveActivePlant([A, B, C], 'b')).toEqual({ plant: B, needsSelection: false });
  });

  it('asks (no fallback to the first plant) when several are visible and none is chosen', () => {
    const r = resolveActivePlant([A, B, C], null);
    expect(r.plant).toBeNull();
    expect(r.needsSelection).toBe(true);
  });

  it('uses the only visible plant when nothing is chosen: "All plants" and that plant are the same set', () => {
    expect(resolveActivePlant([B], null)).toEqual({ plant: B, needsSelection: false });
  });

  it('ignores a stored selection the user cannot see, and asks', () => {
    const r = resolveActivePlant([A, B], 'zzz');
    expect(r.plant).toBeNull();
    expect(r.needsSelection).toBe(true);
  });

  it('ignores a stale selection but still resolves a single visible plant', () => {
    expect(resolveActivePlant([A], 'zzz')).toEqual({ plant: A, needsSelection: false });
  });

  it('needs nothing from the caller when there are no visible plants', () => {
    expect(resolveActivePlant([], null)).toEqual({ plant: null, needsSelection: false });
    expect(resolveActivePlant([], 'a')).toEqual({ plant: null, needsSelection: false });
  });
});

describe('isStaleSelection', () => {
  it('is never stale when nothing is selected', () => {
    expect(isStaleSelection([A, B], null, false)).toBe(false);
    expect(isStaleSelection([], undefined, true)).toBe(false);
  });

  it('is stale when the selection is not among the visible plants', () => {
    expect(isStaleSelection([A, B], 'c', false)).toBe(true);
  });

  it('is not stale when the selection is visible', () => {
    expect(isStaleSelection([A, B], 'b', false)).toBe(false);
  });

  it('is stale for a user with no plants at all (needs assignment)', () => {
    expect(isStaleSelection([], 'a', true)).toBe(true);
  });

  it('is NOT stale when the plant list is merely empty (may not have loaded, e.g. offline)', () => {
    expect(isStaleSelection([], 'a', false)).toBe(false);
  });
});
