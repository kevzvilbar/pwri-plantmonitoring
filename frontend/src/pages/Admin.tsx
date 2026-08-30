import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { usePlants } from '@/hooks/usePlants';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShieldAlert, Users, Building2, ClipboardList, Database,
  ClipboardCheck, ArrowRight, KeyRound, ShieldCheck, Download,
  Upload, Activity, Server,
} from 'lucide-react';

import { UsersPanel } from './admin/UsersPanel';
import { PlantsPanel } from './admin/PlantsPanel';
import { AuditLogPanel } from './admin/AuditLogPanel';
import { MigrationsPanel } from './admin/MigrationsPanel';
import { RolesPanel } from './admin/RolesPanel';
import { PageHeader } from '@/components/PageHeader';

export default function Admin() {
  const { isAdmin, isManager, isDataAnalyst, loading } = useAuth();
  const navigate = useNavigate();
  const { data: plants = [] } = usePlants();

  // Queries for admin overview metrics
  const { data: usersCount = 0 } = useQuery({
    queryKey: ['admin-stats-users-count'],
    queryFn: async () => {
      const { count } = await supabase.from('user_profiles').select('id', { count: 'exact', head: true });
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const { data: auditCount = 0 } = useQuery({
    queryKey: ['admin-stats-audit-count'],
    queryFn: async () => {
      const { count } = await supabase.from('deletion_audit_log' as any).select('id', { count: 'exact', head: true });
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  const canViewUsers = usePermission('admin_users', 'view');
  const canViewMigrations = usePermission('admin_migrations', 'view');

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  if (!isManager && !isDataAnalyst) {
    return (
      <Card className="p-6 text-center space-y-2" data-testid="admin-access-denied">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Only Admin, Manager, or Data Analyst can access this console.
        </p>
        <button
          className="text-sm text-accent hover:underline"
          onClick={() => navigate('/')}
        >
          Back to dashboard
        </button>
      </Card>
    );
  }

  if (isDataAnalyst && !isManager) {
    return (
      <div className="space-y-4 animate-fade-in" data-testid="admin-page-analyst">
        <PageHeader title="Admin Console" subtitle="Reading corrections and pending reviews have moved to Data Corrections." />

        <Card className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <ClipboardCheck className="h-8 w-8 text-primary shrink-0" aria-hidden />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-semibold">Your work is in Data Corrections</p>
            <p className="text-xs text-muted-foreground">
              Pending reviews, flagged readings, correction requests, operator stats, and the full
              normalization audit trail are all available there.
            </p>
          </div>
          <Button
            onClick={() => navigate('/data-corrections')}
            className="gap-2 shrink-0"
          >
            Open Data Corrections <ArrowRight className="h-4 w-4" />
          </Button>
        </Card>
      </div>
    );
  }

  const canManageRoles = isAdmin;
  const tabCount = canViewUsers ? 5 : 2;

  return (
    <div className="space-y-4 animate-fade-in" data-testid="admin-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title="Admin & Governance Console"
          titleIcon={<Server className="h-5 w-5 text-primary" />}
          subtitle="Enterprise governance hub — manage user profiles, plant topology, role RBAC policies, deletion audit trail, and schema migrations."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
            onClick={() => navigate('/exports')}
          >
            <Download className="h-3.5 w-3.5 text-primary" />
            <span>Data Export</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
            onClick={() => navigate('/import')}
          >
            <Upload className="h-3.5 w-3.5 text-primary" />
            <span>Smart Import</span>
          </Button>
        </div>
      </div>



      {/* Quick Navigation Utility Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2.5 rounded-xl bg-muted/30 border border-border/60 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Admin Utilities:</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-2xs font-semibold hover:bg-background"
            onClick={() => navigate('/data-corrections')}
          >
            <ClipboardCheck className="h-3.5 w-3.5 mr-1 text-primary" />
            Data Corrections Hub &rarr;
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-2xs font-semibold hover:bg-background"
            onClick={() => navigate('/compliance')}
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1 text-accent" />
            Compliance Radar &rarr;
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-2xs font-semibold hover:bg-background"
            onClick={() => navigate('/manager-scorecard')}
          >
            <Activity className="h-3.5 w-3.5 mr-1 text-kpi-ro" />
            Manager Scorecard &rarr;
          </Button>
        </div>
        <div className="text-3xs text-muted-foreground flex items-center gap-1 font-mono">
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          <span>PostgreSQL · RLS Active</span>
        </div>
      </div>

      <Tabs defaultValue={canViewUsers ? 'users' : 'plants'}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 gap-1 h-auto sm:h-10 w-full">
          <TabsTrigger value="users" disabled={!canViewUsers} data-testid="admin-tab-users" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" /> Users ({usersCount})
          </TabsTrigger>
          <TabsTrigger value="plants" data-testid="admin-tab-plants" className="gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5" /> Plants ({plants.length})
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-tab-audit" className="gap-1.5 text-xs">
            <ClipboardList className="h-3.5 w-3.5" /> Audit Log
          </TabsTrigger>
          {canViewMigrations && (
            <TabsTrigger value="migrations" data-testid="admin-tab-migrations" className="gap-1.5 text-xs">
              <Database className="h-3.5 w-3.5" /> Migrations
            </TabsTrigger>
          )}
          {canManageRoles && (
            <TabsTrigger value="roles" data-testid="admin-tab-roles" className="gap-1.5 text-xs">
              <KeyRound className="h-3.5 w-3.5" /> Roles (RBAC)
            </TabsTrigger>
          )}
        </TabsList>

        {canViewUsers && (
          <TabsContent value="users" className="mt-4">
            <UsersPanel />
          </TabsContent>
        )}
        <TabsContent value="plants" className="mt-4">
          <PlantsPanel />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogPanel />
        </TabsContent>
        {canViewMigrations && (
          <TabsContent value="migrations" className="mt-4">
            <MigrationsPanel />
          </TabsContent>
        )}
        {canManageRoles && (
          <TabsContent value="roles" className="mt-4">
            <RolesPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

