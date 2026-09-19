/**
 * StorageRetentionCard.tsx
 *
 * Phase 0 of the reading-storage work: make the growth of
 * ro_train_readings / ro_pretreatment_readings visible in-app, from the RPCs in
 * supabase/migrations/20260916000005_reading_storage_report.sql.
 *
 * WHY IT EXISTS
 *   The proposal that started this (PRETREATMENT_STORAGE_ANALYSIS.md) reasoned
 *   from "1 log/day". Both tables actually take an hourly reading per train
 *   (submitROReadings.ts: "Duplicate check — one per train per hour"), so the
 *   real volume is ~24x that, and nobody could tell whether the database was
 *   days or years away from its limit. This card answers that from measured
 *   bytes instead of an assumed cadence.
 *
 * READ-ONLY
 *   Nothing here mutates data: it calls two STABLE reporting functions. The one
 *   destructive step in this phase (dropping the duplicate indexes) is migration
 *   20260916000006, deliberately not a button.
 *
 * Hosted in the Migrations tab because that is the existing admin-only,
 * database-health surface — adding a sixth tab would mean resizing the tab grid,
 * extending the permission matrix and the custom-role guards for no benefit.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataState } from '@/components/DataState';
import {
  fetchStorageReport, fetchDuplicateIndexReport, formatBytes, daysUntilBytes,
  DEFAULT_STORAGE_BUDGET_BYTES,
  type StorageTableInfo, type DuplicateIndexRow,
} from '@/lib/storageRetention';
import { Database, HardDrive, RefreshCw, AlertTriangle, Layers, Ruler } from 'lucide-react';

const REPORT_QUERY_KEY = ['admin-storage-retention-report'] as const;
const DUPES_QUERY_KEY = ['admin-storage-retention-duplicates'] as const;

// Both RPCs read catalog stats, not user data, and the tables grow hourly at
// most — a 5-minute cache keeps the card from re-measuring on every tab visit.
const REPORT_STALE_MS = 5 * 60_000;

/** One row of the per-table measurement grid. */
function TableRow({ info }: { info: StorageTableInfo }) {
  const rows = info.exact_rows ?? info.est_rows;
  const perYear = info.projected_bytes_per_day === null ? null : info.projected_bytes_per_day * 365;
  const daysToBudget = daysUntilBytes(info, DEFAULT_STORAGE_BUDGET_BYTES);

  return (
    <tr className="border-t border-border/60" data-testid={`storage-row-${info.table}`}>
      <td className="px-2 py-1.5 font-medium text-foreground whitespace-nowrap">{info.table}</td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">{info.total_size}</td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums text-muted-foreground">
        {formatBytes(info.heap_bytes)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums text-muted-foreground">
        {formatBytes(info.index_bytes)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums text-muted-foreground">
        {formatBytes(info.toast_bytes)}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">
        {rows.toLocaleString()}
        {info.exact_rows === null && <span className="text-3xs text-muted-foreground"> est</span>}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums text-muted-foreground">
        {info.rows_last_7d.toLocaleString()}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums text-muted-foreground">
        {perYear === null ? '—' : `${formatBytes(perYear)}/yr`}
      </td>
      <td className="px-2 py-1.5 text-right font-mono-num tabular-nums">
        {daysToBudget === null
          ? <span className="text-muted-foreground">idle</span>
          : `${daysToBudget.toLocaleString()} d`}
      </td>
    </tr>
  );
}

/** Per-index detail for one table, so idx_scan can confirm nothing depends on a candidate. */
function IndexList({ info }: { info: StorageTableInfo }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2" data-testid={`storage-indexes-${info.table}`}>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">
        {info.table} — indexes ({info.indexes.length})
      </div>
      <div className="space-y-0.5">
        {info.indexes.map((ix) => (
          <div key={ix.index} className="flex items-baseline gap-2 text-2xs">
            <span className="font-mono text-foreground truncate">{ix.index}</span>
            <span className="font-mono-num tabular-nums text-muted-foreground shrink-0">{ix.size}</span>
            <span
              className={`font-mono-num tabular-nums shrink-0 ${ix.idx_scan === 0 ? 'text-warn' : 'text-muted-foreground'}`}
              title="Scans since the last statistics reset — 0 means nothing has used this index"
            >
              {ix.idx_scan.toLocaleString()} scans
            </span>
            {ix.primary && <span className="text-3xs text-muted-foreground shrink-0">pk</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The duplicate-index section: expected to be empty for the two reading tables. */
function DuplicateSection({ rows, loading }: { rows: DuplicateIndexRow[]; loading: boolean }) {
  return (
    <div className="space-y-1.5" data-testid="storage-duplicates">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Layers className="h-3 w-3" /> Exact-duplicate indexes — schema-wide
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground">Checking…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          None. The three duplicates this work removed from{' '}
          <code className="font-mono">ro_train_readings</code> and{' '}
          <code className="font-mono">ro_pretreatment_readings</code> were dropped by migration{' '}
          <code className="font-mono">20260916000006</code>, and nothing has reintroduced them.
        </div>
      ) : (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-2 space-y-1">
          <div className="text-xs text-warn flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {rows.length} redundant index pair(s) found — each one doubles write cost on its table.
          </div>
          {rows.map((r) => (
            <div key={`${r.table_name}.${r.drop_index}`} className="text-2xs font-mono text-muted-foreground">
              {r.table_name}: keep <span className="text-foreground">{r.keep_index}</span>, drop{' '}
              <span className="text-foreground">{r.drop_index}</span> ({formatBytes(r.drop_index_bytes)})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export function StorageRetentionCard() {
  // Exact counts are opt-in: COUNT(*) over a large reading table is a sequential
  // scan, so the card defaults to pg_class estimates and lets an admin ask for
  // the precise number deliberately.
  const [exactCounts, setExactCounts] = useState(false);

  const report = useQuery({
    queryKey: [...REPORT_QUERY_KEY, exactCounts],
    queryFn: () => fetchStorageReport(exactCounts),
    staleTime: REPORT_STALE_MS,
  });

  const dupes = useQuery({
    queryKey: [...DUPES_QUERY_KEY],
    queryFn: fetchDuplicateIndexReport,
    staleTime: REPORT_STALE_MS,
  });

  const tables = report.data?.tables ?? [];

  return (
    <Card className="p-3 space-y-3" data-testid="storage-retention-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <HardDrive className="h-4 w-4 text-primary" /> Storage &amp; retention — measurement
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Measured sizes and 7-day growth for the two hourly-written reading tables. Both take a
            reading per train <em>per hour</em>, so volume is ~24x a daily-cadence estimate — this is
            the number a retention window should be decided from, not an assumed logging rate.
            Read-only.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm" variant="outline" className="h-7 text-xs"
            disabled={report.isFetching}
            onClick={() => { void report.refetch(); void dupes.refetch(); }}
            data-testid="storage-refresh"
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${report.isFetching ? 'animate-spin' : ''}`} />
            Re-measure
          </Button>
          <Button
            size="sm"
            variant={exactCounts ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setExactCounts((v) => !v)}
            title="Exact row counts. Runs COUNT(*) per table — a sequential scan, so use it deliberately."
            data-testid="storage-exact-counts"
          >
            <Ruler className="h-3 w-3 mr-1" />
            {exactCounts ? 'Exact counts: on' : 'Exact counts: off'}
          </Button>
        </div>
      </div>

      <DataState
        loading={report.isLoading}
        error={report.error}
        onRetry={() => { void report.refetch(); }}
        isEmpty={!report.isLoading && !report.error && tables.length === 0}
        emptyTitle="No storage data returned"
        emptyDescription="The reporting function returned no tables — confirm migration 20260916000005 has been applied to this project."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-2xs text-muted-foreground">
            <Database className="h-3 w-3" />
            Database total:{' '}
            <span className="font-mono-num tabular-nums text-foreground">{report.data?.database_size}</span>
            <span className="text-muted-foreground/60">
              · budget projection assumes {formatBytes(DEFAULT_STORAGE_BUDGET_BYTES)} (provisional Free-tier limit)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-2xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-2 py-1 font-medium">Table</th>
                  <th className="text-right px-2 py-1 font-medium">Total</th>
                  <th className="text-right px-2 py-1 font-medium">Heap</th>
                  <th className="text-right px-2 py-1 font-medium">Indexes</th>
                  <th className="text-right px-2 py-1 font-medium">TOAST</th>
                  <th className="text-right px-2 py-1 font-medium">Rows</th>
                  <th className="text-right px-2 py-1 font-medium">Rows / 7d</th>
                  <th className="text-right px-2 py-1 font-medium">Growth</th>
                  <th className="text-right px-2 py-1 font-medium">To budget</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <TableRow key={t.table} info={t} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {tables.map((t) => (
              <IndexList key={t.table} info={t} />
            ))}
          </div>

          <DuplicateSection rows={dupes.data ?? []} loading={dupes.isLoading} />
        </div>
      </DataState>
    </Card>
  );
}