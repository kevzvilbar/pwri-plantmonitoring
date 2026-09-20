import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Logomark } from '@/components/icons/Logomark';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import { NavItemBadge } from '@/components/NavItemBadge';
import { useNavGroups } from '@/hooks/useNavGroups';
import { isNavItemActive } from '@/navConfig';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const { pathname } = useLocation();

  // Groups, order, labels and visibility all come from navConfig.ts via
  // useNavGroups(); BottomNav renders the same groups.
  const visibleGroups = useNavGroups();

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
                  const isActive = isNavItemActive(item, pathname);

                  return (
                    <SidebarMenuItem key={item.id}>
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
                              <NavLink to={item.route} end={item.end} className="relative">
                                <item.icon
                                  className={cn(
                                    'h-[15px] w-[15px] shrink-0 transition-colors duration-150',
                                    isActive
                                      ? 'text-sidebar-primary'
                                      : 'text-sidebar-foreground/45',
                                  )}
                                />
                                {item.badge && (
                                  <NavItemBadge kind={item.badge} variant="dot" className="absolute top-1 right-1" />
                                )}
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
                            to={item.route}
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
                            {item.badge && <NavItemBadge kind={item.badge} className="ml-auto" />}
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
