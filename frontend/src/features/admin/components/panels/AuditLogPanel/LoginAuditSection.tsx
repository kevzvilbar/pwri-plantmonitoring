import React, { type Dispatch, type SetStateAction } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataState } from '@/components/DataState';
import { Input } from '@/components/ui/input';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, XCircle, AlertTriangle, Laptop, KeyRound, ShieldAlert, Search,
} from 'lucide-react';
import type { LoginAttempt, LoginStats } from './types';

interface LoginAuditSectionProps {
  isAdmin: boolean;
  loginAttempts: LoginAttempt[];
  loginLoading: boolean;
  loginFetching: boolean;
  loginError: any;
  loginStats: LoginStats;
  loginStatusFilter: 'all' | 'failed' | 'success';
  onLoginStatusFilterChange: Dispatch<SetStateAction<'all' | 'failed' | 'success'>>;
  searchQuery: string;
  onSearchQueryChange: Dispatch<SetStateAction<string>>;
  filteredLogins: LoginAttempt[];
  flaggedEmails: Set<string>;
  plants: any[];
  onRetry: () => void;
}

export function LoginAuditSection({
  isAdmin, loginAttempts, loginLoading, loginFetching, loginError, loginStats,
  loginStatusFilter, onLoginStatusFilterChange, searchQuery, onSearchQueryChange,
  filteredLogins, flaggedEmails, plants, onRetry,
}: LoginAuditSectionProps) {
  if (!isAdmin) {
    return (
      <Card className="p-6 text-center space-y-2 border-warn/30 bg-warn-soft/10">
        <ShieldAlert className="h-8 w-8 mx-auto text-warn" />
        <p className="text-sm font-semibold">Admin Access Required</p>
        <p className="text-xs text-muted-foreground">
          Sign-in audit logs contain authentication attempts and device telemetry, accessible exclusively to Administrators.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Card className="p-3 space-y-1">
          <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Total Attempts</span>
          <div className="text-xl font-bold font-mono-num">{loginStats.total}</div>
          <span className="text-3xs text-muted-foreground">Most recent 200 events</span>
        </Card>
        <Card className="p-3 space-y-1">
          <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Success Rate</span>
          <div className="text-xl font-bold font-mono-num text-success">{loginStats.rate}%</div>
          <span className="text-3xs text-muted-foreground">{loginStats.successes} successful sign-ins</span>
        </Card>
        <Card className="p-3 space-y-1">
          <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Failed Attempts</span>
          <div className="text-xl font-bold font-mono-num text-danger">{loginStats.failures}</div>
          <span className="text-3xs text-muted-foreground">Bad credentials or validation</span>
        </Card>
        <Card className={cn('p-3 space-y-1', loginStats.flaggedCount > 0 && 'border-danger/40 bg-danger-soft/15')}>
          <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Anomaly Alerts</span>
          <div className={cn('text-xl font-bold font-mono-num', loginStats.flaggedCount > 0 ? 'text-danger' : 'text-muted-foreground')}>
            {loginStats.flaggedCount}
          </div>
          <span className="text-3xs text-muted-foreground">&gt;5 failures in 10m window</span>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
            {(['all', 'failed', 'success'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onLoginStatusFilterChange(s)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded-md transition-all',
                  loginStatusFilter === s
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {s === 'all' ? 'All' : s === 'failed' ? 'Failed Only' : 'Successful'}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px]">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search email, username, device…"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="text-xs text-muted-foreground font-mono-num">
          Showing <strong>{filteredLogins.length}</strong> of {loginAttempts.length}
        </div>
      </div>

      {loginLoading ? (
        <DataState loading />
      ) : loginError ? (
        <DataState error={loginError} onRetry={onRetry} />
      ) : filteredLogins.length === 0 ? (
        <Card className="p-8 text-center text-xs text-muted-foreground space-y-2 border-dashed">
          <KeyRound className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <div className="font-semibold text-sm text-foreground">No sign-in attempts match this filter</div>
          <p className="text-xs max-w-sm mx-auto">
            Try adjusting the search query or status filter to see login activity.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredLogins.map((att) => {
            const isFlagged = flaggedEmails.has(att.email.toLowerCase());
            const plantName = plants.find((p) => p.id === att.plant_id)?.name ?? att.plant_id;
            const date = new Date(att.attempted_at);

            return (
              <Card
                key={att.id}
                className={cn(
                  'p-3.5 transition-all border shadow-2xs space-y-2',
                  !att.success
                    ? isFlagged
                      ? 'border-danger/60 bg-danger-soft/10'
                      : 'border-danger/25 hover:border-danger/40'
                    : 'border-border/70 hover:border-border',
                )}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-2.5">
                    <div
                      className={cn(
                        'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        att.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                      )}
                    >
                      {att.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-foreground">{att.email}</span>
                        {att.username && (
                          <Badge variant="outline" className="text-2xs font-mono">
                            @{att.username}
                          </Badge>
                        )}
                        <Badge
                          variant={att.success ? 'default' : 'destructive'}
                          className="text-3xs font-semibold px-1.5 py-0.2"
                        >
                          {att.success ? 'Success' : 'Failed'}
                        </Badge>
                        {isFlagged && (
                          <Badge className="bg-danger text-danger-foreground text-3xs font-bold px-1.5 py-0.2 flex items-center gap-1 animate-pulse">
                            <AlertTriangle className="h-2.5 w-2.5" /> High Failures (10m)
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-2xs text-muted-foreground flex-wrap">
                        {plantName && <span>Plant: <strong className="text-foreground">{plantName}</strong></span>}
                        {att.device_id && (
                          <span className="flex items-center gap-1 font-mono">
                            <Laptop className="h-3 w-3" />
                            Device: {att.device_id.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-2xs font-mono-num font-semibold text-foreground">
                      {format(date, 'MMM d, yyyy HH:mm:ss')}
                    </div>
                    <div className="text-3xs text-muted-foreground">
                      {formatDistanceToNow(date, { addSuffix: true })}
                    </div>
                  </div>
                </div>

                {(!att.success || att.user_agent) && (
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50 text-2xs text-muted-foreground flex-wrap">
                    {att.error_reason ? (
                      <div className="text-danger font-medium">
                        Reason: {att.error_reason}
                      </div>
                    ) : <div />}

                    {att.user_agent && (
                      <div className="text-3xs text-muted-foreground truncate max-w-md font-mono" title={att.user_agent}>
                        {att.user_agent}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
