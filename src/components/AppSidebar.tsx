"use client";
import { NavLink } from '@/components/NavLink';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Activity, Cog, FlaskConical, Wrench, AlertTriangle,
  Users, DollarSign, Receipt, Download,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

const groups = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Operations',
    items: [
      { to: '/plants', label: 'Plants', icon: Building2 },
      { to: '/operations', label: 'Wells & Locators', icon: Activity },
      { to: '/ro-trains', label: 'RO Trains', icon: Cog },
      { to: '/chemicals', label: 'Chemicals', icon: FlaskConical },
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
  {
    label: 'Admin',
    items: [
      { to: '/employees', label: 'Employees', icon: Users },
      { to: '/exports', label: 'Data Exports', icon: Download },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const pathname = usePathname() ?? '';

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {groups.map((g) => (
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
    </Sidebar>
  );
}
