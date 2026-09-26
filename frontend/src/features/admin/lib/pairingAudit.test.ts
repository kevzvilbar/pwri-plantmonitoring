import { describe, it, expect } from 'vitest';
import { buildPairingAuditReport, type ShiftDutyRecord } from './pairingAudit';

describe('buildPairingAuditReport', () => {
  it('correctly aggregates pair frequencies and independent activity signals', () => {
    const dutyLogs: ShiftDutyRecord[] = [
      {
        plant_id: 'plant-1',
        operator_id: 'user-a',
        partner_operator_id: 'user-b',
        is_dual_duty: true,
        cycle_key: '2026-09-01-S1',
        declared_at: '2026-09-01T08:00:00+08:00',
      },
      {
        plant_id: 'plant-1',
        operator_id: 'user-a',
        partner_operator_id: 'user-b',
        is_dual_duty: true,
        cycle_key: '2026-09-02-S1',
        declared_at: '2026-09-02T08:00:00+08:00',
      },
      {
        plant_id: 'plant-1',
        operator_id: 'user-c',
        partner_operator_id: null,
        is_dual_duty: false,
        cycle_key: '2026-09-01-S1',
        declared_at: '2026-09-01T08:00:00+08:00',
      },
    ];

    const readings = [
      // user-b logged a reading on Day 1
      { plant_id: 'plant-1', recorded_by: 'user-b', reading_datetime: '2026-09-01T09:00:00+08:00' },
    ];

    const report = buildPairingAuditReport(dutyLogs, [], readings);

    expect(report.totalDualDutyShifts).toBe(2);
    expect(report.unpairedSoloShifts).toBe(1);
    expect(report.uniquePairingsCount).toBe(1);

    const pair = report.pairings[0];
    expect(pair.totalShifts).toBe(2);
    expect(pair.shiftsWithPartnerActivity).toBe(1);
    expect(pair.activityRatePct).toBe(50);
  });
});
