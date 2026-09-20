import { describe, it, expect } from 'vitest';
import {
  wellsListPath, wellDetailPath, FROM_WELLS_LIST, cameFromWellsList, resolveWellView,
} from './wellRoutes';

describe('well paths (P5-3)', () => {
  it('builds the list and detail URLs', () => {
    expect(wellsListPath('p1')).toBe('/plants/p1?tab=wells');
    expect(wellDetailPath('p1', 'w9')).toBe('/plants/p1/wells/w9');
  });
});

describe('cameFromWellsList', () => {
  it('recognises the marker the list attaches', () => {
    expect(cameFromWellsList(FROM_WELLS_LIST)).toBe(true);
  });
  it('is false for anything else, including no state', () => {
    expect(cameFromWellsList(null)).toBe(false);
    expect(cameFromWellsList(undefined)).toBe(false);
    expect(cameFromWellsList('x')).toBe(false);
    expect(cameFromWellsList({})).toBe(false);
    expect(cameFromWellsList({ fromWellsList: 'yes' })).toBe(false);
  });
});

describe('resolveWellView', () => {
  const well = { plant_id: 'p1' };

  it('is ready for a well in this plant', () => {
    expect(resolveWellView({ well, isLoading: false, isError: false, plantId: 'p1' })).toBe('ready');
  });
  it('is loading while the query is in flight, not "not found"', () => {
    expect(resolveWellView({ well: undefined, isLoading: true, isError: false, plantId: 'p1' })).toBe('loading');
  });
  it('is not-found for an unknown or RLS-hidden id (query resolved with no row), never an endless spinner', () => {
    expect(resolveWellView({ well: null, isLoading: false, isError: false, plantId: 'p1' })).toBe('not-found');
  });
  it('is error, not not-found, when the request itself failed', () => {
    expect(resolveWellView({ well: undefined, isLoading: false, isError: true, plantId: 'p1' })).toBe('error');
  });
  it("is not-found when the well belongs to a different plant than the URL's", () => {
    expect(resolveWellView({ well: { plant_id: 'p2' }, isLoading: false, isError: false, plantId: 'p1' })).toBe('not-found');
  });
  it('skips the ownership check when no plant is given', () => {
    expect(resolveWellView({ well: { plant_id: 'p2' }, isLoading: false, isError: false })).toBe('ready');
  });
  it('trusts a row that has no plant_id column value', () => {
    expect(resolveWellView({ well: { plant_id: null }, isLoading: false, isError: false, plantId: 'p1' })).toBe('ready');
  });
});
