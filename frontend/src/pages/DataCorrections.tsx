/**
 * DataCorrections.tsx
 * ═══════════════════
 * Unified correction hub — replaces the scattered Admin → Normalization panel,
 * the Pending Readings queue, and the per-row ReadingHistoryDialog corrections.
 *
 * Tabs
 * ────
 * 1. Pending Review  — readings auto-flagged by the DB trigger awaiting approval.
 *                      Bulk approve/retract + inline chain context.
 * 2. Correction Inbox — all active backward or erroneous readings still norm_status='normal'.
 *                      Admin can edit value (cascade), retract, or mark as replacement.
 * 3. Edit History    — reading_normalizations audit trail.
 * 4. Operator Stats  — rolling 30-day error rate table.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ClipboardCheck, Inbox, History, Users, ShieldAlert } from 'lucide-react';
import { PendingReviewTab } from './dataCorrections/tabs/PendingReviewTab';
import { CorrectionInboxTab } from './dataCorrections/tabs/CorrectionInboxTab';
import { EditHistoryTab } from './dataCorrections/tabs/EditHistoryTab';
import { OperatorStatsTab } from './dataCorrections/tabs/OperatorStatsTab';

function usePendingCount() {
  return useQuery({
    queryKey: ['pending-readings-count'],
    queryFn: async () => {
      const tables = ['locator_readings', 'well_readings', 'product_meter_readings'];
      const counts = await Promise.all(
        tables.map((t) =>
          (supabase.from(t as any).select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review') as any)
        )
      );
      return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

function useCorrectionRequestsCount() {
  return useQuery({
    queryKey: ['correction-requests-pending-count'],
    queryFn: async () => {
      const { count } = await (supabase
        .from('correction_requests' as any)
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending') as any);
      return count ?? 0;
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  });
}

function useInboxCount() {
  return useQuery({
    queryKey: ['correction-inbox-count'],
    queryFn: async () => {
      const tables = ['locator_readings', 'well_readings', 'product_meter_readings'];
      const counts = await Promise.all(
        tables.map((t) =>
          (supabase.from(t as any)
            .select('id', { count: 'exact', head: true })
            .eq('norm_status', 'normal')
            .lt('daily_volume', 0)
            .eq('is_meter_replacement', false) as any)
        )
      );
      return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
    },
    staleTime: 60_000,
  });
}

export default function DataCorrections() {
  const { isAdmin, isManager, isDataAnalyst } = useAuth();
  const { data: pendingCount = 0 } = usePendingCount();
  const { data: corrReqsCount = 0 } = useCorrectionRequestsCount();
  const { data: inboxCount = 0 } = useInboxCount();

  if (!isAdmin && !isManager && !isDataAnalyst) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center space-y-2 max-w-sm">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h2 className="font-semibold">Access restricted</h2>
          <p className="text-sm text-muted-foreground">Data Corrections requires Admin, Manager, or Data Analyst access.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Data Corrections & Review Hub"
        subtitle="Review flagged readings, approve operator requested corrections, retract errors, and track data quality in one place."
      />

      <Tabs defaultValue="pending">
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 gap-1 h-auto sm:h-10 w-full">
          <TabsTrigger value="pending" className="gap-1.5 text-xs">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Pending Reviews
            {(pendingCount > 0 || corrReqsCount > 0) && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-destructive text-destructive-foreground">
                {pendingCount + corrReqsCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="inbox" className="gap-1.5 text-xs">
            <Inbox className="h-3.5 w-3.5" />
            Inbox
            {inboxCount > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-2xs bg-warn text-warn-foreground">
                {inboxCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-xs">
            <History className="h-3.5 w-3.5" />
            History &amp; Audits
          </TabsTrigger>
          <TabsTrigger value="operators" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            Operator Accuracy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <PendingReviewTab />
        </TabsContent>
        <TabsContent value="inbox" className="mt-4">
          <CorrectionInboxTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <EditHistoryTab />
        </TabsContent>
        <TabsContent value="operators" className="mt-4">
          <OperatorStatsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
