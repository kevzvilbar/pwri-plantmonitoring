import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, differenceInHours } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { usePermission } from '@/hooks/usePermission';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  type AppraisalTier,
  APPRAISAL_TIERS,
  getAppraisalTier,
} from '@/lib/appraisal';

export type ScorecardStatus = 'good' | 'watch' | 'at_risk' | 'unmonitored';

export interface ScorecardRow {
  plant_id: string;
  plant_name: string;
  manager_ids: string[];
  manager_names: string[];
  wells_completeness_pct: number | null;
  locators_completeness_pct: number | null;
  trains_completeness_pct: number | null;
  meters_completeness_pct: number | null;
  power_completeness_pct: number | null;
  chemicals_completeness_pct: number | null;
  overall_completeness_pct: number | null;
  readings_in_window: number;
  flagged_in_window: number;
  error_rate_pct: number | null;
  unexplained_gaps_in_window: number;
  open_pending_review_count: number;
  open_pending_review_oldest_days: number;
  open_correction_count: number;
  open_correction_oldest_days: number;
  status: ScorecardStatus;
}

export interface CorrectionRequestRow {
  id: string;
  plant_id: string;
  status: string;
  submitted_by: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PlantCorrInfo {
  pending: number;
  pendingReviews: number;
  pendingReqs: number;
  approved: number;
  rejected: number;
  total: number;
  avgHours: number | null;
  oldestPendingHours: number;
}

export interface ManagerRollupRow {
  id?: string;
  name: string;
  plants: string[];
  plantIds: string[];
  totalReadings: number;
  completenessSum: number;
  completenessCount: number;
  errorRateSum: number;
  openExceptions: number;
  pendingCorrections: number;
  approvedCorrections: number;
  rejectedCorrections: number;
  coveredCorrections: number;
  avgCompleteness: number | null;
  avgErrorRate: number;
  oversightScore: number;
  tier: AppraisalTier;
  statusCounts: Record<ScorecardStatus, number>;
}

export function computeManagerOversightScore(
  completenessPct: number | null,
  _errorRatePct?: number | null,
  _openExceptions?: number,
  _pendingCorrections?: number,
): { score: number; tier: AppraisalTier } {
  if (completenessPct === null) {
    return { score: 0, tier: APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1] };
  }
  const score = Math.min(100, Math.max(0, Math.round(completenessPct)));
  return {
    score,
    tier: getAppraisalTier(score),
  };
}

const STATUS_RANK: Record<ScorecardStatus, number> = {
  unmonitored: 0, at_risk: 1, watch: 2, good: 3,
};

export function useScorecardData() {
  const navigate = useNavigate();
  const canView = usePermission('manager_scorecard', 'view');
  const [days, setDays] = useState<number>(30);
  const [viewBy, setViewBy] = useState<'plant' | 'manager'>('plant');

  const from = useMemo(() => format(subDays(new Date(), days - 1), 'yyyy-MM-dd'), [days]);
  const to = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['manager-scorecard', from, to],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc('fn_manager_plant_scorecard', {
        p_from: from,
        p_to: to,
      }) as any);
      if (error) throw error;
      return (data ?? []) as ScorecardRow[];
    },
    staleTime: 2 * 60_000,
  });

  const { data: corrReqs = [], refetch: refetchCorr } = useQuery({
    queryKey: ['manager-scorecard-corr-reqs', from],
    queryFn: async () => {
      const { data: pendingData, error: pErr } = await (supabase
        .from('correction_requests' as any) as any)
        .select('id, plant_id, status, submitted_by, resolved_by, created_at, resolved_at')
        .eq('status', 'pending');
      if (pErr) console.error('Error fetching pending correction_requests:', pErr);

      const { data: resolvedData, error: rErr } = await (supabase
        .from('correction_requests' as any) as any)
        .select('id, plant_id, status, submitted_by, resolved_by, created_at, resolved_at')
        .neq('status', 'pending')
        .gte('created_at', from);
      if (rErr) console.error('Error fetching resolved correction_requests:', rErr);

      return [...(pendingData ?? []), ...(resolvedData ?? [])] as CorrectionRequestRow[];
    },
    staleTime: 2 * 60_000,
  });

  const plantCorrMap = useMemo(() => {
    const map: Record<string, PlantCorrInfo> = {};
    const now = new Date();

    rows.forEach((r) => {
      const pendingReviews = r.open_pending_review_count ?? 0;
      const pendingReqs = r.open_correction_count ?? 0;
      const oldestDays = Math.max(r.open_pending_review_oldest_days ?? 0, r.open_correction_oldest_days ?? 0);
      map[r.plant_id] = {
        pending: pendingReviews + pendingReqs,
        pendingReviews,
        pendingReqs,
        approved: 0,
        rejected: 0,
        total: pendingReviews + pendingReqs,
        avgHours: null,
        oldestPendingHours: oldestDays * 24,
      };
    });

    const clientReqsPendingByPlant: Record<string, number> = {};
    corrReqs.forEach((r) => {
      if (!map[r.plant_id]) {
        map[r.plant_id] = {
          pending: 0, pendingReviews: 0, pendingReqs: 0,
          approved: 0, rejected: 0, total: 0, avgHours: null, oldestPendingHours: 0,
        };
      }
      const entry = map[r.plant_id];

      if (r.status === 'pending') {
        clientReqsPendingByPlant[r.plant_id] = (clientReqsPendingByPlant[r.plant_id] ?? 0) + 1;
        const hoursWaiting = differenceInHours(now, new Date(r.created_at));
        if (hoursWaiting > entry.oldestPendingHours) {
          entry.oldestPendingHours = hoursWaiting;
        }
      } else if (r.status === 'approved') {
        entry.approved++;
        entry.total++;
      } else if (r.status === 'rejected') {
        entry.rejected++;
        entry.total++;
      }
    });

    Object.entries(clientReqsPendingByPlant).forEach(([plantId, count]) => {
      const entry = map[plantId];
      if (entry && count > entry.pendingReqs) {
        entry.pendingReqs = count;
        entry.pending = entry.pendingReviews + count;
      }
    });

    return map;
  }, [rows, corrReqs]);

  const managerRollup = useMemo(() => {
    const managers: Record<string, ManagerRollupRow> = {};

    rows.forEach((r) => {
      const plantNames = r.manager_names.length ? r.manager_names : ['Unassigned'];
      plantNames.forEach((name, idx) => {
        const mgrId = r.manager_ids?.[idx];
        const key = mgrId || name;

        if (!managers[key]) {
          managers[key] = {
            id: mgrId,
            name,
            plants: [],
            plantIds: [],
            totalReadings: 0,
            completenessSum: 0,
            completenessCount: 0,
            errorRateSum: 0,
            openExceptions: 0,
            pendingCorrections: 0,
            approvedCorrections: 0,
            rejectedCorrections: 0,
            coveredCorrections: 0,
            avgCompleteness: null,
            avgErrorRate: 0,
            oversightScore: 0,
            tier: APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1],
            statusCounts: { good: 0, watch: 0, at_risk: 0, unmonitored: 0 },
          };
        }
        const m = managers[key];
        m.plants.push(r.plant_name);
        m.plantIds.push(r.plant_id);
        m.totalReadings += r.readings_in_window;
        if (r.overall_completeness_pct !== null) {
          m.completenessSum += r.overall_completeness_pct;
          m.completenessCount++;
        }
        m.errorRateSum += (r.error_rate_pct ?? 0);
        const corr = plantCorrMap[r.plant_id];
        const plantPending = corr ? corr.pending : ((r.open_pending_review_count ?? 0) + (r.open_correction_count ?? 0));
        m.pendingCorrections += plantPending;
        m.openExceptions += (r.unexplained_gaps_in_window ?? 0) + plantPending;
        m.statusCounts[r.status] = (m.statusCounts[r.status] ?? 0) + 1;
      });
    });

    Object.values(managers).forEach((m) => {
      const assignedPlantSet = new Set(m.plantIds);
      corrReqs.forEach((r) => {
        if (!assignedPlantSet.has(r.plant_id)) return;
        if (m.id && r.resolved_by === m.id) {
          if (r.status === 'approved') m.approvedCorrections++;
          else if (r.status === 'rejected') m.rejectedCorrections++;
        } else if (r.status === 'approved' || r.status === 'rejected') {
          m.coveredCorrections++;
        }
      });
    });

    return Object.values(managers).map((m) => {
      const avgCompleteness = m.completenessCount > 0 ? m.completenessSum / m.completenessCount : null;
      const avgErrorRate = m.plants.length > 0 ? m.errorRateSum / m.plants.length : 0;
      const oversight = computeManagerOversightScore(avgCompleteness, avgErrorRate, m.openExceptions, m.pendingCorrections);

      return {
        ...m,
        avgCompleteness,
        avgErrorRate,
        oversightScore: oversight.score,
        tier: oversight.tier,
      };
    }).sort((a, b) => b.oversightScore - a.oversightScore);
  }, [rows, plantCorrMap, corrReqs]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.plant_name.localeCompare(b.plant_name)),
    [rows],
  );

  const summary = useMemo(() => {
    const monitored = rows.filter((r) => r.status !== 'unmonitored').length;
    const withCompleteness = rows.filter((r) => r.overall_completeness_pct !== null);
    const avgCompleteness = withCompleteness.length
      ? withCompleteness.reduce((sum, r) => sum + (r.overall_completeness_pct ?? 0), 0) / withCompleteness.length
      : null;
    const totalPendingCorrections = Object.values(plantCorrMap).reduce((sum, c) => sum + c.pending, 0);
    const totalUnexplainedGaps = rows.reduce((sum, r) => sum + (r.unexplained_gaps_in_window ?? 0), 0);
    const openExceptions = totalUnexplainedGaps + totalPendingCorrections;
    const atRisk = rows.filter((r) => r.status === 'at_risk' || r.status === 'unmonitored').length;

    const fleetOversight = computeManagerOversightScore(avgCompleteness, null, openExceptions, totalPendingCorrections);

    return {
      monitored,
      total: rows.length,
      avgCompleteness,
      openExceptions,
      totalPendingCorrections,
      atRisk,
      fleetOversightScore: fleetOversight.score,
      fleetTier: fleetOversight.tier,
    };
  }, [rows, plantCorrMap]);

  const exportManagerScorecardCsv = () => {
    const headers = [
      'Manager Name',
      'Assigned Plants',
      'Monitored Operator Readings',
      'Data Completeness %',
      'Open Exceptions / Gaps',
      'Pending Correction Approvals',
      'Approved Corrections',
      'Rejected Corrections',
      'Manager Oversight Score %',
      'Appraisal Rating Tier',
      'Evaluation Window',
    ];

    const rowsData = managerRollup.map((m) => [
      `"${m.name}"`,
      `"${m.plants.join(', ')}"`,
      `"${m.totalReadings}"`,
      `"${m.avgCompleteness ? m.avgCompleteness.toFixed(1) + '%' : 'N/A'}"`,
      `"${m.openExceptions}"`,
      `"${m.pendingCorrections}"`,
      `"${m.approvedCorrections}"`,
      `"${m.rejectedCorrections}"`,
      `"${m.oversightScore}%"`,
      `"${m.tier.tier}"`,
      `"${days} Days"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rowsData.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `manager_oversight_scorecard_${days}d_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Manager Scorecard exported successfully.');
  };

  const handleRefresh = () => {
    refetch();
    refetchCorr();
  };

  return {
    canView, navigate, days, setDays, viewBy, setViewBy,
    rows, isLoading, error, refetch, isFetching, corrReqs, refetchCorr,
    plantCorrMap, managerRollup, sorted, summary,
    exportManagerScorecardCsv, handleRefresh,
  };
}

export function pctColor(pct: number | null): string {
  if (pct === null) return 'bg-muted-foreground/30';
  return getAppraisalTier(pct).dot;
}

export function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`;
}
