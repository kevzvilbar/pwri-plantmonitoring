import { useState, useEffect } from 'react';
import {
  Droplet,
  FlaskConical,
  Zap,
  ShieldCheck,
  Activity,
  ClipboardList,
  LayoutGrid,
  ListCollapse,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { DashboardViewMode, RangeKey } from '@/components/dashboard/types';
import { RangeAndMonthlyPicker } from './RangeAndMonthlyPicker';

export interface DashboardSection {
  id: string;
  label: string;
  shortLabel: string;
  icon: typeof Droplet;
  accent: string;
}

export const DASHBOARD_SECTIONS: DashboardSection[] = [
  { id: 'action-center', label: 'Action Center', shortLabel: 'Action', icon: ClipboardList, accent: 'text-warn' },
  { id: 'overview-cluster', label: 'Overview', shortLabel: 'Overview', icon: Droplet, accent: 'text-primary' },
  { id: 'quality-cluster', label: 'Quality', shortLabel: 'Quality', icon: FlaskConical, accent: 'text-accent' },
  { id: 'cost-cluster', label: 'Production Cost', shortLabel: 'Cost', icon: Zap, accent: 'text-chart-6' },
  { id: 'health-cluster', label: 'Health & Coverage', shortLabel: 'Health', icon: Activity, accent: 'text-info' },
  { id: 'audits-cluster', label: 'Data Trust', shortLabel: 'Trust', icon: ShieldCheck, accent: 'text-highlight' },
];

export interface DashboardSectionNavProps {
  viewMode?: DashboardViewMode;
  onViewModeChange?: (mode: DashboardViewMode) => void;
  // Optional unified range controls (Phase 3): when provided the range picker
  // renders in a second row of the same sticky bar, replacing the standalone
  // range card in Dashboard.tsx. Test-ids stay `dash-range-*` / `dash-monthly-*`.
  range?: RangeKey;
  onRangeChange?: (r: RangeKey) => void;
  chartFrom?: string;
  chartTo?: string;
  onCustomDatesChange?: (from: string, to: string) => void;
  chartYear?: number;
  chartMonth?: string;
  onMonthlyPeriodChange?: (year: number, month: string) => void;
}

// Single source of truth for scroll offset: sticky bar (≈2 rows when the
// range picker is merged) + app header. Sections use `scroll-mt-28` as the
// CSS fallback; this JS offset matches for smooth-scroll clicks.
export const DASHBOARD_NAV_OFFSET = 150;

export function DashboardSectionNav({
  viewMode,
  onViewModeChange,
  range,
  onRangeChange,
  chartFrom,
  chartTo,
  onCustomDatesChange,
  chartYear,
  chartMonth,
  onMonthlyPeriodChange,
}: DashboardSectionNavProps = {}) {
  const [activeSection, setActiveSection] = useState<string>('action-center');

  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = DASHBOARD_SECTIONS.map((sec) => ({
        id: sec.id,
        el: document.getElementById(sec.id),
      })).filter((s) => s.el !== null);

      const scrollPosition = window.scrollY + DASHBOARD_NAV_OFFSET + 30;

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const item = sectionElements[i];
        if (item.el && item.el.offsetTop <= scrollPosition) {
          setActiveSection(item.id);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerOffset = DASHBOARD_NAV_OFFSET;
    const elementPosition = el.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
    setActiveSection(id);
  };

  const showRangeRow = range !== undefined && onRangeChange !== undefined;

  return (
    <div className="sticky top-14 z-20 -mx-1 px-2 py-1.5 bg-background/85 backdrop-blur-md border-y border-border/40 transition-all shadow-xs space-y-1.5" data-testid="dashboard-control-bar">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth min-w-0 flex-1">
          {DASHBOARD_SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <div key={sec.id} className="relative flex flex-col items-center shrink-0">
                <button
                  type="button"
                  onClick={() => scrollToSection(sec.id)}
                  className={cn(
                    'flex items-center gap-1.5 h-7.5 px-3 rounded-full text-xs font-semibold transition-all duration-150 ease-spring-out active:scale-[0.98] cursor-pointer select-none',
                    isActive
                      ? 'bg-highlight text-highlight-foreground shadow-xs font-bold'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-highlight-foreground' : sec.accent)} />
                  <span className="hidden sm:inline">{sec.label}</span>
                  <span className="sm:hidden">{sec.shortLabel}</span>
                </button>
                {isActive && (
                  <span className="absolute -bottom-1 w-6 h-[2px] rounded-full bg-highlight transition-all animate-fade-in" />
                )}
              </div>
            );
          })}
        </div>

        {viewMode && onViewModeChange && (
          <div className="flex items-center shrink-0 pl-2 border-l border-border/40">
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && onViewModeChange(v as DashboardViewMode)}
              className="h-7.5 bg-muted/50 border border-border/50 rounded-full p-0.5 gap-0.5"
              data-testid="floating-dashboard-view-mode dashboard-view-mode"
            >
              <ToggleGroupItem
                value="inline"
                className="h-6.5 px-2.5 rounded-full text-2xs gap-1 text-muted-foreground hover:text-foreground data-[state=on]:bg-highlight data-[state=on]:text-highlight-foreground data-[state=on]:font-bold data-[state=on]:shadow-xs transition-all cursor-pointer"
                title="Inline — all trend graphs visible directly on the dashboard"
                aria-label="Inline view"
              >
                <LayoutGrid className="h-3 w-3 shrink-0" aria-hidden />
                <span className="hidden md:inline font-medium">Inline</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="sections"
                className="h-6.5 px-2.5 rounded-full text-2xs gap-1 text-muted-foreground hover:text-foreground data-[state=on]:bg-highlight data-[state=on]:text-highlight-foreground data-[state=on]:font-bold data-[state=on]:shadow-xs transition-all cursor-pointer"
                title="Sections — click any KPI card to fold/unfold its trend chart inline"
                aria-label="Sections view"
              >
                <ListCollapse className="h-3 w-3 shrink-0" aria-hidden />
                <span className="hidden md:inline font-medium">Sections</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="popup"
                className="h-6.5 px-2.5 rounded-full text-2xs gap-1 text-muted-foreground hover:text-foreground data-[state=on]:bg-highlight data-[state=on]:text-highlight-foreground data-[state=on]:font-bold data-[state=on]:shadow-xs transition-all cursor-pointer"
                title="Dialog — click a KPI card to open its trend chart in a dialog"
                aria-label="Dialog view"
              >
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                <span className="hidden md:inline font-medium">Dialog</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
      </div>

      {showRangeRow && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <RangeAndMonthlyPicker
            range={range!}
            onRangeChange={onRangeChange!}
            from={chartFrom}
            to={chartTo}
            onCustomDatesChange={onCustomDatesChange}
            chartYear={chartYear}
            chartMonth={chartMonth}
            onMonthlyPeriodChange={onMonthlyPeriodChange}
            testIdPrefix="dash-range"
            monthlyTestIdPrefix="dash-monthly"
            className="[&_button]:h-7 [&_button]:text-2xs"
          />
          <div className="text-3xs font-mono text-muted-foreground shrink-0 px-1 hidden sm:block" data-testid="dash-range-label">
            {range === 'MONTHLY'
              ? chartMonth === 'YTD'
                ? `Full Year ${chartYear}`
                : `${chartYear}-${chartMonth}`
              : `${chartFrom} → ${chartTo}`}
          </div>
        </div>
      )}
    </div>
  );
}

