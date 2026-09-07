import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { DataState } from '@/components/DataState';
import { useAuth } from '@/hooks/useAuth';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Database, Copy, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  RefreshCw, FileCode, Download, ExternalLink, Search, Trash2,
} from 'lucide-react';
import { useMigrationsLogic } from './MigrationsPanel/useMigrationsLogic';
import { MigrationFileCard } from './MigrationsPanel/MigrationFileCard';
import { MigrationsUnmarkDialog } from './MigrationsPanel/MigrationsUnmarkDialog';

const STATUS_META: Record<string, { label: string; className: string; Icon: any }> = {
  applied:       { label: 'Applied',       className: 'bg-accent/15 text-accent border-accent/40', Icon: CheckCircle2 },
  pending:       { label: 'Pending',       className: 'bg-danger/15 text-danger border-danger/40',          Icon: AlertTriangle },
  partial:       { label: 'Partial',       className: 'bg-warn/15 text-warn border-warn/40',       Icon: AlertTriangle },
  indeterminate: { label: 'Indeterminate', className: 'bg-muted-foreground/15 text-muted-foreground border-muted-foreground/40',          Icon: FileCode },
};

export function MigrationsPanel() {
  const {
    isAdmin, isLoading, error, refetch, isFetching, data,
    expanded, setExpanded, copied, setCopied,
    showApplied, setShowApplied, busy, unmarkTarget, setUnmarkTarget,
    seenShas, nameFilter, setNameFilter, importing,
    pendingFiles, driftCount, supabaseSqlEditorUrl, hasAnyHistory,
    visibleFiles, visibleBeforeFilter,
    handleRecheck, copySql, openInSupabase, copyAllPending,
    downloadHistory, downloadAllPending, markApplied, unmarkApplied, handleImportHistoryFile,
  } = useMigrationsLogic();

  return (
    <div className="space-y-3" data-testid="admin-migrations-panel">
      <Card className="p-3 text-xs space-y-2">
        <div className="flex items-start gap-2">
          <Database className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Supabase migrations status</div>
            <div className="text-muted-foreground">
              Scans <code>supabase/migrations/*.sql</code> and probes your Supabase
              project for the tables / columns each file should have created.
              Pending or partial files include the exact SQL to paste into the
              Supabase Dashboard → SQL editor.
            </div>
          </div>
        </div>

        {!isAdmin ? (
          <DataState
            unavailable
            unavailableTitle="Admin required for this tool"
            unavailableDescription="Marking migrations applied and importing history are restricted to the Admin role — sign in as an Admin to use this panel."
          />
        ) : error ? (
          <DataState error={error} onRetry={() => refetch()} />
        ) : null}

        {data && (
          <div className="flex flex-wrap gap-2 items-center pt-1">
            <Badge variant="outline" className="bg-accent/10 text-accent">
              {data.summary.applied} applied
            </Badge>
            {data.summary.pending > 0 && (
              <Badge variant="outline" className="bg-danger/10 text-danger">
                {data.summary.pending} pending
              </Badge>
            )}
            {data.summary.partial > 0 && (
              <Badge variant="outline" className="bg-warn/10 text-warn">
                {data.summary.partial} partial
              </Badge>
            )}
            {data.summary.indeterminate > 0 && (
              <Badge variant="outline" className="bg-muted-foreground/10 text-muted-foreground">
                {data.summary.indeterminate} indeterminate
              </Badge>
            )}
            {driftCount > 0 && (
              <Badge
                variant="outline"
                className="bg-warn/15 text-warn border-warn/40"
                title={
                  `${driftCount} migration file${driftCount === 1 ? '' : 's'} ` +
                  `changed on disk since the last Re-check. ` +
                  `Re-download the bundle before pasting into Supabase, ` +
                  `then click Re-check to acknowledge.`
                }
                data-testid="migrations-drift-count"
              >
                <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                {driftCount} modified since last check
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              · {data.summary.total} total
            </span>
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  placeholder="Filter filenames…"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  className="h-7 pl-6 pr-2 text-xs rounded-md border bg-background w-44 focus:outline-none focus:ring-1 focus:ring-ring"
                  title="Case-insensitive substring match against filename"
                  data-testid="migrations-name-filter"
                />
                {nameFilter && (
                  <button
                    type="button"
                    onClick={() => setNameFilter('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm leading-none px-1"
                    title="Clear filter"
                    data-testid="migrations-name-filter-clear"
                  >
                    ×
                  </button>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={showApplied}
                  onCheckedChange={(v) => setShowApplied(!!v)}
                  data-testid="migrations-show-applied"
                />
                Show applied
              </label>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={pendingFiles.length === 0}
                onClick={copyAllPending}
                title={
                  pendingFiles.length === 0
                    ? 'No pending or partial migrations to bundle'
                    : `Copy ${pendingFiles.length} file(s) as one paste-able SQL bundle`
                }
                data-testid="migrations-copy-all"
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy all pending ({pendingFiles.length})
              </Button>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={pendingFiles.length === 0}
                onClick={downloadAllPending}
                title={
                  pendingFiles.length === 0
                    ? 'No pending or partial migrations to bundle'
                    : `Save ${pendingFiles.length} file(s) as a versioned .sql backup`
                }
                data-testid="migrations-download-all"
              >
                <Download className="h-3 w-3 mr-1" />
                Download .sql
              </Button>
              {hasAnyHistory && (
                <Button
                  size="sm" variant="outline" className="h-7"
                  onClick={downloadHistory}
                  title="Export the apply-history audit trail as a JSON file (one entry per migration that has been marked applied locally)"
                  data-testid="migrations-export-history"
                >
                  <Download className="h-3 w-3 mr-1" />
                  Export history
                </Button>
              )}
              <label
                className={`inline-flex items-center h-7 px-3 text-xs rounded-md border bg-background hover:bg-muted cursor-pointer ${
                  importing || !isAdmin ? 'opacity-60 pointer-events-none' : ''
                }`}
                title={
                  !isAdmin
                    ? 'Needs a reachable backend to apply the import'
                    : 'Import a previously-exported apply-history JSON. Non-destructive: local entries always win on conflict.'
                }
                data-testid="migrations-import-history-label"
              >
                {importing
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <Database className="h-3 w-3 mr-1" />}
                Import history
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={!isAdmin}
                  data-testid="migrations-import-history-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) handleImportHistoryFile(file);
                  }}
                />
              </label>
              <Button
                size="sm" variant="outline" className="h-7"
                disabled={isFetching}
                onClick={handleRecheck}
                data-testid="migrations-refresh"
              >
                {isFetching
                  ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  : <RefreshCw className="h-3 w-3 mr-1" />}
                Re-check
              </Button>
            </div>
          </div>
        )}
      </Card>

      {isLoading && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 mx-auto animate-spin mb-1" />
          Probing live Supabase schema…
        </Card>
      )}

      {!isLoading && visibleFiles.length === 0 && data && (
        <Card className="p-4 text-center text-xs text-muted-foreground">
          {nameFilter
            ? <>No files match <code className="font-mono">{nameFilter}</code>.{' '}
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setNameFilter('')}
                >
                  Clear filter
                </button></>
            : data.summary.pending + data.summary.partial === 0
              ? 'All migrations already applied. Toggle "Show applied" to see the full history.'
              : 'No files match the current filter.'}
        </Card>
      )}

      {nameFilter && visibleFiles.length > 0 && data && (
        <div className="text-xs text-muted-foreground px-1">
          Showing <strong className="text-foreground">{visibleFiles.length}</strong> of{' '}
          <strong className="text-foreground">{visibleBeforeFilter}</strong>
          {visibleBeforeFilter !== data.summary.total && (
            <> visible ({data.summary.total} total in repo)</>
          )}
          {' '}— filtered by <code className="font-mono">{nameFilter}</code>
        </div>
      )}

      <div className="space-y-2">
        {visibleFiles.map((f) => (
          <MigrationFileCard
            key={f.filename}
            file={f}
            isOpen={!!expanded[f.filename]}
            wasCopied={copied === f.filename}
            busy={busy}
            isAdmin={isAdmin}
            supabaseSqlEditorUrl={supabaseSqlEditorUrl}
            seenShas={seenShas}
            onToggleExpand={() => setExpanded((m) => ({ ...m, [f.filename]: !m[f.filename] }))}
            onCopySql={() => copySql(f.filename, f.sql)}
            onOpenInSupabase={() => openInSupabase(f.filename, f.sql)}
            onMarkApplied={() => markApplied(f.filename)}
            onClearMark={() => setUnmarkTarget(f.filename)}
          />
        ))}
      </div>

      <MigrationsUnmarkDialog
        unmarkTarget={unmarkTarget}
        onUnmarkApplied={unmarkApplied}
        onClose={() => setUnmarkTarget(null)}
      />
    </div>
  );
}
