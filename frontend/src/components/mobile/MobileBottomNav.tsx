import React, { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
  Menu, 
  Palette, 
  RefreshCw, 
  LayoutDashboard, 
  Droplet, 
  Bell, 
  ClipboardCheck, 
  User, 
  Building2,
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  Award
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavItemBadge } from '@/components/NavItemBadge';
import { useNavGroups } from '@/hooks/useNavGroups';
import { isNavItemActive, type NavItem } from '@/navConfig';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/usePermission';
import { ThemeSelector } from '@/components/ThemeSelector';
import { SyncIndicator } from '@/components/SyncIndicator';
import { MobileActionFab } from './MobileActionFab';
import {
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface MobileNavItemConfig {
  id: string;
  label: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  badge?: 'alerts' | 'approvals' | 'review';
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, roles, isAdmin, isManager } = useAuth();
  const can = useCan();
  const groups = useNavGroups();

  const isOperatorOnly = !isAdmin && !isManager && roles.includes('Operator');

  // Role-tailored 4-tab bar structure around the center FAB
  const primaryTabs: MobileNavItemConfig[] = useMemo(() => {
    if (isOperatorOnly) {
      // Operator view: [Readings] [Alerts] [FAB: Log] [Plant/Status] [More]
      return [
        {
          id: 'operations',
          label: 'Today',
          route: '/operations',
          icon: Droplet,
        },
        {
          id: 'alerts',
          label: 'Alerts',
          route: '/alerts',
          icon: Bell,
          badge: 'alerts',
        },
      ];
    } else {
      // Manager / Admin / Analyst view: [Home] [Review] [FAB: Log] [Alerts] [More]
      return [
        {
          id: 'dashboard',
          label: 'Home',
          route: '/',
          icon: LayoutDashboard,
          end: true,
        },
        {
          id: 'data-corrections',
          label: 'Review',
          route: '/data-corrections',
          icon: ClipboardCheck,
          badge: 'review',
        },
      ];
    }
  }, [isOperatorOnly]);

  const secondaryTabs: MobileNavItemConfig[] = useMemo(() => {
    if (isOperatorOnly) {
      return [
        {
          id: 'dashboard',
          label: 'Status',
          route: '/',
          icon: LayoutDashboard,
          end: true,
        },
      ];
    } else {
      return [
        {
          id: 'alerts',
          label: 'Alerts',
          route: '/alerts',
          icon: Bell,
          badge: 'alerts',
        },
      ];
    }
  }, [isOperatorOnly]);

  // Find any badge across all items (e.g. pending approvals, corrections, alerts)
  const allNavItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const hasMoreBadge = useMemo(() => {
    return allNavItems.some((i) => {
      // If it's already one of the visible 4 bottom tabs, don't count it for "More" badge
      const isVisibleTab = primaryTabs.some((t) => t.id === i.id) || secondaryTabs.some((t) => t.id === i.id);
      return !isVisibleTab && i.badge != null;
    });
  }, [allNavItems, primaryTabs, secondaryTabs]);

  const renderTabButton = (tab: MobileNavItemConfig) => {
    const active = tab.end ? pathname === tab.route : (pathname === tab.route || (tab.route !== '/' && pathname.startsWith(`${tab.route}/`)));
    const Icon = tab.icon;

    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => navigate(tab.route)}
        aria-label={tab.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-col items-center justify-center gap-1 py-1.5 px-1 min-h-[48px] transition-colors focus:outline-none',
          active
            ? 'text-primary font-semibold'
            : 'text-muted-foreground/80 hover:text-foreground font-medium'
        )}
      >
        <span className="relative flex items-center justify-center">
          <Icon
            className={cn(
              'transition-all duration-200',
              active ? 'h-[22px] w-[22px] scale-110 drop-shadow-xs' : 'h-[20px] w-[20px]'
            )}
          />
          {tab.badge && (
            <NavItemBadge
              kind={tab.badge}
              className="absolute -top-1.5 -right-2.5 ring-2 ring-card"
            />
          )}
        </span>
        <span className="text-3xs tracking-tight leading-none truncate max-w-[56px]">
          {tab.label}
        </span>
      </button>
    );
  };

  const userInitials = useMemo(() => {
    if (!profile) return 'U';
    const first = profile.first_name?.[0] ?? '';
    const last = profile.last_name?.[0] ?? '';
    return (first + last).toUpperCase() || 'U';
  }, [profile]);

  return (
    <nav
      aria-label="Mobile Navigation"
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/80 shadow-[0_-4px_16px_hsl(210_30%_12%/0.08)]',
        'pb-[env(safe-area-inset-bottom)]'
      )}
    >
      <div className="grid grid-cols-5 items-center max-w-md mx-auto px-1 h-14">
        {/* Tab 1 */}
        {renderTabButton(primaryTabs[0])}

        {/* Tab 2 */}
        {renderTabButton(primaryTabs[1])}

        {/* Center Elevating FAB */}
        <div className="flex items-center justify-center">
          <MobileActionFab />
        </div>

        {/* Tab 3 */}
        {renderTabButton(secondaryTabs[0])}

        {/* Tab 4: More / Menu Sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-1.5 px-1 min-h-[48px] text-muted-foreground/80 hover:text-foreground font-medium focus:outline-none transition-colors'
              )}
              aria-label="More Options Menu"
            >
              <span className="relative flex items-center justify-center">
                <Menu className="h-[20px] w-[20px]" />
                {hasMoreBadge && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-warn ring-2 ring-card animate-pulse" />
                )}
              </span>
              <span className="text-3xs tracking-tight leading-none">More</span>
            </button>
          </SheetTrigger>

          <SheetContent side="right" className="w-[85vw] max-w-sm flex flex-col p-0">
            {/* Sheet Header: User Profile Summary */}
            <div className="p-4 bg-muted/30 border-b border-border/60">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11 border-2 border-primary/20">
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">
                    {[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.username || 'User Profile'}
                  </div>
                  <div className="text-2xs text-muted-foreground truncate">
                    {roles.join(', ') || profile?.designation || 'Staff'}
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable Navigation Groups */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {groups.map((group) => (
                <div key={group.label} className="space-y-1">
                  <div className="text-3xs font-bold uppercase tracking-wider text-muted-foreground/80 px-2.5 py-1">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.id}
                        to={item.route}
                        className={({ isActive }) => cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-foreground/85 hover:bg-muted active:bg-muted/80'
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && <NavItemBadge kind={item.badge} className="ml-auto" />}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 ml-1" />
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}

              {/* Preferences & Offline Sync Controls */}
              <div className="pt-2 border-t border-border/60 space-y-2">
                <div className="text-3xs font-bold uppercase tracking-wider text-muted-foreground/80 px-2.5">
                  Device &amp; Preferences
                </div>
                <div className="space-y-1.5 px-1">
                  <ThemeSelector
                    align="end"
                    trigger={
                      <button className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs bg-muted/40 hover:bg-muted text-foreground transition-colors cursor-pointer text-left">
                        <span className="flex items-center gap-2.5">
                          <Palette className="h-4 w-4 text-primary shrink-0" />
                          <span>Theme &amp; Appearance</span>
                        </span>
                        <span className="text-3xs text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-card border border-border/60">
                          Change
                        </span>
                      </button>
                    }
                  />
                  <SyncIndicator
                    trigger={
                      <button className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-xs bg-muted/40 hover:bg-muted text-foreground transition-colors cursor-pointer text-left">
                        <span className="flex items-center gap-2.5">
                          <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span>Offline Sync Queue</span>
                        </span>
                        <span className="text-3xs text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-card border border-border/60">
                          Details
                        </span>
                      </button>
                    }
                  />
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

