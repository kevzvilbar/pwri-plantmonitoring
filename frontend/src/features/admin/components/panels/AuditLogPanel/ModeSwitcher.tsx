import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Trash2, KeyRound, RefreshCw,
} from 'lucide-react';
import type { LoginStats } from './types';

interface ModeSwitcherProps {
  auditMode: 'deletions' | 'logins';
  onAuditModeChange: (mode: 'deletions' | 'logins') => void;
  loginStats: LoginStats;
  isFetching: boolean;
  loginFetching: boolean;
  onRefreshDeletions: () => void;
  onRefreshLogins: () => void;
}

export function ModeSwitcher({
  auditMode, onAuditModeChange, loginStats, isFetching, loginFetching, onRefreshDeletions, onRefreshLogins,
}: ModeSwitcherProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl bg-card border border-border/80 shadow-2xs">
      <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
        <button
          onClick={() => onAuditModeChange('deletions')}
          className={cn(
            'px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5',
            auditMode === 'deletions'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Deletion Audit</span>
        </button>
        <button
          onClick={() => onAuditModeChange('logins')}
          className={cn(
            'px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5',
            auditMode === 'logins'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          )}
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>Sign-In Attempts</span>
          {loginStats.flaggedCount > 0 && (
            <Badge className="bg-danger text-danger-foreground text-2xs px-1 py-0 h-4">
              {loginStats.flaggedCount} alert{loginStats.flaggedCount > 1 ? 's' : ''}
            </Badge>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs gap-1 hover:bg-muted"
          onClick={() => (auditMode === 'deletions' ? onRefreshDeletions : onRefreshLogins)()}
          disabled={auditMode === 'deletions' ? isFetching : loginFetching}
        >
          <RefreshCw className={cn('h-3 w-3', (isFetching || loginFetching) && 'animate-spin')} />
          <span>Refresh</span>
        </Button>
      </div>
    </div>
  );
}
