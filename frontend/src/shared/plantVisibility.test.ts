import { describe, it, expect } from 'vitest';
import { ALL_PLANT_ROLES, resolveVisiblePlants, seesAllPlants } from './plantVisibility';

const PLANTS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('seesAllPlants (D5)', () => {
  it.each(['Admin', 'Manager', 'Data Analyst'])('%s sees every plant', (role) => {
    expect(seesAllPlants([role])).toBe(true);
  });

  it.each(['Operator', 'Technician'])('%s does not', (role) => {
    expect(seesAllPlants([role])).toBe(false);
  });

  it('grants all-plant visibility if any one role qualifies', () => {
    expect(seesAllPlants(['Operator', 'Manager'])).toBe(true);
  });

  it('is false for no roles, null and undefined', () => {
    expect(seesAllPlants([])).toBe(false);
    expect(seesAllPlants(null)).toBe(false);
    expect(seesAllPlants(undefined)).toBe(false);
  });

  it('covers exactly the roles the database helper does', () => {
    expect([...ALL_PLANT_ROLES].sort()).toEqual(['Admin', 'Data Analyst', 'Manager']);
  });
});

describe('resolveVisiblePlants (D5)', () => {
  it('gives the all-plants group everything, whatever they are assigned', () => {
    expect(resolveVisiblePlants(PLANTS, ['Manager'], [])).toEqual(PLANTS);
    expect(resolveVisiblePlants(PLANTS, ['Data Analyst'], ['a'])).toEqual(PLANTS);
  });

  it('returns the same array reference for the all-plants group', () => {
    expect(resolveVisiblePlants(PLANTS, ['Admin'], [])).toBe(PLANTS);
  });

  it('limits everyone else to their assigned plants', () => {
    expect(resolveVisiblePlants(PLANTS, ['Operator'], ['a', 'c'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(resolveVisiblePlants(PLANTS, ['Technician'], ['b'])).toEqual([{ id: 'b' }]);
  });

  it('gives an unassigned non-privileged user NO plants (no fall-back to all)', () => {
    expect(resolveVisiblePlants(PLANTS, ['Operator'], [])).toEqual([]);
    expect(resolveVisiblePlants(PLANTS, ['Technician'], null)).toEqual([]);
    expect(resolveVisiblePlants(PLANTS, [], undefined)).toEqual([]);
  });

  it('ignores assignments that point at plants that no longer exist', () => {
    expect(resolveVisiblePlants(PLANTS, ['Operator'], ['a', 'deleted'])).toEqual([{ id: 'a' }]);
    expect(resolveVisiblePlants(PLANTS, ['Operator'], ['deleted'])).toEqual([]);
  });

  it('preserves the input order', () => {
    expect(resolveVisiblePlants(PLANTS, ['Operator'], ['c', 'a'])).toEqual([{ id: 'a' }, { id: 'c' }]);
  });
});
