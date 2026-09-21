/**
 * My correction requests (`/my-corrections`): P5-6 of docs/NAV-IA-REMEDIATION-PLAN.md.
 *
 * The operator's side of the correction loop. An entry older than two hours can
 * only be fixed by asking a supervisor; the request is reviewed in Data
 * Corrections, which Operators cannot open. This page shows what was asked,
 * what became of it and, for a rejection, why.
 *
 * Read-only on purpose. There is no "withdraw": the database has a `withdrawn`
 * status but no policy lets the submitter set it.
 */
import { ArrowRight, RefreshCw, ShieldAlert, SquarePen } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTab } from '@/hooks/useUrlTab';
import { fmtDt } from '@/features/readings/dataCorrections/types';
import {
  MY_CORRECTIONS_LIMIT, STATUS_FILTERS, countByStatus, describeChange, filterByStatus, statusMeta,
  type MyCorrectionRequest, type StatusFilter,
} from '@/shared/myCorrections';
import { useMyCorrections } from '../hooks/useMyCorrections';

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
};

function RequestCard({ request: r }: { request: MyCorrectionRequest }) {
  const meta = statusMeta(r.status);
  const change = describeChange(r.originalValue, r.proposedValue);
  const resolved = r.status === 'approved' || r.status === 'rejected';

  return (
    <li className="list-none">
      <Card className="p-3 space-y-2" data-testid="correction-request" data-status={r.status}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{r.title}</p>
            <p className="text-xs text-muted-foreground">
              {r.subtitle}
              {r.readingAt ? ` · reading of ${fmtDt(r.readingAt)}` : ''}
            </p>
          </div>
          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        </div>

        <p
          className="flex items-center gap-1.5 text-sm font-mono tabular-nums"
          aria-label={`Change from ${change.from} to ${change.to}, ${change.delta}`}
        >
          <span>{change.from}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span>{change.to}</span>
          <span className="text-xs text-muted-foreground">({change.delta})</span>
        </p>

        <div className="space-y-0.5 text-xs">
          <p><span className="text-muted-foreground">Reason:</span> {r.reason}</p>
          {r.note && <p className="text-muted-foreground">Your note: {r.note}</p>}
        </div>

        <p className="text-2xs text-muted-foreground">Asked {fmtDt(r.createdAt)}</p>

        {resolved ? (
          <div
            role="note"
            className={cn(
              'rounded-md border px-2.5 py-2 text-xs space-y-0.5',
              r.status === 'rejected' ? 'border-danger bg-danger-soft' : 'border-border bg-muted/40',
            )}
          >
            <p className={cn('font-medium', r.status === 'rejected' && 'text-danger')}>
              {meta.label}
              {r.resolvedByName ? ` by ${r.resolvedByName}` : ''}
              {r.resolvedAt ? ` · ${fmtDt(r.resolvedAt)}` : ''}
            </p>
            {r.resolutionNote
              ? <p>{r.resolutionNote}</p>
              : r.status === 'rejected' && <p className="text-muted-foreground">No reason was given.</p>}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground">{meta.hint}</p>
        )}
      </Card>
    </li>
  );
}

export default function MyCorrectionsPage() {
  const canView = usePermission('my_corrections', 'view');
  const { data, isLoading, isError, refetch, isFetching } = useMyCorrections();
  const [filter, setFilter] = useUrlTab('status', STATUS_FILTERS, 'all');

  if (!canView) {
    return (
      <Card className="p-8 text-center space-y-2 max-w-md mx-auto mt-12">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">Your role cannot view correction requests.</p>
      </Card>
    );
  }

  const requests = data ?? [];
  const counts = countByStatus(requests);
  const visible = filterByStatus(requests, filter);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="My correction requests"
        subtitle="Corrections you asked a supervisor to make, and what happened to them"
        titleIcon={<SquarePen className="h-5 w-5" />}
        actions={
          <Button
            type="button" size="sm" variant="outline" className="gap-1.5"
            onClick={() => { void refetch(); }} disabled={isFetching}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your requests">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : isError ? (
        <Card role="alert" className="p-6 text-center space-y-2">
          <p className="text-sm font-medium">Couldn&rsquo;t load your requests</p>
          <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { void refetch(); }}>Try again</Button>
        </Card>
      ) : requests.length === 0 ? (
        <Card className="p-6 text-center space-y-1.5" data-testid="no-requests">
          <p className="text-sm font-medium">You haven&rsquo;t asked for any corrections</p>
          <p className="text-xs text-muted-foreground">
            If a reading you entered is wrong and it is more than two hours old, use <strong>Fix</strong> on it in
            Daily Readings. Your request and the supervisor&rsquo;s answer will appear here.
          </p>
        </Card>
      ) : (
        <>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f} type="button" size="sm" className="h-8 text-xs gap-1.5"
                variant={filter === f ? 'default' : 'outline'}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
                <span className="tabular-nums opacity-80">{counts[f]}</span>
              </Button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground py-6 text-center">
              No {FILTER_LABEL[filter].toLowerCase()} requests.
            </p>
          ) : (
            <ul className="space-y-2 p-0 m-0" aria-label="Correction requests">
              {visible.map((r) => <RequestCard key={r.id} request={r} />)}
            </ul>
          )}

          {requests.length >= MY_CORRECTIONS_LIMIT && (
            <p className="text-2xs text-muted-foreground text-center">
              Showing your latest {MY_CORRECTIONS_LIMIT} requests.
            </p>
          )}
        </>
      )}
    </div>
  );
}
