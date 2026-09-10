import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { LoginAttempt, LoginStats } from './types';

export function useLoginAudit(isAdmin: boolean, auditMode: string, loginStatusFilter: string, searchQuery: string) {
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
        .from('login_attempts')
        .select('*')
        .order('attempted_at', { ascending: false })
        .limit(200);
      if (sbError) throw new Error(sbError.message);
      return (rows ?? []) as unknown as LoginAttempt[];
    },
  });

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

  const loginStats = useMemo<LoginStats>(() => {
    const total = loginAttempts.length;
    const successes = loginAttempts.filter((a) => a.success).length;
    const failures = total - successes;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    return { total, successes, failures, rate, flaggedCount: flaggedEmails.size };
  }, [loginAttempts, flaggedEmails]);

  return { loginAttempts, loginLoading, loginFetching, loginError, refetchLogins, filteredLogins, flaggedEmails, loginStats };
}
