import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Info, BellOff, X, Clock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAppStore, type PlantAlert } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

// ── Severity helpers ──────────────────────────────────────────────────────────
const SEV_ICON = {
  critical: AlertTriangle,
  warning:  AlertTriangle,
  info:     Info,
} as const;

const SEV_ROW_CLS = {
  critical: 'border-l-2 border-l-danger bg-danger-soft dark:bg-danger/8',
  warning:  'border-l-2 border-l-warn  bg-warn-soft  dark:bg-warn/8',
  info:     'border-l-2 border-l-info  bg-muted/30',
} as const;

const SEV_ICON_CLS = {
  critical: 'text-danger',
  warning:  'text-warn',
  info:     'text-info',
} as const;

const SEV_TITLE_CLS = {
  critical: 'text-danger',
  warning:  'text-warn-foreground',
  info:     'text-muted-foreground',
} as const;

// Shown at most 5 alerts before the "View all" link.
const MAX_VISIBLE = 5;

interface Props {
  /** Plant IDs in scope — used to filter when all-plants is selected */
  plantIds: string[];
}

export function AlertFeedCard({ plantIds }: Props) {
  const navigate = useNavigate();
  const { plantAlerts, removeAlerts, snoozeAlert, clearAlerts } = useAppStore();
  const { data: plants } = usePlants();

  const plantNameById = useMemo(() => {
    const m = new Map<string, string>();
    (plants ?? []).forEach((p) => m.set(p.id, (p as any).code ?? p.name));
    return m;
  }, [plants]);

  // Sort critical → warning → info, then by most-recent
  const sorted: PlantAlert[] = useMemo(
    () =>
      [...plantAlerts]
        .filter((a) => !plantIds.length || plantIds.includes(a.plantId))
        .sort((a, b) => {
          const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
          return (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || b.timestamp - a.timestamp;
        }),
    [plantAlerts, plantIds],
  );

  if (!sorted.length) return null;

  const visible   = sorted.slice(0, MAX_VISIBLE);
  const overflow  = sorted.length - MAX_VISIBLE;
  const critCount = sorted.filter((a) => a.severity === 'critical').length;
  const warnCount = sorted.filter((a) => a.severity === 'warning').length;
  const isMulti   = new Set(sorted.map((a) => a.plantId)).size > 1;

  return (
    <Card className="p-3 space-y-2">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Bell className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <span className="text-[12px] font-medium">Alert feed</span>

        {critCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-danger-soft text-danger text-[10px] font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            {critCount} critical
          </span>
        )}
        {warnCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-warn-soft text-warn-foreground text-[10px] font-semibold">
            {warnCount} warning{warnCount > 1 ? 's' : ''}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => sorted.forEach((a) => snoozeAlert(a.id, 60 * 60 * 1000))}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-warn transition-colors"
            title="Snooze all alerts for 1 hour"
          >
            <BellOff className="h-3 w-3" />
            <span className="hidden sm:inline">Snooze all</span>
          </button>
          <button
            onClick={clearAlerts}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Dismiss all
          </button>
        </div>
      </div>

      {/* ── Alert rows ── */}
      <div className="space-y-1.5">
        {visible.map((alert) => {
          const Icon      = SEV_ICON[alert.severity as keyof typeof SEV_ICON] ?? Info;
          const rowCls    = SEV_ROW_CLS[alert.severity as keyof typeof SEV_ROW_CLS] ?? SEV_ROW_CLS.info;
          const iconCls   = SEV_ICON_CLS[alert.severity as keyof typeof SEV_ICON_CLS] ?? '';
          const titleCls  = SEV_TITLE_CLS[alert.severity as keyof typeof SEV_TITLE_CLS] ?? '';
          const plantName = plantNameById.get(alert.plantId);

          return (
            <div
              key={alert.id}
              className={cn('flex items-start gap-2.5 px-2.5 py-2 rounded-r-md text-[11px]', rowCls)}
            >
              <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', iconCls)} aria-hidden />

              <div className="flex-1 min-w-0">
                <div className={cn('font-semibold leading-snug', titleCls)}>
                  {isMulti && plantName && (
                    <span className="mr-1 text-[10px] font-normal opacity-70">{plantName} ·</span>
                  )}
                  {alert.title}
                </div>
                <p className="text-muted-foreground/80 leading-snug mt-0.5">{alert.description}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/50">
                  <span>{alert.source}</span>
                  <span>·</span>
                  <span>{format(new Date(alert.timestamp), 'hh:mm aa')}</span>
                </div>
              </div>

              {/* Snooze / dismiss actions */}
              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                <button
                  onClick={() => snoozeAlert(alert.id, 60 * 60 * 1000)}
                  className="text-muted-foreground/40 hover:text-warn transition-colors"
                  aria-label="Snooze 1 hour"
                  title="Snooze 1 hour"
                >
                  <Clock className="h-3 w-3" />
                </button>
                <button
                  onClick={() => removeAlerts([alert.id])}
                  className="text-muted-foreground/40 hover:text-foreground transition-colors"
                  aria-label="Dismiss alert"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer: overflow link ── */}
      {overflow > 0 && (
        <div className="flex justify-end pt-0.5">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-[11px] text-muted-foreground"
            onClick={() => navigate('/incidents')}
          >
            +{overflow} more alert{overflow > 1 ? 's' : ''} — view all
          </Button>
        </div>
      )}
    </Card>
  );
}
