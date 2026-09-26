/**
 * pairingAudit.ts — Phase 3: Pairing pattern analysis & audit utility
 *
 * Surfaces pair-duty patterns, partner frequencies, and independent activity
 * signals to help Admins/Managers monitor pairing fairness and verify attendance.
 */
import { fmtIsoDate } from '@/lib/format';

export interface ShiftDutyRecord {
  id?: string;
  plant_id: string;
  operator_id: string;
  partner_operator_id: string | null;
  is_dual_duty: boolean;
  cycle_key: string;
  declared_at: string;
  ended_at?: string | null;
}

export interface OperatorSwitchRecord {
  plant_id: string;
  from_operator_id: string;
  to_operator_id: string;
  switched_by: string;
  created_at?: string;
}

export interface ReadingActivityRecord {
  plant_id: string;
  recorded_by: string | null;
  reading_datetime?: string;
}

export interface PairingSummary {
  operatorIdA: string;
  operatorIdB: string;
  pairKey: string; // sorted "idA:idB"
  totalShifts: number;
  shiftsWithPartnerActivity: number;
  activityRatePct: number;
  lastDeclaredAt: string;
}

export interface PairingAuditReport {
  totalDualDutyShifts: number;
  uniquePairingsCount: number;
  pairings: PairingSummary[];
  unpairedSoloShifts: number;
  flaggedZeroActivityPairings: PairingSummary[];
}

export function buildPairingAuditReport(
  dutyLogs: ShiftDutyRecord[],
  switchLogs: OperatorSwitchRecord[] = [],
  readings: ReadingActivityRecord[] = [],
): PairingAuditReport {
  const pairMap: Record<string, {
    operatorIdA: string;
    operatorIdB: string;
    dates: Set<string>;
    datesWithPartnerActivity: Set<string>;
    lastDeclaredAt: string;
  }> = {};

  let unpairedSoloShifts = 0;
  let totalDualDutyShifts = 0;

  // Build activity index by operator and day: opId:plantId:day -> boolean
  const activityIndex = new Set<string>();

  readings.forEach((r) => {
    if (r.recorded_by && r.reading_datetime) {
      const day = fmtIsoDate(r.reading_datetime);
      activityIndex.add(`${r.recorded_by}:${r.plant_id}:${day}`);
    }
  });

  switchLogs.forEach((s) => {
    if (s.created_at) {
      const day = fmtIsoDate(s.created_at);
      if (s.switched_by) activityIndex.add(`${s.switched_by}:${s.plant_id}:${day}`);
      if (s.from_operator_id) activityIndex.add(`${s.from_operator_id}:${s.plant_id}:${day}`);
    }
  });

  dutyLogs.forEach((log) => {
    const isDual = log.is_dual_duty && Boolean(log.partner_operator_id) && log.partner_operator_id !== log.operator_id;
    const day = fmtIsoDate(log.declared_at);

    if (!isDual || !log.partner_operator_id) {
      unpairedSoloShifts++;
      return;
    }

    totalDualDutyShifts++;
    const [idA, idB] = [log.operator_id, log.partner_operator_id].sort();
    const pairKey = `${idA}:${idB}`;

    if (!pairMap[pairKey]) {
      pairMap[pairKey] = {
        operatorIdA: idA,
        operatorIdB: idB,
        dates: new Set(),
        datesWithPartnerActivity: new Set(),
        lastDeclaredAt: log.declared_at,
      };
    }

    const entry = pairMap[pairKey];
    entry.dates.add(day);

    if (new Date(log.declared_at).getTime() > new Date(entry.lastDeclaredAt).getTime()) {
      entry.lastDeclaredAt = log.declared_at;
    }

    // Check if partner (or either member) had independent activity
    const partnerId = log.partner_operator_id;
    const hasActivity = activityIndex.has(`${partnerId}:${log.plant_id}:${day}`);
    if (hasActivity) {
      entry.datesWithPartnerActivity.add(day);
    }
  });

  const pairings: PairingSummary[] = Object.entries(pairMap).map(([pairKey, data]) => {
    const totalShifts = data.dates.size;
    const shiftsWithPartnerActivity = data.datesWithPartnerActivity.size;
    const activityRatePct = totalShifts > 0 ? Math.round((shiftsWithPartnerActivity / totalShifts) * 100) : 0;

    return {
      operatorIdA: data.operatorIdA,
      operatorIdB: data.operatorIdB,
      pairKey,
      totalShifts,
      shiftsWithPartnerActivity,
      activityRatePct,
      lastDeclaredAt: data.lastDeclaredAt,
    };
  }).sort((a, b) => b.totalShifts - a.totalShifts);

  const flaggedZeroActivityPairings = pairings.filter((p) => p.totalShifts >= 3 && p.activityRatePct === 0);

  return {
    totalDualDutyShifts,
    uniquePairingsCount: pairings.length,
    pairings,
    unpairedSoloShifts,
    flaggedZeroActivityPairings,
  };
}
