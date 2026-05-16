import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Activity, Cog, Wrench, AlertTriangle,
  Users, DollarSign, Receipt, Download, Upload, Sparkles, ShieldCheck, ShieldAlert,
  GitBranch, FlaskConical, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SidebarItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};
type SidebarGroup = { label: string; items: SidebarItem[] };

const groups: SidebarGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/ai', label: 'AI Assistant', icon: Sparkles },
      { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/plants', label: 'Plants', icon: Building2 },
      { to: '/operations', label: 'Wells & Locators', icon: Activity },
      { to: '/ro-trains', label: 'RO Trains', icon: Cog },
      { to: '/topology', label: 'Network Topology', icon: GitBranch },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { to: '/maintenance', label: 'PM Schedule', icon: Wrench },
      { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/costs', label: 'Costs & Tariffs', icon: DollarSign },
      { to: '/costs?tab=prices', label: 'Chemical Prices', icon: Receipt },
    ],
  },
];

const adminOnlyGroup: SidebarGroup = {
  label: 'Admin',
  items: [
    { to: '/admin', label: 'Admin Console', icon: ShieldAlert },
  ],
};

const dataAnalysisGroup: SidebarGroup = {
  label: 'Analysis',
  items: [
    { to: '/data-analysis', label: 'Data Analysis & Review', icon: FlaskConical },
  ],
};

const dataGroup: SidebarGroup = {
  label: 'Data',
  items: [
    { to: '/exports', label: 'Data Exports', icon: Download },
    { to: '/import', label: 'Smart Import', icon: Upload },
  ],
};

const sharedGroup: SidebarGroup = {
  label: 'Team',
  items: [
    { to: '/employees', label: 'Employees', icon: Users },
  ],
};

function filterGroupForOperator(group: SidebarGroup): SidebarGroup | null {
  const items = group.items.filter((item) => {
    const path = item.to.split('?')[0];
    return OPERATOR_ALLOWED_PATHS.some(
      (allowed) => allowed === '/' ? path === '/' : path.startsWith(allowed),
    );
  });
  return items.length > 0 ? { ...group, items } : null;
}

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const { pathname } = useLocation();
  const { isAdmin, isManager, isDataAnalyst, profile, roles } = useAuth();

  const isOperator =
    profile?.designation === OPERATOR_DESIGNATION ||
    (roles.length > 0 && roles.every((r) => r === 'Operator'));

  let visibleGroups: SidebarGroup[];
  if (isOperator) {
    visibleGroups = [...groups, sharedGroup]
      .map(filterGroupForOperator)
      .filter((g): g is SidebarGroup => g !== null);
  } else if (isAdmin) {
    visibleGroups = [...groups, sharedGroup, dataGroup, dataAnalysisGroup, adminOnlyGroup];
  } else if (isDataAnalyst) {
    visibleGroups = [...groups, sharedGroup, dataGroup, dataAnalysisGroup, adminOnlyGroup];
  } else if (isManager) {
    visibleGroups = [...groups, sharedGroup, dataGroup, dataAnalysisGroup];
  } else {
    visibleGroups = [...groups, sharedGroup];
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="py-2 gap-0 overflow-x-hidden">
        {visibleGroups.map((g, groupIdx) => (
          <SidebarGroup
            key={g.label}
            className="px-2 py-0"
          >
            {/* Collapsed: dot-divider between groups */}
            {collapsed && groupIdx > 0 && (
              <div className="my-1.5 mx-auto w-4 h-px bg-sidebar-border/50 rounded-full" />
            )}

            {/* Group label — visible only when expanded */}
            {!collapsed && (
              <SidebarGroupLabel
                className={cn(
                  'h-5 px-1.5 mb-0.5',
                  'text-[9.5px] font-bold tracking-[0.12em] uppercase select-none',
                  'text-sidebar-foreground/35',
                  groupIdx > 0 && 'border-t border-sidebar-border/30 pt-2.5 mt-2',
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
                                'hover:bg-sidebar-accent/70 transition-colors duration-150',
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
                                      : 'text-sidebar-foreground/55',
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
                              'text-[12.5px] leading-tight transition-all duration-150 group',
                              isActive
                                ? [
                                    'bg-sidebar-accent/80 text-sidebar-foreground font-semibold',
                                    'shadow-[inset_2px_0_0_0_hsl(var(--sidebar-primary))]',
                                  ]
                                : 'text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
                            )}
                          >
                            <item.icon
                              className={cn(
                                'h-[14px] w-[14px] shrink-0 transition-colors duration-150',
                                isActive
                                  ? 'text-sidebar-primary'
                                  : 'text-sidebar-foreground/45 group-hover:text-sidebar-foreground/70',
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

      {/* Collapse toggle — minimal, pinned footer */}
      <SidebarFooter className="p-2 border-t border-sidebar-border/30">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'flex items-center rounded-md transition-all duration-150',
                'text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/50',
                collapsed
                  ? 'w-8 h-7 mx-auto justify-center'
                  : 'w-full h-7 gap-1.5 px-2 justify-start',
              )}
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <>
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-[11px] font-medium">Collapse</span>
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
