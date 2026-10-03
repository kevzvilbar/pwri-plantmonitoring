import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Gauge,
  History,
  Pencil,
  Plus,
  AlertTriangle,
  AlertCircle,
  Clock,
  Layers,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import { computeSurveyDelta, type SurveyDelta, type PmsSurveyRecord } from '@/features/wells/lib/hydraulics';

export function WellHydraulicDataCard({
  pms,
  latest,
  previous,
  statusBadge,
  missingCoreFields,
  isSurveyDue,
  daysSinceSurvey,
  drillingDepth,
  drawdown,
  operatingPressure,
  operatingPressureDate,
  dailyTds,
  dailyTdsDate,
  isManager,
  onOpenHistory,
  onEditSurvey,
  onLogNewSurvey,
}: {
  pms?: PmsSurveyRecord[] | null;
  latest?: PmsSurveyRecord | null;
  previous?: PmsSurveyRecord | null;
  statusBadge: ReactNode;
  missingCoreFields: { key?: string; label: string; value?: unknown }[];
  isSurveyDue: boolean;
  daysSinceSurvey: number | null;
  drillingDepth?: number | string | null;
  drawdown: number | null;
  operatingPressure?: number | null;
  operatingPressureDate?: string | null;
  dailyTds?: number | null;
  dailyTdsDate?: string | null;
  isManager: boolean;
  onOpenHistory: () => void;
  onEditSurvey: (record: PmsSurveyRecord) => void;
  onLogNewSurvey: () => void;
}) {
  const delta: SurveyDelta = computeSurveyDelta(latest, previous);

  const renderDelta = (val: number | null, unit = '') => {
    if (val == null) return null;
    if (val === 0) {
      return (
        <span className="inline-flex items-center text-3xs text-muted-foreground ml-1">
          <Minus className="h-2.5 w-2.5 mr-0.5" /> 0{unit}
        </span>
      );
    }
    const isPositive = val > 0;
    return (
      <span
        className={`inline-flex items-center text-3xs font-medium ml-1 ${
          isPositive ? 'text-amber-500' : 'text-emerald-500'
        }`}
      >
        {isPositive ? <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" /> : <ArrowDownRight className="h-2.5 w-2.5 mr-0.5" />}
        {isPositive ? `+${val}` : `${val}`}{unit}
      </span>
    );
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-info" /> Hydraulic Data
          </span>
          {statusBadge}
        </div>
        <div className="flex items-center gap-1.5">
          {pms && pms.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={onOpenHistory}
            >
              <History className="h-3.5 w-3.5" /> History ({pms.length})
            </Button>
          )}
          {isManager && (
            <>
              {latest ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => onEditSurvey(latest)}
                  >
                    <Pencil className="h-3 w-3" /> Edit Survey
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={onLogNewSurvey}
                  >
                    <Plus className="h-3 w-3" /> Log New
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={onLogNewSurvey}
                >
                  <Plus className="h-3 w-3" /> Log Survey
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Notifications & Incomplete Callout */}
      {!latest ? (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-destructive/10 text-destructive border border-destructive/20 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="flex-1">No hydraulic survey has been logged yet for this well.</div>
          {isManager && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={onLogNewSurvey}>
              Log First Survey
            </Button>
          )}
        </div>
      ) : missingCoreFields.length > 0 ? (
        <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Incomplete survey data. Missing: <strong>{missingCoreFields.map(f => f.label).join(', ')}</strong>.
          </span>
          {isManager && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => onEditSurvey(latest)}>
              Complete Data
            </Button>
          )}
        </div>
      ) : isSurveyDue ? (
        <div className="flex items-center gap-2 p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 text-xs">
          <Clock className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Last survey was recorded <strong>{daysSinceSurvey} days ago</strong> ({latest.date_gathered}). Recommended update interval is quarterly (90 days).
          </span>
          {isManager && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={onLogNewSurvey}>
              Log New Survey
            </Button>
          )}
        </div>
      ) : null}

      {/* Previous Survey Delta Highlight (if previous survey exists) */}
      {previous && latest && (
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border border-border/60 text-2xs text-muted-foreground flex-wrap gap-2">
          <span className="font-medium text-foreground">
            Trend vs previous survey ({previous.date_gathered}):
          </span>
          <div className="flex items-center gap-3">
            <span>SWL: {latest.static_water_level_m ?? '—'}m {renderDelta(delta.swlDelta, 'm')}</span>
            <span>PWL: {latest.pumping_water_level_m ?? '—'}m {renderDelta(delta.pwlDelta, 'm')}</span>
            <span>Drawdown: {drawdown != null ? `${drawdown}m` : '—'} {renderDelta(delta.drawdownDelta, 'm')}</span>
          </div>
        </div>
      )}

      {/* 3 Metric Clusters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Cluster 1: Borehole & Levels */}
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-foreground">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-info" /> Borehole & Water Levels
            </span>
            <span className="text-3xs text-muted-foreground uppercase tracking-wider font-normal">
              {latest?.date_gathered ? `Survey · ${latest.date_gathered}` : 'Survey'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Drilling Depth</div>
              <div className="font-mono-num font-medium">{drillingDepth ? `${drillingDepth} m` : '—'}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Static Level (SWL)</div>
              <div className="font-mono-num font-medium">
                {latest?.static_water_level_m != null ? `${latest.static_water_level_m} m` : '—'}
                {renderDelta(delta.swlDelta, 'm')}
              </div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pumping Level (PWL)</div>
              <div className="font-mono-num font-medium">
                {latest?.pumping_water_level_m != null ? `${latest.pumping_water_level_m} m` : '—'}
                {renderDelta(delta.pwlDelta, 'm')}
              </div>
            </div>
            <div className="rounded bg-info/10 p-1.5 -m-0.5 border border-info/20">
              <div className="text-2xs uppercase tracking-wide text-info font-medium flex items-center justify-between">
                <span>Drawdown</span>
                <span className="text-3xs lowercase font-normal opacity-80">(PWL − SWL)</span>
              </div>
              <div className="font-mono-num font-bold text-info text-sm flex items-baseline justify-between">
                <span>{drawdown != null ? `${drawdown} m` : '—'}</span>
                {renderDelta(delta.drawdownDelta, 'm')}
              </div>
            </div>
          </div>
        </div>

        {/* Cluster 2: Pumping Equipment */}
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Gauge className="h-3.5 w-3.5 text-accent" /> Pumping Equipment
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pump Setting</div>
              <div className="font-mono-num font-medium">{latest?.pump_setting ?? '—'}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Motor Rating</div>
              <div className="font-mono-num font-medium">{latest?.motor_hp != null ? `${latest.motor_hp} HP` : '—'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Operating Pressure</div>
              <div className="font-mono-num font-medium flex items-baseline gap-1.5">
                <span>{operatingPressure != null ? `${operatingPressure} psi` : '—'}</span>
                {operatingPressure != null && (
                  <span className="text-2xs text-muted-foreground font-normal">
                    ({operatingPressureDate ? `Live · ${operatingPressureDate.slice(0, 10)}` : 'Live Telemetry'})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cluster 3: Water Quality & Telemetry */}
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Activity className="h-3.5 w-3.5 text-warn" /> Water Quality & Telemetry
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (PMS Survey)</div>
              <div className="font-mono-num font-medium">
                {latest?.tds_ppm != null ? `${latest.tds_ppm} ppm` : '—'}
                {renderDelta(delta.tdsDelta, 'ppm')}
              </div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (Daily Sensor)</div>
              <div className="font-mono-num font-medium flex items-baseline gap-1">
                <span>{dailyTds != null ? `${dailyTds} ppm` : '—'}</span>
                {dailyTdsDate && <span className="text-3xs text-muted-foreground">({dailyTdsDate.slice(0, 10)})</span>}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Turbidity</div>
              <div className="font-mono-num font-medium">{latest?.turbidity_ntu != null ? `${latest.turbidity_ntu} NTU` : '—'}</div>
            </div>
          </div>
        </div>
      </div>

      {latest?.date_gathered && (
        <div className="flex items-center justify-between pt-1 text-2xs text-muted-foreground flex-wrap gap-2 border-t">
          <span>Last survey recorded: <strong className="text-foreground">{latest.date_gathered}</strong></span>
          {latest.remarks && <span className="italic">Remarks: {latest.remarks}</span>}
        </div>
      )}
    </Card>
  );
}
