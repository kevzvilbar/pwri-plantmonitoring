import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtNum, fmtDt, tableLabel } from '../../types';
import type { CorrectionRequest } from '../../types';

const QUICK_REJECTION_PRESETS = [
  'Verified accurate against field logbook',
  'Exceeds plausibility threshold',
  'Duplicate correction request',
  'Requires meter replacement flow',
];

interface CorrectionRequestCardProps {
  req: CorrectionRequest;
  reqNotes: Record<string, string>;
  onReqNotesChange: (notes: Record<string, string>) => void;
  onApprove: (req: CorrectionRequest) => void;
  onReject: (req: CorrectionRequest, note: string) => void;
}

export function CorrectionRequestCard({
  req, reqNotes, onReqNotesChange, onApprove, onReject,
}: CorrectionRequestCardProps) {
  const diff = req.proposed_value - req.original_value;
  const isPositive = diff > 0;
  const hasDiff = diff !== 0;

  return (
    <Card className="p-4 border-amber-500/40 bg-amber-500/5 shadow-2xs space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-foreground">{tableLabel[req.source_table]}</span>
            <Badge variant="outline" className="text-3xs px-2 py-0 font-bold border-amber-500/40 bg-background">
              {req.plant_name}
            </Badge>
            <span className="text-3xs px-2 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
              Operator Requested
            </span>
          </div>
          <div className="text-3xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <span>Submitted by <strong className="text-foreground">{req.submitter_email}</strong></span>
            <span>·</span>
            <span>{fmtDt(req.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-2.5 rounded-lg bg-background/80 border border-border/60 text-xs">
        <div>
          <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Original Recorded</div>
          <div className="font-mono font-bold text-sm text-destructive mt-0.5">{fmtNum(req.original_value)}</div>
        </div>
        <div>
          <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
            <ArrowRight className="h-3 w-3 text-primary" /> Proposed New Value
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono font-bold text-sm text-accent">{fmtNum(req.proposed_value)}</span>
            {hasDiff && (
              <span className={cn('text-3xs font-mono font-bold px-1.5 py-0.2 rounded',
                isPositive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400')}>
                {isPositive ? `+${fmtNum(diff)}` : fmtNum(diff)}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Operator Reason</div>
          <div className="text-xs font-semibold text-foreground mt-0.5 leading-snug">{req.reason}</div>
        </div>
      </div>

      {req.note && (
        <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border/40 italic">
          "{req.note}"
        </div>
      )}

      <div className="space-y-2 pt-1 border-t border-border/40">
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            placeholder="Rejection explanation (required to reject)…"
            value={reqNotes[req.id] ?? ''}
            onChange={e => onReqNotesChange({ ...reqNotes, [req.id]: e.target.value })}
            className="h-8 text-xs flex-1 min-w-[200px] bg-background"
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs font-bold bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => onApprove(req)}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Approve &amp; Apply</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs font-bold border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={!reqNotes[req.id]?.trim()}
            onClick={() => onReject(req, reqNotes[req.id] ?? '')}
          >
            <XCircle className="h-3.5 w-3.5" />
            <span>Reject</span>
          </Button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap text-3xs">
          <span className="text-muted-foreground font-semibold">Quick rejection presets:</span>
          {QUICK_REJECTION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
              onClick={() => onReqNotesChange({ ...reqNotes, [req.id]: preset })}
            >
              + {preset}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
