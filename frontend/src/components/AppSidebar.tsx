import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Activity, Cog, Wrench, AlertTriangle,
  Users, DollarSign, Receipt, Download, Upload, Sparkles, ShieldCheck, ShieldAlert,
  // ── NEW ──
  GitBranch,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/hooks/useAuth';
import { OPERATOR_DESIGNATION } from '@/components/DesignationCombobox';
import { OPERATOR_ALLOWED_PATHS } from '@/components/ProtectedRoute';
import { cn } from '@/lib/utils';

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
      // ── NEW ── sits after RO Trains, before Maintenance ──────────────────
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

const adminGroup: SidebarGroup = {
  label: 'Admin',
  items: [
    { to: '/admin', label: 'Admin Console', icon: ShieldAlert },
    { to: '/exports', label: 'Data Exports', icon: Download },
    { to: '/import', label: 'Smart Import', icon: Upload },
  ],
};

// Visible to every authenticated user (not just admins)
const sharedGroup: SidebarGroup = {
  label: 'Team',
  items: [
    { to: '/employees', label: 'Employees', icon: Users },
  ],
};

// Filter a group's items to only those whose path is in OPERATOR_ALLOWED_PATHS,
// then drop the group entirely if it ends up empty.
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
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { pathname } = useLocation();
  const { isAdmin, profile, roles } = useAuth();

  const isOperator =
    profile?.designation === OPERATOR_DESIGNATION ||
    (roles.length > 0 && roles.every((r) => r === 'Operator'));

  let visibleGroups: SidebarGroup[];
  if (isOperator) {
    // Only show nav items whose routes Operators are allowed to visit
    visibleGroups = [...groups, sharedGroup]
      .map(filterGroupForOperator)
      .filter((g): g is SidebarGroup => g !== null);
  } else if (isAdmin) {
    visibleGroups = [...groups, sharedGroup, adminGroup];
  } else {
    visibleGroups = [...groups, sharedGroup];
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            {!collapsed && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const isActive = item.end ? pathname === item.to : pathname.startsWith(item.to.split('?')[0]);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={cn(
                            'flex items-center gap-2',
                            isActive && 'bg-accent-soft text-accent font-medium',
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.label}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

        {/* Toggle button — pinned to the sidebar footer, always visible */}
        <SidebarFooter className="p-2 border-t border-sidebar-border">
          <SidebarTrigger className="w-full" />
        </SidebarFooter>
    </Sidebar>
  );
}
