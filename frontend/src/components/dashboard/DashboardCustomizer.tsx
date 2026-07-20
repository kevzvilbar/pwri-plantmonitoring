import { useState, useEffect } from 'react';
import { Settings, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type DashboardWidget =
  | 'plantHealth'
  | 'overview'
  | 'quality'
  | 'cost'
  | 'health'
  | 'blending'
  | 'alerts';

interface DashboardCustomizerState {
  visibleWidgets: Set<DashboardWidget>;
  refreshRate: number; // milliseconds
  lastUpdated: Partial<Record<DashboardWidget, number>>;
}

const STORAGE_KEY = 'pwri:dashboard-customizer';
const DEFAULT_REFRESH_RATES = [30_000, 60_000, 120_000, 300_000]; // 30s, 1m, 2m, 5m
const ALL_WIDGETS: { id: DashboardWidget; label: string }[] = [
  { id: 'plantHealth', label: 'Plant Health Strip' },
  { id: 'overview', label: 'Overview' },
  { id: 'quality', label: 'Quality' },
  { id: 'cost', label: 'Production Cost' },
  { id: 'health', label: 'Plant Health Trend' },
  { id: 'blending', label: 'Blending Volume' },
  { id: 'alerts', label: 'Alert Feed' },
];

/**
 * Load customizer state from localStorage.
 */
function loadCustomizerState(): DashboardCustomizerState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        visibleWidgets: new Set(parsed.visibleWidgets || ALL_WIDGETS.map((w) => w.id)),
        refreshRate: parsed.refreshRate || 60_000,
        lastUpdated: parsed.lastUpdated || {},
      };
    }
  } catch (err) {
    // Silently fail — localStorage may not be available
  }
  return {
    visibleWidgets: new Set(ALL_WIDGETS.map((w) => w.id)),
    refreshRate: 60_000,
    lastUpdated: {},
  };
}

/**
 * Save customizer state to localStorage.
 */
function saveCustomizerState(state: DashboardCustomizerState) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        visibleWidgets: Array.from(state.visibleWidgets),
        refreshRate: state.refreshRate,
        lastUpdated: state.lastUpdated,
      }),
    );
  } catch (err) {
    // Silently fail — quota or privacy mode
  }
}

interface DashboardCustomizerProps {
  onStateChange?: (state: DashboardCustomizerState) => void;
}

/**
 * Settings dialog for customizing dashboard widget visibility and refresh rate.
 * Persists user preferences to localStorage.
 */
export function DashboardCustomizer({ onStateChange }: DashboardCustomizerProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DashboardCustomizerState>(() => loadCustomizerState());

  // Notify parent when state changes
  useEffect(() => {
    onStateChange?.(state);
    saveCustomizerState(state);
  }, [state, onStateChange]);

  const toggleWidget = (widgetId: DashboardWidget) => {
    setState((prev) => {
      const newVis = new Set(prev.visibleWidgets);
      if (newVis.has(widgetId)) {
        newVis.delete(widgetId);
      } else {
        newVis.add(widgetId);
      }
      return { ...prev, visibleWidgets: newVis };
    });
  };

  const setRefreshRate = (rate: number) => {
    setState((prev) => ({ ...prev, refreshRate: rate }));
  };

  const resetDefaults = () => {
    setState({
      visibleWidgets: new Set(ALL_WIDGETS.map((w) => w.id)),
      refreshRate: 60_000,
      lastUpdated: {},
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-2.5 gap-1.5 text-[11px]"
        onClick={() => setOpen(true)}
        title="Customize dashboard"
      >
        <Settings className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Settings</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Dashboard Settings</DialogTitle>
            <DialogDescription>
              Customize which widgets are visible and how often data refreshes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Widget Visibility Toggles */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Visible Widgets</h3>
              <div className="space-y-1">
                {ALL_WIDGETS.map((widget) => {
                  const isVisible = state.visibleWidgets.has(widget.id);
                  return (
                    <button
                      key={widget.id}
                      onClick={() => toggleWidget(widget.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                        'text-left hover:bg-muted/50',
                        isVisible ? 'bg-muted/40 text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {isVisible ? (
                        <Eye className="h-4 w-4 text-primary" aria-hidden />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground/50" aria-hidden />
                      )}
                      <span className="flex-1">{widget.label}</span>
                      <span
                        className={cn(
                          'h-5 w-5 rounded border-2 transition-all',
                          isVisible
                            ? 'bg-primary border-primary'
                            : 'border-muted-foreground/30 hover:border-muted-foreground/50',
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Refresh Rate Selector */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Data Refresh Rate</h3>
              <div className="grid grid-cols-2 gap-2">
                {DEFAULT_REFRESH_RATES.map((rate) => {
                  const label =
                    rate === 30_000
                      ? '30s'
                      : rate === 60_000
                        ? '1m'
                        : rate === 120_000
                          ? '2m'
                          : '5m';
                  return (
                    <button
                      key={rate}
                      onClick={() => setRefreshRate(rate)}
                      className={cn(
                        'px-3 py-2 rounded-md text-xs font-medium transition-all',
                        state.refreshRate === rate
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Faster refresh uses more bandwidth. Choose based on your needs.
              </p>
            </div>

            {/* Reset Button */}
            <button
              onClick={resetDefaults}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reset to Defaults
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Hook to use dashboard customizer state.
 */
export function useDashboardCustomizer() {
  const [state, setState] = useState<DashboardCustomizerState>(() => loadCustomizerState());

  useEffect(() => {
    saveCustomizerState(state);
  }, [state]);

  return {
    visibleWidgets: state.visibleWidgets,
    refreshRate: state.refreshRate,
    isWidgetVisible: (widgetId: DashboardWidget) => state.visibleWidgets.has(widgetId),
    setRefreshRate: (rate: number) =>
      setState((prev) => ({ ...prev, refreshRate: rate })),
  };
}
