import { Bell, Search } from 'lucide-react';
import { useTopBarState } from './useTopBarState';
import { AlertPanel } from './AlertPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { useNavigate, NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SyncIndicator } from '@/components/SyncIndicator';
import { Logomark } from '@/components/icons/Logomark';
import { ThemeSelector } from '@/components/ThemeSelector';
import { OperatorSwitcher } from '@/components/OperatorSwitcher';

export function TopBar({ onOpenSearch }: { onOpenSearch?: () => void } = {}) {
  const {
    isMobile,
    sidebarCollapsed,
    selectedPlantId,
    setSelectedPlantId,
    visiblePlants,
    needsAssignment,
    unreadCount,
    panelOpen,
    setPanelOpen,
    totalBadge,
    hasCritical,
    isRinging,
    plantAlerts,
  } = useTopBarState();

  return (
    <header className="sticky top-0 z-40 bg-topbar text-topbar-foreground border-b border-white/8 shadow-sm">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 px-3 sm:px-4 h-12">

        <div className="flex items-center min-w-0">
          {isMobile ? (
            <NavLink to="/" className="flex items-center gap-2 shrink-0 group" aria-label="PWRI Monitoring & Alert">
              <Logomark size={28} className="rounded-lg shrink-0 group-hover:scale-105 transition-transform duration-200" />
              <div className="flex flex-col leading-none">
                <span className="text-xs font-semibold tracking-tight text-topbar-foreground group-hover:text-primary transition-colors">
                  PWRI
                </span>
                <span className="text-3xs text-topbar-muted tracking-[0.1em] uppercase">
                  Monitoring & Alert
                </span>
              </div>
            </NavLink>
          ) : sidebarCollapsed ? (
            <NavLink
              to="/"
              className="flex flex-col leading-none shrink-0 group select-none animate-in fade-in slide-in-from-left-2 duration-200 ease-spring-out hover:opacity-90 active:scale-[0.98] transition-transform"
              aria-label="PWRI Monitoring & Alert"
            >
              <span className="text-xs font-bold tracking-tight text-topbar-foreground group-hover:text-primary transition-colors">
                PWRI
              </span>
              <span className="text-3xs text-topbar-muted tracking-[0.1em] uppercase">
                Monitoring & Alert
              </span>
            </NavLink>
          ) : null}
        </div>

        <div className="flex justify-center">
          {/* D5: a user with no plants gets a disabled picker that says so,
              not an "All plants" that silently means everything. */}
          <Select
            value={needsAssignment ? '' : (selectedPlantId ?? 'all')}
            onValueChange={(v) => setSelectedPlantId(v === 'all' ? null : v)}
            disabled={needsAssignment}
          >
            <SelectTrigger
              className={cn(
                'w-[140px] sm:w-[210px] h-8',
                'bg-white/10 border-white/15 text-topbar-foreground',
                'hover:bg-white/15 focus:ring-white/30 focus:ring-1',
                'text-xs font-medium placeholder:text-topbar-muted',
                '[&>span]:text-topbar-foreground [&>svg]:text-topbar-muted',
              )}
            >
              <SelectValue placeholder={needsAssignment ? 'No plants assigned' : 'Select plant'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plants</SelectItem>
              {visiblePlants.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-end gap-2 sm:gap-3 min-w-0">

          <SyncIndicator />
          <ThemeSelector />

          {/* P5-10: opens the Ctrl+K palette. Rendered only when the shell
              wires the handler, so a TopBar used on its own (tests) has no
              dead button. */}
          {onOpenSearch && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search pages, plants, and wells (Ctrl+K)"
              title="Search pages, plants, and wells (Ctrl+K)"
              onClick={onOpenSearch}
              className="relative h-10 w-10 text-topbar-foreground hover:bg-white/10 focus-visible:ring-white/30"
            >
              <Search className="h-[17px] w-[17px]" />
            </Button>
          )}

          {isMobile ? (
            <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={totalBadge > 0 ? `Notifications (${totalBadge} unread)` : 'Notifications'}
                  className={cn(
                    'relative h-10 w-10 min-h-[44px] min-w-[44px]',
                    'hover:bg-white/10 focus-visible:ring-white/30',
                    hasCritical
                      ? 'text-danger'
                      : plantAlerts.length > 0
                        ? 'text-warn'
                        : 'text-topbar-foreground hover:text-topbar-foreground',
                  )}
                >
                  <Bell
                    className={cn(
                      'h-[18px] w-[18px] transition-colors',
                      isRinging && 'animate-bell-ring-once',
                    )}
                  />
                  {totalBadge > 0 && (
                    <span
                      className={cn(
                        'absolute 0.5 top-0.5 right-0.5 min-w-[17px] h-[17px] px-[3px]',
                        'flex items-center justify-center rounded-full',
                        'text-3xs font-mono-num font-bold text-white leading-none',
                        'ring-2 ring-topbar',
                        hasCritical ? 'bg-danger' : plantAlerts.length > 0 ? 'bg-warn' : 'bg-danger',
                      )}
                      aria-label={`${totalBadge} alerts`}
                    >
                      {totalBadge > 99 ? '99+' : totalBadge}
                    </span>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="p-0 rounded-t-2xl max-h-[88vh] overflow-hidden border-t border-border/80">
                <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full mx-auto my-2" />
                <AlertPanel />
              </SheetContent>
            </Sheet>
          ) : (
            <DropdownMenu open={panelOpen} onOpenChange={setPanelOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={totalBadge > 0 ? `Notifications (${totalBadge} unread)` : 'Notifications'}
                  className={cn(
                    'relative h-10 w-10',
                    'hover:bg-white/10 focus-visible:ring-white/30',
                    hasCritical
                      ? 'text-danger'
                      : plantAlerts.length > 0
                        ? 'text-warn'
                        : 'text-topbar-foreground hover:text-topbar-foreground',
                  )}
                >
                  <Bell
                    className={cn(
                      'h-[17px] w-[17px] transition-colors',
                      isRinging && 'animate-bell-ring-once',
                    )}
                  />
                  {totalBadge > 0 && (
                    <span
                      className={cn(
                        'absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-[3px]',
                        'flex items-center justify-center rounded-full',
                        'text-3xs font-mono-num font-bold text-white leading-none',
                        'ring-2 ring-topbar',
                        hasCritical ? 'bg-danger' : plantAlerts.length > 0 ? 'bg-warn' : 'bg-danger',
                      )}
                      aria-label={`${totalBadge} alerts`}
                    >
                      {totalBadge > 99 ? '99+' : totalBadge}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-[380px] sm:w-[440px] p-0 rounded-2xl shadow-xl border border-border/80 bg-popover/95 backdrop-blur-md overflow-hidden flex flex-col max-h-[82vh]">
                <AlertPanel />
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <OperatorSwitcher />
        </div>
      </div>
    </header>
  );
}
