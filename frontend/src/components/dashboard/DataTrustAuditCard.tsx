import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Scale,
  ClipboardCheck,
  Activity,
  History,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { usePendingCount, useCorrectionRequestsCount, useEditHistory } from '@/data/hooks/useCorrections';
import { useReconciliationHealthTotals } from '@/components/dashboard/ReconciliationHealthCard/useReconciliationHealthTotals';
import { ComplianceRadarCard } from '@/components/dashboard/ComplianceRadarCard';
import { useAppStore } from '@/store/appStore';
import { formatRangeLabel, rangeKeyToDays } from './types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface DataTrustAuditCardProps {
  plantIds: string[];
}

export function DataTrustAuditCard({ plantIds }: DataTrustAuditCardProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'gates' | 'radar'>('gates');

  const chartRange = useAppStore((s) => s.chartRange);
  const chartFrom = useAppStore((s) => s.chartFrom);
  const chartTo = useAppStore((s) => s.chartTo);
  const rangeLabel = formatRangeLabel(chartRange, chartFrom, chartTo);

  // ── Gate Queries ─────────────────────────────────────────────────────────────
  // Gate 1: Pending flags & corrections awaiting review
  const { data: pendingReadingsCount = 0 } = usePendingCount();
  const { data: pendingCorrCount = 0 } = useCorrectionRequestsCount();
  const totalPendingFlags = pendingReadingsCount + pendingCorrCount;

  // Gate 2: Mass balance reconciliation
  const { rows: reconRows } = useReconciliationHealthTotals(plantIds);
  const hasReconAlert = reconRows.some((r) => r.result.status === 'alert');
  const hasReconMarginal = reconRows.some((r) => r.result.status === 'marginal');

  // Gate 3: Recent audit normalizations trail
  const { data: auditHistory = [] } = useEditHistory(2);

  // ── Evaluated Gate Statuses ──────────────────────────────────────────────────
  const gates = useMemo(() => {
    return [
      {
        id: 'completeness',
        title: 'Telemetry Capture Gate',
        subtitle: 'Expected daily logs received across entities',
        target: '≥ 90% target',
        status: 'warn' as const,
        statusLabel: 'Partial Data',
        onClick: () => navigate('/operations'),
        icon: ClipboardCheck,
      },
      {
        id: 'reconciliation',
        title: 'Mass Balance Gate',
        subtitle: 'Intake vs permeate & reject conservation',
        target: '≤ 5.0% variance',
        status: hasReconAlert ? ('danger' as const) : hasReconMarginal ? ('warn' as const) : ('accent' as const),
        statusLabel: hasReconAlert ? 'Imbalance' : hasReconMarginal ? 'Marginal' : 'Balanced',
        onClick: () => {
          const el = document.getElementById('overview-cluster');
          el?.scrollIntoView({ behavior: 'smooth' });
        },
        icon: Scale,
      },
      {
        id: 'corrections',
        title: 'Data Integrity Gate',
        subtitle: 'Flagged outlier readings & operator edits',
        target: '0 unreviewed flags',
        status: totalPendingFlags > 0 ? ('warn' as const) : ('accent' as const),
        statusLabel: totalPendingFlags > 0 ? `${totalPendingFlags} Flagged` : 'Clean',
        onClick: () => navigate('/data-corrections'),
        icon: ShieldAlert,
      },
      {
        id: 'compliance',
        title: 'Quality Standards Gate',
        subtitle: 'Permeate TDS, NTU, Recovery & pH limits',
        target: '0 regulatory breaches',
        status: 'accent' as const,
        statusLabel: 'Verified',
        onClick: () => navigate('/compliance'),
        icon: Activity,
      },
    ];
  }, [hasReconAlert, hasReconMarginal, totalPendingFlags, navigate]);

  // Overall Trust Grade Calculation
  const passedGates = gates.filter((g) => g.status === 'accent').length;
  const hasDanger = gates.some((g) => g.status === 'danger');
  const trustGrade = hasDanger ? 'Grade C · Gated' : passedGates >= 3 ? 'Grade B+ · Provisional' : 'Grade A · Audit-Ready';
  const trustColor = hasDanger
    ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30'
    : passedGates >= 3
      ? 'text-amber-700 dark:text-amber-300 bg-amber-500/15 border-amber-500/30'
      : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30';

  if (activeTab === 'radar') {
    return (
      <div className="relative">
        <div className="absolute top-3 right-3 z-10">
          <div className="inline-flex rounded-lg bg-muted/60 p-0.5 border border-border/60 text-2xs">
            <button
              type="button"
              onClick={() => setActiveTab('gates')}
              className="px-2 py-0.5 rounded-md font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Audit Gates
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('radar')}
              className="px-2 py-0.5 rounded-md font-semibold bg-card text-foreground shadow-xs"
            >
              Compliance Radar
            </button>
          </div>
        </div>
        <ComplianceRadarCard plantIds={plantIds} />
      </div>
    );
  }

  return (
    <Card className="p-3 flex flex-col justify-between h-full space-y-2.5" data-testid="data-trust-audit-card">
      <div className="space-y-2">
        {/* Header with Title & Tab Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-highlight shrink-0" aria-hidden />
            <span className="text-xs font-bold tracking-[-0.01em] text-foreground">Reporting Confidence & Audit Gates</span>
          </div>

          <div className="inline-flex rounded-lg bg-muted/60 p-0.5 border border-border/60 text-2xs">
            <button
              type="button"
              onClick={() => setActiveTab('gates')}
              className="px-2 py-0.5 rounded-md font-semibold bg-card text-foreground shadow-xs"
            >
              Audit Gates
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('radar')}
              className="px-2 py-0.5 rounded-md font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Compliance Radar
            </button>
          </div>
        </div>

        {/* Executive Reporting Confidence Banner */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/40 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full border', trustColor)}>
                {trustGrade}
              </span>
              <span className="text-2xs text-slate-400 dark:text-slate-300 font-medium">
                {passedGates} of {gates.length} gates verified
              </span>
            </div>
            <p className="text-2xs text-muted-foreground mt-1 truncate">
              {totalPendingFlags > 0
                ? `${totalPendingFlags} flagged readings require review before signing off on audit-grade reports.`
                : 'Telemetry satisfies conservation & threshold gates for reporting export.'}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-2xs px-2 shrink-0 font-medium border-border/70 hover:bg-muted/40"
            onClick={() => navigate('/data-corrections')}
          >
            Review Queue →
          </Button>
        </div>

        {/* The 4 Core Audit Gates */}
        <div className="space-y-1.5">
          {gates.map((gate) => {
            const Icon = gate.icon;
            return (
              <div
                key={gate.id}
                className="flex items-center justify-between p-2 rounded-md bg-muted/15 border border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                onClick={gate.onClick}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded-md bg-muted/50 text-foreground shrink-0">
                    <Icon className="h-3.5 w-3.5 text-slate-400 dark:text-slate-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{gate.title}</div>
                    <div className="text-2xs text-slate-400 dark:text-slate-300 truncate">
                      {gate.subtitle} · <span className="font-mono text-foreground/80">{gate.target}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 pl-2">
                  <StatusPill tone={gate.status} className="px-1.5 py-0.5 text-3xs font-semibold">
                    {gate.statusLabel}
                  </StatusPill>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Audit Trail / Recent Normalizations */}
        <div className="pt-1.5 border-t border-border/40 space-y-1">
          <div className="flex items-center justify-between text-2xs">
            <span className="text-slate-400 dark:text-slate-300 font-semibold uppercase tracking-wider flex items-center gap-1">
              <History className="h-3 w-3" /> Recent Audit Normalizations
            </span>
            <button
              type="button"
              onClick={() => navigate('/data-corrections?tab=history')}
              className="text-primary hover:underline font-medium"
            >
              Full log →
            </button>
          </div>

          {auditHistory.length > 0 ? (
            <div className="space-y-1">
              {auditHistory.slice(0, 2).map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between text-2xs p-1.5 rounded bg-muted/10 border border-border/20 text-muted-foreground"
                >
                  <span className="truncate max-w-[200px] text-foreground">
                    <span className="font-semibold capitalize text-primary mr-1">[{h.action}]</span>
                    {h.source_table?.replace('_readings', '')} ·{' '}
                    <span className="font-mono">{h.adjusted_value ?? h.original_value ?? '—'}</span>
                  </span>
                  <span className="font-mono text-3xs text-slate-400 shrink-0">
                    {h.performed_at ? format(new Date(h.performed_at), 'MMM d, HH:mm') : 'Recently'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-2xs text-slate-400 dark:text-slate-400 italic">
              No manual normalizations recorded. Raw meter telemetry remains unmodified.
            </p>
          )}
        </div>
      </div>

      {/* Card Footer Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40 text-xs">
        <span className="text-2xs text-slate-400 dark:text-slate-400 font-medium">
          Gate evaluation active · {rangeLabel}
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs font-medium text-primary hover:text-primary/90 hover:underline"
          onClick={() => navigate('/compliance')}
        >
          Open Compliance Hub →
        </Button>
      </div>
    </Card>
  );
}
