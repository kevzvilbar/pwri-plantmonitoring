import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { cn } from '@/lib/utils';
import { useDeletionAudit } from './AuditLogPanel/useDeletionAudit';
import { useLoginAudit } from './AuditLogPanel/useLoginAudit';
import { ModeSwitcher } from './AuditLogPanel/ModeSwitcher';
import { DeletionAuditSection } from './AuditLogPanel/DeletionAuditSection';
import { LoginAuditSection } from './AuditLogPanel/LoginAuditSection';

export function AuditLogPanel() {
  const { isAdmin } = useAuth();
  const { data: plants = [] } = usePlants();
  const [auditMode, setAuditMode] = useState<'deletions' | 'logins'>('deletions');
  const [kindFilter, setKindFilter] = useState<'all' | 'user' | 'plant'>('all');
  const [loginStatusFilter, setLoginStatusFilter] = useState<'all' | 'failed' | 'success'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    entries, groupedDeletionsByDay, isLoading, isFetching, error, refetch, data,
  } = useDeletionAudit(kindFilter, auditMode);

  const {
    loginAttempts, loginLoading, loginFetching, loginError, refetchLogins,
    filteredLogins, flaggedEmails, loginStats,
  } = useLoginAudit(isAdmin, auditMode, loginStatusFilter, searchQuery);

  return (
    <div className="space-y-4 font-sans" data-testid="audit-log-panel">
      <ModeSwitcher
        auditMode={auditMode}
        onAuditModeChange={setAuditMode}
        loginStats={loginStats}
        isFetching={isFetching}
        loginFetching={loginFetching}
        onRefreshDeletions={refetch}
        onRefreshLogins={refetchLogins}
      />

      {auditMode === 'deletions' && (
        <DeletionAuditSection
          entries={entries}
          isLoading={isLoading}
          error={error}
          data={data}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          onRetry={() => refetch()}
          groupedDeletionsByDay={groupedDeletionsByDay}
        />
      )}

      {auditMode === 'logins' && (
        <LoginAuditSection
          isAdmin={isAdmin}
          loginAttempts={loginAttempts}
          loginLoading={loginLoading}
          loginFetching={loginFetching}
          loginError={loginError}
          loginStats={loginStats}
          loginStatusFilter={loginStatusFilter}
          onLoginStatusFilterChange={setLoginStatusFilter}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          filteredLogins={filteredLogins}
          flaggedEmails={flaggedEmails}
          plants={plants}
          onRetry={() => refetchLogins()}
        />
      )}
    </div>
  );
}
