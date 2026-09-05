import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/DataState';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import {
  User, Building2, Trash2, AlertOctagon, RefreshCw, Clock,
  ShieldAlert, Laptop, AlertTriangle, CheckCircle2, XCircle, Search, KeyRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AuditEntry {
  id: string;
  kind: 'user' | 'plant';
  entity_id: string;
  entity_label: string | null;
  action: 'soft' | 'hard';
  actor_user_id: string | null;
  actor_label: string | null;
  reason: string | null;
  dependencies: Record<string, unknown> | null;
  created_at: string;
}

interface LoginAttempt {
  id: string;
  email: string;
  user_id: string | null;
  username: string | null;
  plant_id: string | null;
  success: boolean;
  error_reason: string | null;
  device_id: string | null;
  user_agent: string | null;
  attempted_at: string;
}

type AuditLogResult = {
  entries: AuditEntry[];
};

export function AuditLogPanel() {
  const { isAdmin } = useAuth();
  const { data: plants = [] } = usePlants();
  const [auditMode, setAuditMode] = useState<'deletions' | 'logins'>('deletions');
  const [kindFilter, setKindFilter] = useState<'all' | 'user' | 'plant'>('all');
  const [loginStatusFilter, setLoginStatusFilter] = useState<'all' | 'failed' | 'success'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Query: Deletions Audit ──
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-audit-log', kindFilter],
    enabled: auditMode === 'deletions',
    queryFn: async (): Promise<AuditLogResult> => {
      let q = supabase
        .from('deletion_audit_log' as any)
        .select('id, kind, entity_id, entity_label, action, actor_user_id, actor_label, reason, dependencies, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (kindFilter !== 'all') q = q.eq('kind', kindFilter);

      const { data: rows, error: sbError } = await q;
      if (sbError) {
        throw new Error(sbError.message);
      }
      return { entries: (rows ?? []) as unknown as AuditEntry[] };
    },
  });

  // ── Query: Login Attempts Audit ──
  const {
    data: loginAttempts = [],
    isLoading: loginLoading,
    isFetching: loginFetching,
    error: loginError,
    refetch: refetchLogins,
  } = useQuery({
    queryKey: ['admin-login-attempts'],
    enabled: isAdmin && auditMode === 'logins',
    queryFn: async (): Promise<LoginAttempt[]> => {
      const { data: rows, error: sbError } = await supabase
        .from('login_attempts' as any)
        .select('*')
        .order('attempted_at', { ascending: false })
        .limit(200);
      if (sbError) throw new Error(sbError.message);
      return (rows ?? []) as unknown as LoginAttempt[];
    },
  });

  const entries = data?.entries ?? [];

  // Anomaly detection: flag emails with >= 5 failures within a 10-minute window
  const flaggedEmails = useMemo(() => {
    const flagged = new Set<string>();
    const WINDOW_MS = 10 * 60 * 1000;
    for (let i = 0; i < loginAttempts.length; i++) {
      if (loginAttempts[i].success) continue;
      const t1 = new Date(loginAttempts[i].attempted_at).getTime();
      let failCount = 0;
      for (let j = i; j < loginAttempts.length; j++) {
        if (!loginAttempts[j].success && loginAttempts[j].email.toLowerCase() === loginAttempts[i].email.toLowerCase()) {
          const t2 = new Date(loginAttempts[j].attempted_at).getTime();
          if (t1 - t2 <= WINDOW_MS) failCount++;
        }
      }
      if (failCount >= 5) flagged.add(loginAttempts[i].email.toLowerCase());
    }
    return flagged;
  }, [loginAttempts]);

  // Filtered login attempts
  const filteredLogins = useMemo(() => {
    return loginAttempts.filter((att) => {
      if (loginStatusFilter === 'failed' && att.success) return false;
      if (loginStatusFilter === 'success' && !att.success) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const emailMatch = att.email.toLowerCase().includes(q);
        const userMatch = att.username?.toLowerCase().includes(q);
        const deviceMatch = att.device_id?.toLowerCase().includes(q);
        const reasonMatch = att.error_reason?.toLowerCase().includes(q);
        if (!emailMatch && !userMatch && !deviceMatch && !reasonMatch) return false;
      }
      return true;
    });
  }, [loginAttempts, loginStatusFilter, searchQuery]);

  // Summary statistics for login attempts
  const loginStats = useMemo(() => {
    const total = loginAttempts.length;
    const successes = loginAttempts.filter((a) => a.success).length;
    const failures = total - successes;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    return { total, successes, failures, rate, flaggedCount: flaggedEmails.size };
  }, [loginAttempts, flaggedEmails]);

  // Group entries by formatted date
  const groupedDeletionsByDay = useMemo(() => {
    const groups: { dateKey: string; label: string; items: AuditEntry[] }[] = [];
    const map = new Map<string, AuditEntry[]>();

    for (const item of entries) {
      const d = new Date(item.created_at);
      const dateKey = format(d, 'yyyy-MM-dd');
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(item);
    }

    for (const [dateKey, items] of map.entries()) {
      const sampleDate = new Date(items[0].created_at);
      let label = format(sampleDate, 'MMMM d, yyyy');
      if (isToday(sampleDate)) label = `Today — ${label}`;
      else if (isYesterday(sampleDate)) label = `Yesterday — ${label}`;
      groups.push({ dateKey, label, items });
    }

    return groups;
  }, [entries]);

  return (
    <div className="space-y-4 font-sans" data-testid="audit-log-panel">
      {/* Top mode switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-xl bg-card border border-border/80 shadow-2xs">
        <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
          <button
            onClick={() => setAuditMode('deletions')}
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
            onClick={() => setAuditMode('logins')}
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
              <Badge className="bg-danger text-danger-foreground text-[10px] px-1 py-0 h-4">
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
            onClick={() => (auditMode === 'deletions' ? refetch() : refetchLogins())}
            disabled={auditMode === 'deletions' ? isFetching : loginFetching}
          >
            <RefreshCw className={cn('h-3 w-3', (isFetching || loginFetching) && 'animate-spin')} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Mode 1: Deletion Audit ── */}
      {auditMode === 'deletions' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
                {(['all', 'user', 'plant'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(k)}
                    className={cn(
                      'px-3 py-1 text-xs font-semibold rounded-md transition-all',
                      kindFilter === k
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                    data-testid={`audit-filter-${k}`}
                  >
                    {k === 'all' ? 'All Events' : k === 'user' ? 'Users Only' : 'Plants Only'}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs text-muted-foreground font-mono-num">
              Showing <strong>{entries.length}</strong> events (capped at 200)
            </div>
          </div>

          {isLoading || (error && !data) ? (
            <DataState loading={isLoading} error={!data ? error : undefined} onRetry={() => refetch()} />
          ) : (
            <div className="space-y-5">
              {groupedDeletionsByDay.map(({ dateKey, label, items }) => (
                <div key={dateKey} className="space-y-2.5">
                  <div className="flex items-center gap-2 sticky top-0 z-10 py-1 bg-background/90 backdrop-blur-xs">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</h4>
                    <div className="flex-1 h-px bg-border/60" />
                    <span className="text-2xs font-mono-num font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                      {items.length} event{items.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {items.map((e) => {
                      const isHard = e.action === 'hard';
                      const isPlant = e.kind === 'plant';

                      return (
                        <Card
                          key={e.id}
                          className={cn(
                            'p-3.5 transition-colors border shadow-2xs',
                            isHard ? 'border-danger/30 hover:border-danger/50' : 'border-border/70 hover:border-border',
                          )}
                          data-testid={`audit-entry-${e.id}`}
                        >
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div
                                className={cn(
                                  'h-7 w-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold',
                                  isPlant ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary',
                                )}
                              >
                                {isPlant ? <Building2 className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-foreground">{e.entity_label ?? e.entity_id}</span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-3xs font-semibold px-1.5 py-0.2 uppercase tracking-wide',
                                      isPlant
                                        ? 'border-info/40 text-info bg-info-soft/40'
                                        : 'border-primary/40 text-primary bg-primary-soft/40',
                                    )}
                                  >
                                    {e.kind}
                                  </Badge>
                                  <Badge variant={isHard ? 'destructive' : 'secondary'} className="text-3xs font-bold px-1.5 py-0.2">
                                    {isHard ? 'Hard Delete' : 'Soft Delete'}
                                  </Badge>
                                  {e.reason?.startsWith('[FORCE]') && (
                                    <Badge className="bg-danger text-danger-foreground text-3xs font-bold px-1.5 py-0.2">
                                      <AlertOctagon className="h-2.5 w-2.5 mr-0.5 inline" /> FORCE
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-2xs text-muted-foreground mt-0.5">
                                  Executed by: <strong className="text-foreground">{e.actor_label ?? e.actor_user_id ?? 'Unknown user'}</strong>
                                </div>
                              </div>
                            </div>

                            <span className="text-2xs text-muted-foreground font-mono-num shrink-0">
                              {format(new Date(e.created_at), 'HH:mm:ss')}
                            </span>
                          </div>

                          {e.reason && (
                            <div className="mt-2 text-xs text-muted-foreground italic bg-muted/40 p-2 rounded-lg border border-border/40">
                              "{e.reason}"
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}

              {entries.length === 0 && (
                <Card className="p-8 text-center text-xs text-muted-foreground space-y-2 border-dashed">
                  <Trash2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                  <div className="font-semibold text-sm text-foreground">No deletion events recorded</div>
                  <p className="text-xs max-w-sm mx-auto">
                    No plant or user records have been soft-deleted or permanently purged under this filter.
                  </p>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Mode 2: Sign-In Attempts Audit ── */}
      {auditMode === 'logins' && (
        <div className="space-y-4">
          {!isAdmin ? (
            <Card className="p-6 text-center space-y-2 border-warn/30 bg-warn-soft/10">
              <ShieldAlert className="h-8 w-8 mx-auto text-warn" />
              <p className="text-sm font-semibold">Admin Access Required</p>
              <p className="text-xs text-muted-foreground">
                Sign-in audit logs contain authentication attempts and device telemetry, accessible exclusively to Administrators.
              </p>
            </Card>
          ) : (
            <>
              {/* Stat Metric Cards */}
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

              {/* Filters & Search */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-card border border-border/80 shadow-2xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex rounded-lg border border-border/70 bg-background overflow-hidden p-0.5 shadow-2xs">
                    {(['all', 'failed', 'success'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setLoginStatusFilter(s)}
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
                      onChange={(e) => setSearchQuery(e.target.value)}
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
                <DataState error={loginError} onRetry={() => refetchLogins()} />
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

                        {/* Error Reason or User Agent info */}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
