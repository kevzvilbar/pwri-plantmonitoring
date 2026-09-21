import { describe, it, expect } from 'vitest';
import {
  normalizeStatus, statusMeta, countByStatus, filterByStatus, describeChange,
  buildMyRequest, refKey, EMPTY_CONTEXT,
  type CorrectionRequestRow, type RequestContext, type MyCorrectionRequest,
} from './myCorrections';

const row = (over: Partial<CorrectionRequestRow> = {}): CorrectionRequestRow => ({
  id: 'r1', source_table: 'well_readings', source_id: 'rd1', plant_id: 'p1',
  original_value: 1234, proposed_value: 1243, reason: 'Meter misread', note: null,
  status: 'pending', resolved_by: null, resolved_at: null, resolution_note: null,
  created_at: '2026-09-20T08:00:00Z', ...over,
});

const ctx: RequestContext = {
  readings: { [refKey('well_readings', 'rd1')]: { entityId: 'w3', readingAt: '2026-09-20T06:00:00Z' } },
  entityNames: { [refKey('well_readings', 'w3')]: 'Well 3' },
  plantNames: { p1: 'North Plant' },
  userNames: { boss: '@maria' },
};

describe('normalizeStatus', () => {
  it('recognises the four database statuses, case- and space-insensitively', () => {
    expect(normalizeStatus('pending')).toBe('pending');
    expect(normalizeStatus(' Approved ')).toBe('approved');
    expect(normalizeStatus('REJECTED')).toBe('rejected');
    expect(normalizeStatus('withdrawn')).toBe('withdrawn');
  });
  it('maps anything else to unknown instead of mislabelling it', () => {
    expect(normalizeStatus('escalated')).toBe('unknown');
    expect(normalizeStatus('')).toBe('unknown');
    expect(normalizeStatus(null)).toBe('unknown');
    expect(normalizeStatus(undefined)).toBe('unknown');
  });
});

describe('statusMeta', () => {
  it('has a label, tone and hint for every status', () => {
    for (const s of ['pending', 'approved', 'rejected', 'withdrawn', 'unknown'] as const) {
      const m = statusMeta(s);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.hint.length).toBeGreaterThan(0);
    }
  });
  it('uses distinct tones for the states an operator cares about', () => {
    expect(statusMeta('pending').tone).toBe('warn');
    expect(statusMeta('approved').tone).toBe('good');
    expect(statusMeta('rejected').tone).toBe('danger');
  });
});

describe('countByStatus / filterByStatus', () => {
  const reqs = ['pending', 'pending', 'approved', 'rejected', 'withdrawn', 'unknown'].map(
    (status, i) => ({ id: String(i), status }) as Pick<MyCorrectionRequest, 'status'> & { id: string },
  );

  it('counts each status and the total', () => {
    expect(countByStatus(reqs)).toEqual({ all: 6, pending: 2, approved: 1, rejected: 1, withdrawn: 1, unknown: 1 });
  });
  it('counts nothing for an empty list', () => {
    expect(countByStatus([])).toEqual({ all: 0, pending: 0, approved: 0, rejected: 0, withdrawn: 0, unknown: 0 });
  });
  it('"all" keeps everything, including withdrawn and unknown', () => {
    expect(filterByStatus(reqs, 'all')).toHaveLength(6);
  });
  it('filters to one status', () => {
    expect(filterByStatus(reqs, 'pending').map((r) => r.id)).toEqual(['0', '1']);
    expect(filterByStatus(reqs, 'rejected').map((r) => r.id)).toEqual(['3']);
  });
  it('does not mutate its input', () => {
    const copy = [...reqs];
    filterByStatus(reqs, 'all');
    expect(reqs).toEqual(copy);
  });
});

describe('describeChange', () => {
  it('describes an increase', () => {
    expect(describeChange(1234, 1243)).toEqual({ from: '1,234.00', to: '1,243.00', delta: '+9.00', direction: 'up' });
  });
  it('describes a decrease with a minus sign', () => {
    expect(describeChange(50, 41.5)).toMatchObject({ delta: '-8.50', direction: 'down' });
  });
  it('describes no change without a sign', () => {
    expect(describeChange(10, 10)).toMatchObject({ delta: '0.00', direction: 'same' });
  });
  it('does not show float noise as a change', () => {
    expect(describeChange(0.3, 0.1 + 0.2)).toMatchObject({ delta: '0.00', direction: 'same' });
  });
});

describe('buildMyRequest', () => {
  it('names the well, plant and reading time when they could be looked up', () => {
    const r = buildMyRequest(row(), ctx);
    expect(r.title).toBe('Well 3');
    expect(r.subtitle).toBe('Well · North Plant');
    expect(r.readingAt).toBe('2026-09-20T06:00:00Z');
    expect(r.status).toBe('pending');
    expect(r.originalValue).toBe(1234);
    expect(r.proposedValue).toBe(1243);
  });

  it('still produces a usable request when NOTHING could be looked up', () => {
    const r = buildMyRequest(row(), EMPTY_CONTEXT);
    expect(r.title).toBe('Well reading');
    expect(r.subtitle).toBe('Well');
    expect(r.readingAt).toBeNull();
    expect(r.reason).toBe('Meter misread');
  });

  it('degrades one missing lookup at a time', () => {
    expect(buildMyRequest(row(), { ...ctx, plantNames: {} }).subtitle).toBe('Well');
    expect(buildMyRequest(row(), { ...ctx, entityNames: {} }).title).toBe('Well reading');
  });

  it('labels each kind of reading', () => {
    expect(buildMyRequest(row({ source_table: 'locator_readings' })).title).toBe('Locator reading');
    expect(buildMyRequest(row({ source_table: 'product_meter_readings' })).title).toBe('Product Meter reading');
    expect(buildMyRequest(row({ source_table: 'ro_train_readings' })).title).toBe('RO Train reading');
    expect(buildMyRequest(row({ source_table: 'something_new' })).title).toBe('Reading');
    expect(buildMyRequest(row({ source_table: 'something_new' })).subtitle).toBe('Reading');
  });

  it('keeps the reviewer, date and note of a resolved request', () => {
    const r = buildMyRequest(
      row({ status: 'rejected', resolved_by: 'boss', resolved_at: '2026-09-20T10:00:00Z', resolution_note: '  Meter was checked, reading is correct.  ' }),
      ctx,
    );
    expect(r.status).toBe('rejected');
    expect(r.resolvedByName).toBe('@maria');
    expect(r.resolvedAt).toBe('2026-09-20T10:00:00Z');
    expect(r.resolutionNote).toBe('Meter was checked, reading is correct.');
  });

  it("does not invent a reviewer's name when it cannot be resolved", () => {
    const r = buildMyRequest(row({ status: 'approved', resolved_by: 'someone-else' }), ctx);
    expect(r.resolvedByName).toBeNull();
  });

  it('treats blank notes as no note', () => {
    const r = buildMyRequest(row({ note: '   ', resolution_note: '' }), ctx);
    expect(r.note).toBeNull();
    expect(r.resolutionNote).toBeNull();
  });

  it('coerces numeric strings from the database', () => {
    const r = buildMyRequest(row({ original_value: '10.5' as unknown as number, proposed_value: '12' as unknown as number }), ctx);
    expect(r.originalValue).toBe(10.5);
    expect(r.proposedValue).toBe(12);
  });

  it('keeps an unrecognised status visible instead of hiding the request', () => {
    const r = buildMyRequest(row({ status: 'escalated' }), ctx);
    expect(r.status).toBe('unknown');
    expect(r.rawStatus).toBe('escalated');
  });
});
