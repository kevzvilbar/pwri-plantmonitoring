import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NavItemBadge } from '@/components/NavItemBadge';
import { useNavGroups } from '@/hooks/useNavGroups';
import { isNavItemActive, type NavItem } from '@/navConfig';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';

export function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const groups = useNavGroups();

  // Same groups as the desktop sidebar (navConfig.ts). Items with a
  // `priority` get a slot in the bar, left to right: Readings · RO Trains ·
  // Dashboard · Alerts · More. Everything else, Plants included, is in More.
  const barItems = useMemo(
    () => groups
      .flatMap((g) => g.items)
      .filter((i) => i.priority != null)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [groups],
  );
  const sheetGroups = useMemo(
    () => groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.priority == null) }))
      .filter((g) => g.items.length > 0),
    [groups],
  );

  const renderBarItem = (item: NavItem) => {
    const active = isNavItemActive(item, pathname);
    return (
      <button
        key={item.id}
        onClick={() => navigate(item.route)}
        // The bar shows `mobileLabel`; give assistive tech the full name.
        // Not set otherwise, so a badge's count stays part of the name.
        aria-label={item.mobileLabel ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-col items-center justify-center gap-0.5 py-2 px-1 transition-all',
          active
            ? 'text-primary text-xs font-semibold'
            : 'text-muted-foreground/70 text-xs font-medium hover:text-foreground',
        )}
      >
        <span className="relative">
          <item.icon
            className={cn(
              'transition-all',
              active ? 'h-[22px] w-[22px] drop-shadow-sm' : 'h-[18px] w-[18px]',
            )}
          />
          {item.badge && (
            <NavItemBadge kind={item.badge} className="absolute -top-1.5 -right-2.5 ring-2 ring-card" />
          )}
        </span>
        <span className="leading-none">{item.mobileLabel ?? item.label}</span>
      </button>
    );
  };

  // Centered, prominent Dashboard button
  const renderHero = (item: NavItem) => (
    <NavLink
      key={item.id}
      to={item.route}
      end={item.end}
      className={({ isActive }) => cn(
        // px-0.5 not px-1 (unlike the other columns), and text-2xs not the
        // text-xs the bar labels use: this is the widest label in the bar and
        // the column has the least slack. At 320px the budget is ~56px;
        // "Dashboard" at 12px/semibold is ~63px before any padding, so it
        // overflows at text-xs. text-2xs (10px) clears the budget with px-0.5
        // and is still a real step up from the 9px text-3xs this used to be.
        // There is no 11px token in tailwind.config.ts's compact scale, and
        // check-arbitrary-font-sizes.mjs keeps one-off text-[Npx] values out.
        // Verified against Inter's actual metrics, not estimated — see
        // BottomNav in the mobile UX audit.
        'flex flex-col items-center justify-center gap-0.5 py-1 px-0.5 text-2xs font-semibold transition-colors -mt-3',
        isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn(
            'flex items-center justify-center h-12 w-12 rounded-full shadow-elev border-2 border-card transition-all',
            isActive ? 'bg-primary text-primary-foreground' : 'bg-accent/90 text-accent-foreground',
          )}>
            <item.icon className="h-5 w-5" />
          </span>
          <span className="leading-none mt-0.5 text-foreground">{item.label}</span>
        </>
      )}
    </NavLink>
  );

  // A badge on an item that only lives in the More sheet (Admin Console's
  // pending approvals) would be invisible while the sheet is closed: More
  // carries a dot for it.
  const moreBadge = sheetGroups.flatMap((g) => g.items).find((i) => i.badge)?.badge;

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
      {/* One column per bar item, plus More. Five for every role today; fewer
          if a custom role hides a bar item. */}
      <div
        className="grid max-w-3xl mx-auto items-end"
        style={{ gridTemplateColumns: `repeat(${barItems.length + 1}, minmax(0, 1fr))` }}
      >
        {barItems.map((item) => (item.id === 'dashboard' ? renderHero(item) : renderBarItem(item)))}

        {/* Side sheet: everything without a bar slot */}
        <Sheet>
          <SheetTrigger asChild>
            <button className="flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <span className="relative">
                <Menu className="h-[18px] w-[18px]" />
                {moreBadge && (
                  <NavItemBadge kind={moreBadge} variant="dot" className="absolute -top-1 -right-1.5 ring-card" />
                )}
              </span>
              <span className="leading-none">More</span>
            </button>
          </SheetTrigger>
          {/* P5-11: the sheet is a fixed, full-height panel, so it has to be a
              flex column for the list below to scroll. With auto height the
              div grew past the viewport bottom, and every item below the fold
              — Plants, Admin Console — was clipped with no way to reach it. */}
          <SheetContent side="right" className="w-72 flex flex-col">
            <SheetHeader><SheetTitle>More</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              {sheetGroups.map((group) => (
                <div key={group.label}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 mb-1">{group.label}</div>
                  <div className="flex flex-col gap-1">
                    {group.items.map((r) => (
                      <NavLink
                        key={r.id}
                        to={r.route}
                        className={({ isActive }) => cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                          isActive ? 'bg-primary-soft text-primary font-medium shadow-[inset_2.5px_0_0_hsl(var(--primary))]' : 'hover:bg-muted text-foreground/75',
                        )}
                      >
                        <r.icon className="h-4 w-4" />
                        {r.label}
                        {r.badge && <NavItemBadge kind={r.badge} className="ml-auto" />}
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
