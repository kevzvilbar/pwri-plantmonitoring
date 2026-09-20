import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StaffMember, avatarColor, initials, fullName } from '@/features/admin/employees/types';

interface PendingApprovalsProps {
  /** Accounts waiting for an Admin. Renders nothing when empty. */
  pending: StaffMember[];
  /** UsersPanel's own approve action: the `approve_user` RPC, with error toasts
   *  and cache invalidation. The queue never writes to the database itself. */
  onApprove: (id: string, label: string) => Promise<void>;
}

/** The "needs an Admin" queue at the top of Admin → Users. */
export function PendingApprovals({ pending, onApprove }: PendingApprovalsProps) {
  const [approving, setApproving] = useState<string | null>(null);
  if (pending.length === 0) return null;

  const approve = async (s: StaffMember) => {
    setApproving(s.id);
    try {
      await onApprove(s.id, fullName(s));
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="p-3 rounded-xl border border-warn/40 bg-warn-soft/60 space-y-2" data-testid="pending-approvals">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-warn flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Action required: accounts waiting for approval
        </span>
        <span className="text-3xs font-mono font-bold text-warn bg-warn/15 px-1.5 py-0.5 rounded">
          {pending.length} waiting
        </span>
      </div>

      <div className="space-y-2">
        {pending.map((s) => (
          <div key={s.id} className="flex items-center gap-3 bg-warn-soft border border-warn rounded-lg px-3 py-2">
            <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0', avatarColor(s.id))}>
              {initials(s)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{fullName(s)}</div>
              <div className="text-xs text-muted-foreground">@{s.username ?? '—'} · {s.designation ?? 'No designation'}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-accent border-accent hover:bg-accent-soft shrink-0"
              disabled={approving === s.id}
              onClick={() => approve(s)}
              data-testid={`pending-approve-${s.id}`}
            >
              {approving === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
