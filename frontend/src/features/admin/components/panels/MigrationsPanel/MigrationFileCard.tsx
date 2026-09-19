import { useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileCode, CheckCircle2, AlertTriangle, ExternalLink, Trash2,
  ChevronDown, ChevronUp, Copy, Loader2,
} from 'lucide-react';
import type { MigrationFile } from '@/lib/migrationsStatus';

const STATUS_META: Record<MigrationFile['status'], { label: string; className: string; Icon: any }> = {
  applied:       { label: 'Applied',       className: 'bg-accent/15 text-accent border-accent/40', Icon: CheckCircle2 },
  pending:       { label: 'Pending',       className: 'bg-danger/15 text-danger border-danger/40',          Icon: AlertTriangle },
  partial:       { label: 'Partial',       className: 'bg-warn/15 text-warn border-warn/40',       Icon: AlertTriangle },
  indeterminate: { label: 'Indeterminate', className: 'bg-muted-foreground/15 text-muted-foreground border-muted-foreground/40',          Icon: FileCode },
};

function DriftBadge({ file, seenShas }: { file: MigrationFile; seenShas: Record<string, string> }) {
  const seen = file.sha256 ? seenShas[file.filename] : undefined;
  const drifted = !!(seen && file.sha256 && seen !== file.sha256);
  if (!drifted) return null;
  return (
    <Badge variant="outline" className="text-2xs bg-warn/15 text-warn border-warn/40" title={
      `On-disk content changed since last Re-check.\n` +
      `was: ${seen?.slice(0, 12)}…\n` +
      `now: ${file.sha256?.slice(0, 12)}…\n` +
      `Re-download the bundle before pasting into Supabase.`
    } data-testid={`migration-drift-${file.filename}`}>
      <AlertTriangle className="h-2.5 w-2.5 mr-1" />
      modified since last check
    </Badge>
  );
}

function AppliedLocallyBadge({ file }: { file: MigrationFile }) {
  const h = file.apply_history;
  if (!h?.applied_at) return null;
  if (file.override_applied) return null;
  if (file.probed_status !== 'applied') return null;
  const when = new Date(h.applied_at);
  if (Number.isNaN(when.getTime())) return null;
  const rel = formatDistanceToNow(when, { addSuffix: true });
  const abs = format(when, 'yyyy-MM-dd HH:mm');
  return (
    <Badge variant="outline" className="text-2xs bg-accent/5 text-accent border-accent/30 font-mono" title={
      `First marked applied locally at ${abs} (local time)` +
      (h.by_label ? ` by ${h.by_label}` : '') +
      (h.note ? `\nNote: "${h.note}"` : '') +
      `\nOriginal manual override has since been auto-purged ` +
      `because the live probe now confirms the migration.`
    } data-testid={`migration-applied-locally-${file.filename}`}>
      applied {rel}
    </Badge>
  );
}

function OverrideInfo({ file }: { file: MigrationFile }) {
  if (!file.override_applied || !file.manual_override) return null;
  const marked = new Date(file.manual_override.marked_at);
  const validMarked = !Number.isNaN(marked.getTime());
  const absolute = validMarked ? format(marked, 'yyyy-MM-dd HH:mm') : 'unknown time';
  const relative = validMarked ? formatDistanceToNow(marked, { addSuffix: true }) : '';
  return (
    <div className="mt-1.5 text-xs text-muted-foreground italic flex items-center gap-1.5 flex-wrap">
      <Badge variant="outline" className="bg-info/10 text-info border-info/40 text-2xs">manual override</Badge>
      {validMarked && (
        <Badge variant="outline" className="bg-info/5 text-info border-info/30 text-2xs not-italic font-mono" title={`Marked applied at ${absolute} (local time)`} data-testid={`migration-override-age-${file.filename}`}>
          {relative}
        </Badge>
      )}
      Marked applied by <strong className="not-italic">{file.manual_override.by_label ?? 'admin'}</strong>
      {' on '}
      <span title={validMarked ? marked.toISOString() : undefined}>{absolute}</span>
      {file.manual_override.note ? ` — "${file.manual_override.note}"` : ''}
      {' · probe says '}
      <code>{file.probed_status}</code>
    </div>
  );
}

function MigrationFileProbes({ file }: { file: MigrationFile }) {
  if (file.table_probes.length === 0 && file.column_probes.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {file.table_probes.map((p) => {
        const expected = p.expected_columns ?? [];
        const present = (p.present_columns ?? []).length;
        const missing = (p.missing_columns ?? []).length;
        const hasDrift = p.exists && missing > 0;
        return (
          <div key={`t-${p.name}`} className={`rounded-md border px-2 py-1.5 text-xs ${
            !p.exists ? 'bg-danger/5 border-danger/30'
              : hasDrift ? 'bg-warn/5 border-warn/30'
              : 'bg-accent/5 border-accent/30'
          }`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-2xs rounded-full px-1.5 py-0.5 border ${
                p.exists ? 'bg-accent-soft text-accent border-accent' : 'bg-danger-soft text-danger border-danger'
              }`}>
                table {p.name} {p.exists ? '✓ present' : '✗ missing'}
              </span>
              {expected.length > 0 && (
                <span className="text-muted-foreground">
                  {p.exists
                    ? hasDrift
                      ? `${present}/${expected.length} columns present · ${missing} missing`
                      : `all ${expected.length} columns present`
                    : `would create ${expected.length} columns`}
                </span>
              )}
            </div>
            {hasDrift && (
              <div className="mt-1 flex flex-wrap gap-1">
                {(p.missing_columns ?? []).map((c) => (
                  <span key={`m-${p.name}.${c}`} className="text-2xs rounded-full px-1.5 py-0.5 border bg-danger-soft text-danger border-danger" title={`Column ${p.name}.${c} declared in this migration is not present in the live table`}>
                    {p.name}.{c} ✗
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {file.column_probes.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          <span className="text-2xs uppercase tracking-wide text-muted-foreground self-center mr-1">Added columns:</span>
          {file.column_probes.map((p) => (
            <span key={`c-${p.table}.${p.column}`} className={`text-2xs rounded-full px-1.5 py-0.5 border ${
              p.exists ? 'bg-accent-soft text-accent border-accent' : 'bg-danger-soft text-danger border-danger'
            }`}>
              {p.table}.{p.column} {p.exists ? '✓' : '✗'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface MigrationFileCardProps {
  file: MigrationFile;
  isOpen: boolean;
  wasCopied: boolean;
  busy: string | null;
  isAdmin: boolean;
  supabaseSqlEditorUrl: string | null;
  seenShas: Record<string, string>;
  onToggleExpand: () => void;
  onCopySql: () => void;
  onOpenInSupabase: () => void;
  onMarkApplied: () => void;
  onClearMark: () => void;
}

export function MigrationFileCard({
  file, isOpen, wasCopied, busy, isAdmin, supabaseSqlEditorUrl, seenShas,
  onToggleExpand, onCopySql, onOpenInSupabase, onMarkApplied, onClearMark,
}: MigrationFileCardProps) {
  const meta = STATUS_META[file.status];

  return (
    <Card className={`p-3 border-l-2 ${
      file.status === 'pending' ? 'border-l-danger/70'
        : file.status === 'partial' ? 'border-l-warn/70'
        : file.status === 'applied' ? 'border-l-accent/60 opacity-90'
        : 'border-l-muted-foreground/40'
    }`} data-testid={`migration-${file.filename}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <code className="text-xs font-mono truncate">{file.filename}</code>
          <Badge variant="outline" className={`text-2xs ${meta.className}`}>
            <meta.Icon className="h-2.5 w-2.5 mr-1" />
            {meta.label}
          </Badge>
          <DriftBadge file={file} seenShas={seenShas} />
          <AppliedLocallyBadge file={file} />
          <span className="text-2xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {file.probed_status !== 'applied' && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCopySql} data-testid={`migration-copy-${file.filename}`}>
              {wasCopied
                ? <><CheckCircle2 className="h-3 w-3 mr-1 text-accent" /> Copied</>
                : <><Copy className="h-3 w-3 mr-1" /> Copy SQL</>}
            </Button>
          )}
          {file.probed_status !== 'applied' && supabaseSqlEditorUrl && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenInSupabase} title="Copy this file's SQL and open the Supabase SQL editor in a new tab" data-testid={`migration-open-supabase-${file.filename}`}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in Supabase
            </Button>
          )}
          {file.override_applied ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === file.filename || !isAdmin} onClick={onClearMark} data-testid={`migration-unmark-${file.filename}`}>
              {busy === file.filename
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Clear mark</>
                : <><Trash2 className="h-3 w-3 mr-1" /> Clear mark</>}
            </Button>
          ) : (
            file.probed_status !== 'applied' && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === file.filename || !isAdmin} onClick={onMarkApplied} data-testid={`migration-mark-${file.filename}`}>
                {busy === file.filename
                  ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Mark applied</>
                  : <><CheckCircle2 className="h-3 w-3 mr-1" /> Mark applied</>}
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onToggleExpand}>
            {isOpen
              ? <><ChevronUp className="h-3 w-3 mr-1" /> Hide</>
              : <><ChevronDown className="h-3 w-3 mr-1" /> Details</>}
          </Button>
        </div>
      </div>
      <OverrideInfo file={file} />
      <MigrationFileProbes file={file} />
      {isOpen && (
        <pre className="mt-2 p-2 rounded-md bg-muted/40 border text-2xs font-mono overflow-auto max-h-72">
{file.sql}
        </pre>
      )}
    </Card>
  );
}
