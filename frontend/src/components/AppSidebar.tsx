import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Droplet, Wrench, AlertTriangle,
  Users, Download, Upload, ShieldCheck, ShieldAlert,
  GitBranch, FlaskConical, ChevronLeft, ChevronRight,
  ClipboardCheck, Award, Bell } from 'lucide-react';
// Icon-audit fix: RO Trains now uses the purpose-built ROTrainIcon instead
// of the generic gear/Cog glyph, matching TrainsList and the mobile nav.
import { ROTrainIcon, PesoSignIcon } from '@/components/icons/water-icons';
import { Logomark } from '@/components/icons/Logomark';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { hasPermission, type Role } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// New 6-group structure organized by user task (from navConfig.ts GROUP_DEFS)
// Overview | Assets | Daily Logs | Review | Admin | Other

type SidebarItem = {
  to: string;
  label: string;
  icon: any;
  end?: boolean;
  show?: boolean;  // Set by permission check
};

type SidebarGroup = { label: string; items: SidebarItem[] };

// Build groups dynamically based on permissions
function buildSidebarGroups(roles: Role[]): SidebarGroup[] {
  const groups: SidebarGroup[] = [];

  // Overview: Dashboard + Alerts (always visible)
  const overviewItems: SidebarItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  ];
  // Add Alerts if visible (it's now in OPERATOR_ALLOWED_PATHS)
  if (hasPermission(roles, 'alerts', 'view')) {
    overviewItems.push({ to: '/alerts', label: 'Alerts', icon: Bell });
  }
  groups.push({ label: 'Overview', items: overviewItems });

  // Assets: Plants + Network Topology
  const assetsItems: SidebarItem[] = [];
  if (hasPermission(roles, 'plants', 'view')) {
    assetsItems.push({ to: '/plants', label: 'Plants', icon: Building2 });
  }
  if (hasPermission(roles, 'network_topology', 'view')) {
    assetsItems.push({ to: '/topology', label: 'Network Topology', icon: GitBranch });
  }
  if (assetsItems.length > 0) {
    groups.push({ label: 'Assets', items: assetsItems });
  }

  // Daily Logs: Operations + RO Trains + PM + Incidents (the shift loop)
  const dailyLogsItems: SidebarItem[] = [];
  if (hasPermission(roles, 'operations', 'view')) {
    dailyLogsItems.push({ to: '/operations', label: 'Daily Readings', icon: Droplet });
  }
  if (hasPermission(roles, 'ro_trains', 'view')) {
    dailyLogsItems.push({ to: '/ro-trains', label: 'RO Trains', icon: ROTrainIcon });
  }
  if (hasPermission(roles, 'pm_schedule', 'view')) {
    dailyLogsItems.push({ to: '/maintenance', label: 'PM Schedule', icon: Wrench });
  }
  if (hasPermission(roles, 'incidents', 'view')) {
    dailyLogsItems.push({ to: '/incidents', label: 'Incidents', icon: AlertTriangle });
  }
  if (dailyLogsItems.length > 0) {
    groups.push({ label: 'Daily Logs', items: dailyLogsItems });
  }

  // Review: Data Analysis + Data Corrections + Manager Scorecard
  const reviewItems: SidebarItem[] = [];
  if (hasPermission(roles, 'data_analysis_review', 'view')) {
    reviewItems.push({ to: '/data-analysis', label: 'Data Analysis & Review', icon: FlaskConical });
  }
  if (hasPermission(roles, 'data_corrections', 'view')) {
    reviewItems.push({ to: '/data-corrections', label: 'Data Corrections', icon: ClipboardCheck });
  }
  if (hasPermission(roles, 'manager_scorecard', 'view')) {
    reviewItems.push({ to: '/manager-scorecard', label: 'Manager Scorecard', icon: Award });
  }
  if (reviewItems.length > 0) {
    groups.push({ label: 'Review', items: reviewItems });
  }

  // Admin: Only for Admin role
  const adminItems: SidebarItem[] = [];
  if (hasPermission(roles, 'admin_users', 'view')) {
    adminItems.push({ to: '/admin', label: 'Admin Console', icon: ShieldAlert });
  }
  if (adminItems.length > 0) {
    groups.push({ label: 'Admin', items: adminItems });
  }

  // Other: Compliance + Costs + Employees + Exports + Import + Profile
  const otherItems: SidebarItem[] = [];
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
  // Profile is always visible (UNCONFIGURABLE_MODULES)
  otherItems.push({ to: '/profile', label: 'Profile', icon: LayoutDashboard });
  if (otherItems.length > 0) {
    groups.push({ label: 'Other', items: otherItems });
  }

  return groups;
}

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const { pathname } = useLocation();
  const { profile, roles } = useAuth();

  // Build sidebar groups dynamically based on permissions
  // This replaces the old hardcoded role-based groups
  const visibleGroups = buildSidebarGroups(roles as Role[]);

  return (
    <Sidebar collapsible="icon">
      {/* ── Brand header: seamlessly aligned with TopBar h-12 in both collapsed & expanded states ── */}
      <div
        className={cn(
          'h-12 border-b border-sidebar-border/40 shrink-0 flex items-center transition-[padding,width] duration-200 ease-spring-out',
          collapsed ? 'justify-center px-0' : 'px-3.5 gap-2.5',
        )}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink
                to="/"
                className="flex items-center justify-center w-full h-full focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring rounded-md transition-transform duration-150 hover:scale-105 active:scale-95"
                aria-label="PWRI Monitoring & Alert - Dashboard"
              >
                <Logomark size={26} className="shrink-0" />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs font-semibold">
              PWRI Monitoring & Alert
            </TooltipContent>
          </Tooltip>
        ) : (
          <NavLink
            to="/"
            className="flex items-center gap-2.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring rounded-md group"
            aria-label="PWRI Monitoring & Alert - Dashboard"
          >
            <Logomark size={28} className="shrink-0 group-hover:scale-105 transition-transform duration-150" />
            <div className="flex flex-col leading-none">
              <span className="text-xs font-semibold text-sidebar-foreground tracking-tight group-hover:text-sidebar-primary transition-colors">
                PWRI
              </span>
              <span className="text-3xs text-sidebar-foreground/35 tracking-[0.1em] uppercase">
                Monitoring & Alert
              </span>
            </div>
          </NavLink>
        )}
      </div>

      <SidebarContent className="py-2 gap-0 overflow-x-hidden">
        {visibleGroups.map((g, groupIdx) => (
          <SidebarGroup
            key={g.label}
            className="px-2 py-0"
          >
            {/* Collapsed: subtle dot-divider between groups */}
            {collapsed && groupIdx > 0 && (
              <div className="my-1.5 mx-auto w-4 h-px bg-sidebar-border/40 rounded-full" />
            )}

            {/* Group label — visible only when expanded */}
            {!collapsed && (
              <SidebarGroupLabel
                className={cn(
                  'h-5 px-1.5 mb-0.5',
                  'text-3xs font-bold tracking-[0.14em] uppercase select-none',
                  'text-sidebar-foreground/30',
                  groupIdx > 0 && 'border-t border-sidebar-border/25 pt-2.5 mt-2',
                )}
              >
                {g.label}
              </SidebarGroupLabel>
            )}

            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {g.items.map((item) => {
                  const isActive = item.end
                    ? pathname === item.to
                    : pathname.startsWith(item.to.split('?')[0]);

                  return (
                    <SidebarMenuItem key={item.to}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              asChild
                              size="sm"
                              className={cn(
                                'h-8 w-8 p-0 flex items-center justify-center rounded-md mx-auto',
                                'hover:bg-sidebar-accent/80 transition-all duration-200 hover:scale-110 active:scale-95',
                                isActive && [
                                  'bg-sidebar-accent',
                                  'shadow-[inset_2px_0_0_0_hsl(var(--sidebar-primary))]',
                                ],
                              )}
                            >
                              <NavLink to={item.to} end={item.end}>
                                <item.icon
                                  className={cn(
                                    'h-[15px] w-[15px] shrink-0 transition-colors duration-150',
                                    isActive
                                      ? 'text-sidebar-primary'
                                      : 'text-sidebar-foreground/45',
                                  )}
                                />
                              </NavLink>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs font-medium">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SidebarMenuButton
                          asChild
                          size="sm"
                          className="h-auto p-0 hover:bg-transparent active:bg-transparent focus-visible:ring-0"
                        >
                          <NavLink
                            to={item.to}
                            end={item.end}
                            className={cn(
                              'flex items-center gap-2.5 w-full px-2 py-[5px] rounded-md',
                              'text-xs leading-tight transition-all duration-200 group hover:translate-x-1 active:scale-[0.98]',
                              isActive
                                ? [
                                    'bg-sidebar-accent text-sidebar-foreground font-semibold',
                                    'shadow-[inset_2.5px_0_0_0_hsl(var(--sidebar-primary))]',
                                  ]
                                : 'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
                            )}
                          >
                            <item.icon
                              className={cn(
                                'h-[14px] w-[14px] shrink-0 transition-colors duration-150',
                                isActive
                                  ? 'text-sidebar-primary'
                                  : 'text-sidebar-foreground/38 group-hover:text-sidebar-foreground/65',
                              )}
                            />
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Collapse toggle */}
      <SidebarFooter className="p-2 border-t border-sidebar-border/30">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'flex items-center rounded-md transition-all duration-200 active:scale-95',
                'text-sidebar-foreground/35 hover:text-sidebar-foreground/65 hover:bg-sidebar-accent/60',
                collapsed
                  ? 'w-8 h-7 mx-auto justify-center hover:scale-110'
                  : 'w-full h-7 gap-1.5 px-2 justify-start hover:translate-x-0.5',
              )}
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <>
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs font-medium">Collapse</span>
                </>
              )}
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right" className="text-xs">
              Expand sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  );
}
