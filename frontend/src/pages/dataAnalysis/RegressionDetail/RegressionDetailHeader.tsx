import { Button } from '@/components/ui/button';
import { StatusBadge } from '../StatusBadge';
import { cn } from '@/lib/utils';
import {
  TABLES_WITHOUT_NORM_STATUS,
  TABLE_LABELS,
  ENTITY_CONFIG,
  RegressionResult,
} from '../shared';
import { GAP_FILL_PREFIX, GapFillMeta } from '@/lib/gapDetection';
import {
  CheckCircle2,
  Undo2,
  TrendingUp,
  Database,
  ChevronDown,
  ChevronUp,
  Zap,
  X,
} from 'lucide-react';
import { fmtIsoDate, fmtTime } from '@/lib/format';

interface RegressionDetailHeaderProps {
  result: RegressionResult;
  canEdit: boolean;
  plantName: string | null;
  entityName: string | null;
  outliers: any[];
  gapFillRows: any[];
  gapsInserted: boolean;
  applying: boolean;
  retracting: boolean;
  insertingGaps: boolean;
  confirmDelete: boolean;
  deleting: boolean;
  expanded: boolean;
  onApply: () => void;
  onRetract: () => void;
  onInsertGaps: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}

export function RegressionDetailHeader({
  result,
  canEdit,
  plantName,
  entityName,
  outliers,
  gapFillRows,
  gapsInserted,
  applying,
  retracting,
  insertingGaps,
  confirmDelete,
  deleting,
  expanded,
  onApply,
  onRetract,
  onInsertGaps,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onToggleExpand,
}: RegressionDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
      <div className="flex flex-col min-w-0 gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium text-sm truncate">
            {TABLE_LABELS[result.source_table] ?? result.source_table} ·{' '}
            <span className="font-mono">{result.column_name}</span>
          </span>
          <StatusBadge status={result.status} />
        </div>
        {(plantName || entityName) && (
          <div className="flex items-center gap-1.5 pl-6 text-xs text-muted-foreground">
            {plantName && (
              <span className="inline-flex items-center gap-1">
                <Database className="h-3 w-3" />
                {plantName}
              </span>
            )}
            {plantName && entityName && <span className="opacity-40">·</span>}
            {entityName && (
              <span className="font-medium text-foreground/70">{entityName}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canEdit && result.status === 'pending' && outliers.length > 0 && (
          <Button size="sm" onClick={onApply} disabled={applying} className="h-7 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {applying ? 'Applying…' : `Apply (${outliers.length})`}
          </Button>
        )}
        {canEdit && gapFillRows.length > 0 && !gapsInserted && (
          <Button
            size="sm"
            variant="outline"
            onClick={onInsertGaps}
            disabled={insertingGaps}
            className="h-7 text-xs border-info text-info hover:bg-info-soft"
          >
            <Zap className="h-3 w-3 mr-1" />
            {insertingGaps ? 'Inserting…' : `Insert gaps (${gapFillRows.length})`}
          </Button>
        )}
        {gapsInserted && (
          <span className="inline-flex items-center gap-1 text-xs text-info font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Gaps inserted
          </span>
        )}
        {canEdit && result.status === 'applied' && (
          <Button size="sm" variant="outline" onClick={onRetract} disabled={retracting} className="h-7 text-xs">
            <Undo2 className="h-3 w-3 mr-1" />
            {retracting ? 'Retracting…' : 'Retract'}
          </Button>
        )}
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse result' : 'Expand result'}
          onClick={onToggleExpand}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {confirmDelete ? (
          <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 rounded-md px-2 py-1">
            <span className="text-xs text-destructive font-medium whitespace-nowrap">Delete?</span>
            <button
              className="text-xs font-semibold text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50"
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? 'Deleting…' : 'Yes'}
            </button>
            <span className="text-muted-foreground/50 text-xs">·</span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={onCancelDelete}
            >
              No
            </button>
          </div>
        ) : (
          <button
            className="text-muted-foreground hover:text-destructive transition-colors"
            title="Delete this regression result"
            aria-label="Delete this regression result"
            onClick={onConfirmDelete}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
