import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { ShieldAlert, Users, Building2, ClipboardList, Database } from 'lucide-react';

import { UsersPanel } from './admin/UsersPanel';
import { PlantsPanel } from './admin/PlantsPanel';
import { AuditLogPanel } from './admin/AuditLogPanel';
import { MigrationsPanel } from './admin/MigrationsPanel';
import { NormalizationPanel } from './admin/NormalizationPanel';

export default function Admin() {
  const { isAdmin, isManager, isDataAnalyst, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  // Data Analysts access the console for the Normalization tab only.
  // Full admin console (Users, Migrations) requires Manager or Admin.
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

  // Data Analyst only — show a focused normalization-only view
  if (isDataAnalyst && !isManager) {
    return (
      <div className="space-y-3 animate-fade-in" data-testid="admin-page-analyst">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Normalization console</h1>
          <p className="text-xs text-muted-foreground">
            Review flagged readings, apply corrections, and audit normalization actions.
          </p>
        </div>
        <NormalizationPanel />
      </div>
    );
  }

  // Count visible tabs to size the grid correctly
  // Manager sees: Plants, Audit (2)
  // Admin sees:   Users, Plants, Audit, Migrations (4)
  const tabCount = isAdmin ? 4 : 2;

  return (
    <div className="space-y-3 animate-fade-in" data-testid="admin-page">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin console</h1>
        <p className="text-xs text-muted-foreground">
          Manage users, plants, and the deletion audit trail. Soft-delete keeps
          audit history; hard-delete is blocked while dependencies exist (Admin
          can override with explicit confirmation).
        </p>
      </div>

      <Tabs defaultValue={isAdmin ? 'users' : 'plants'}>
        <TabsList className={`grid grid-cols-${tabCount} w-full`}>
          <TabsTrigger value="users" disabled={!isAdmin} data-testid="admin-tab-users">
            <Users className="h-3 w-3 mr-1" /> Users
          </TabsTrigger>
          <TabsTrigger value="plants" data-testid="admin-tab-plants">
            <Building2 className="h-3 w-3 mr-1" /> Plants
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-tab-audit">
            <ClipboardList className="h-3 w-3 mr-1" /> Audit log
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="migrations" data-testid="admin-tab-migrations">
              <Database className="h-3 w-3 mr-1" /> Migrations
            </TabsTrigger>
          )}
        </TabsList>

        {/* Banner: redirect to unified Data Corrections page */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-teal-50 dark:bg-teal-950/20 border border-teal-200 dark:border-teal-800/40 rounded-lg mt-3 text-xs">
          <span className="text-teal-800 dark:text-teal-300">
            Reading corrections, pending reviews, and operator stats have moved to <strong>Data Corrections</strong>.
          </span>
          <a href="/pwri-plantmonitoring/data-corrections"
             className="shrink-0 text-teal-700 dark:text-teal-400 font-medium hover:underline">
            Open →
          </a>
        </div>

        {isAdmin && (
          <TabsContent value="users" className="mt-3">
            <UsersPanel />
          </TabsContent>
        )}
        <TabsContent value="plants" className="mt-3">
          <PlantsPanel />
        </TabsContent>
        <TabsContent value="audit" className="mt-3">
          <AuditLogPanel />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="migrations" className="mt-3">
            <MigrationsPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

