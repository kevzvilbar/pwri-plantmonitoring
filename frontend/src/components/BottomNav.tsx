import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Menu, Bell,
  Building2, Droplet,
  Wrench, AlertTriangle, Users, Download, Upload, ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  GitBranch, FlaskConical, Award,
} from 'lucide-react';
// Icon-audit fix: RO Trains now uses the purpose-built ROTrainIcon (linked
// membrane blocks) instead of the generic gear/Cog glyph, matching TrainsList
// and the desktop sidebar so the concept renders the same everywhere.
import { ROTrainIcon, PesoSignIcon } from '@/components/icons/water-icons';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission, type Role } from '@/lib/permissions';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';

// Priority items for mobile bottom nav (Dashboard centered).
// Suggested: Readings · RO trains · Dashboard · Alerts · More
// Plants moves into More (it's a registry operators visit less often)
type Priority = {
  to: string;
  label: string;
  mobileLabel?: string;
  icon: any;
  match?: string[];
  matchTabValues?: string[];
};

// Left side: Plants + Daily Readings (Wells & Locators)
const leftPriority: Priority[] = [
  { to: '/plants', label: 'Plants', icon: Building2 },
  {
    to: '/operations?tab=wells',
    label: 'Daily Readings',
    // Renamed from "Wells & Locators" — the page holds Wells, Locators, Product, Blending, Power
    mobileLabel: 'Readings',
    icon: Droplet,
    match: ['/operations'],
    matchTabValues: ['well', 'wells', 'locator', 'locators', 'product', 'blending', 'power'],
  },
];

// Right side: RO Trains
const rightPriority: Priority[] = [
  { to: '/ro-trains', label: 'RO Trains', icon: ROTrainIcon },
];

// Items hidden behind the side sheet - organized by the new 6-group structure
// with permission-based visibility
function buildSideSheetGroups(roles: Role[]): { title: string; items: { to: string; label: string; icon: any }[] }[] {
  const groups: { title: string; items: { to: string; label: string; icon: any }[] }[] = [];

  // Overview: Alerts (if permission allows)
  const overviewItems: { to: string; label: string; icon: any }[] = [];
  if (hasPermission(roles, 'alerts', 'view')) {
    overviewItems.push({ to: '/alerts', label: 'Alerts', icon: Bell });
  }
  if (overviewItems.length > 0) {
    groups.push({ title: 'Overview', items: overviewItems });
  }

  // Assets: Network Topology
  const assetsItems: { to: string; label: string; icon: any }[] = [];
  if (hasPermission(roles, 'network_topology', 'view')) {
    assetsItems.push({ to: '/topology', label: 'Network Topology', icon: GitBranch });
  }
  if (assetsItems.length > 0) {
    groups.push({ title: 'Assets', items: assetsItems });
  }

  // Daily Logs: PM Schedule + Incidents
  const dailyLogsItems: { to: string; label: string; icon: any }[] = [];
  if (hasPermission(roles, 'pm_schedule', 'view')) {
    dailyLogsItems.push({ to: '/maintenance', label: 'PM Schedule', icon: Wrench });
  }
  if (hasPermission(roles, 'incidents', 'view')) {
    dailyLogsItems.push({ to: '/incidents', label: 'Incidents', icon: AlertTriangle });
  }
  if (dailyLogsItems.length > 0) {
    groups.push({ title: 'Daily Logs', items: dailyLogsItems });
  }

  // Review: Data Analysis + Data Corrections + Manager Scorecard
  const reviewItems: { to: string; label: string; icon: any }[] = [];
  if (hasPermission(roles, 'data_analysis_review', 'view')) {
    reviewItems.push({ to: '/data-analysis', label: 'Data Analysis', icon: FlaskConical });
  }
  if (hasPermission(roles, 'data_corrections', 'view')) {
    reviewItems.push({ to: '/data-corrections', label: 'Data Corrections', icon: ClipboardCheck });
  }
  if (hasPermission(roles, 'manager_scorecard', 'view')) {
    reviewItems.push({ to: '/manager-scorecard', label: 'Manager Scorecard', icon: Award });
  }
  if (reviewItems.length > 0) {
    groups.push({ title: 'Review', items: reviewItems });
  }

  // Other: Compliance + Costs + Employees + Exports + Import + Profile
  const otherItems: { to: string; label: string; icon: any }[] = [];
  if (hasPermission(roles, 'compliance', 'view')) {
    otherItems.push({ to: '/compliance', label: 'Compliance', icon: ShieldCheck });
  }
  if (hasPermission(roles, 'costs', 'view')) {
    otherItems.push({ to: '/costs', label: 'Costs & Tariffs', icon: PesoSignIcon });
  }
  if (hasPermission(roles, 'employees', 'view')) {
    otherItems.push({ to: '/employees', label: 'Employees', icon: Users });
  }
  if (hasPermission(roles, 'data_exports', 'view')) {
    otherItems.push({ to: '/exports', label: 'Data Exports', icon: Download });
  }
  if (hasPermission(roles, 'smart_import', 'view')) {
    otherItems.push({ to: '/import', label: 'Smart Import', icon: Upload });
  }
  // Profile is always accessible
  otherItems.push({ to: '/profile', label: 'Profile', icon: LayoutDashboard });
  if (otherItems.length > 0) {
    groups.push({ title: 'Other', items: otherItems });
  }

  // Admin: Only for Admin role
  if (hasPermission(roles, 'admin_users', 'view')) {
    groups.push({
      title: 'Admin',
      items: [{ to: '/admin', label: 'Admin Console', icon: ShieldAlert }],
    });
  }

  return groups;
}

export function BottomNav() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { profile, roles } = useAuth();
  const fullPath = pathname + search;

  // Build bottom nav groups dynamically based on permissions
  // This replaces the old hardcoded role-based groups
  const visibleGroups = buildSideSheetGroups(roles as Role[]);

  const isPriorityActive = (item: Priority) => {
    const target = item.to.split('?')[0];
    if (item.match) {
      const pathMatch = item.match.some((p) => pathname.startsWith(p));
      if (!pathMatch) return false;
      // Prefer exact `?tab=` value matching when configured; this is robust
      // against unrelated query params that could otherwise contain the same
      // substring.
      const currentTab = (new URLSearchParams(search).get('tab') || '').toLowerCase();
      if (item.matchTabValues) return item.matchTabValues.includes(currentTab);
      // Fallback: match the literal query string from the item's `to`.
      const ownQuery = item.to.split('?')[1] ?? '';
      return ownQuery ? fullPath.includes(ownQuery) : true;
    }
    return pathname === target || pathname.startsWith(target + '/');
  };

  const renderPriority = (item: Priority) => {
    const active = isPriorityActive(item);
    return (
      <button
        key={item.to}
        onClick={() => navigate(item.to)}
        aria-label={item.label}
        className={cn(
          'flex flex-col items-center justify-center gap-0.5 py-2 px-1 transition-all',
          active
            ? 'text-primary text-xs font-semibold'
            : 'text-muted-foreground/70 text-3xs font-medium hover:text-foreground',
        )}
      >
        <item.icon
          className={cn(
            'transition-all',
            active ? 'h-[22px] w-[22px] drop-shadow-sm' : 'h-[18px] w-[18px]',
          )}
        />
        <span className="leading-none">{item.mobileLabel ?? item.label}</span>
      </button>
    );
  };

  return (
    <nav
      className={cn(
        'md:hidden sticky bottom-0 z-40 bg-card border-t shadow-[0_-2px_8px_-2px_hsl(210_30%_12%/0.06)]',
        // Bottom safe-area inset (requires viewport-fit=cover in index.html)
        // keeps the row clear of the home-indicator/gesture bar on notched
        // phones instead of sitting flush underneath it.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <div className="grid grid-cols-5 max-w-3xl mx-auto items-end">
        {leftPriority.map(renderPriority)}

        {/* Centered, prominent Dashboard button */}
        <NavLink
          to="/"
          end
          className={({ isActive }) => cn(
            // px-0.5 not px-1 (unlike the other 4 columns): "Dashboard" at
            // 11px/semibold measures 58px in the real Inter font — with
            // px-1's 8px of padding that's a ~2px overflow of the 56px
            // budget on the narrowest realistic viewport (320px); px-0.5
            // clears it with room to spare. Verified against Inter's actual
            // metrics, not estimated — see BottomNav in the mobile UX audit.
            'flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 text-3xs font-semibold transition-colors -mt-3',
            isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {({ isActive }) => (
            <>
              <span className={cn(
                'flex items-center justify-center h-12 w-12 rounded-full shadow-elev border-2 border-card transition-all',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-accent/90 text-accent-foreground',
              )}>
                <LayoutDashboard className="h-5 w-5" />
              </span>
              <span className="leading-none mt-0.5 text-foreground">Dashboard</span>
            </>
          )}
        </NavLink>

        {rightPriority.map(renderPriority)}

        {/* Side sheet: employees, data exports, and other less-frequent items */}
        <Sheet>
          <SheetTrigger asChild>
            <button className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-3xs font-medium text-muted-foreground hover:text-foreground">
              <Menu className="h-[18px] w-[18px]" />
              <span className="leading-none">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader><SheetTitle>More</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-4 overflow-y-auto">
              {visibleGroups.map((group) => (
                <div key={group.title}>
                  <div className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">{group.title}</div>
                  <div className="flex flex-col gap-1">
                    {group.items.map((r) => (
                      <NavLink
                        key={r.to}
                        to={r.to}
                        className={({ isActive }) => cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                          isActive ? 'bg-primary-soft text-primary font-medium shadow-[inset_2.5px_0_0_hsl(var(--primary))]' : 'hover:bg-muted text-foreground/75',
                        )}
                      >
                        <r.icon className="h-4 w-4" />
                        {r.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
