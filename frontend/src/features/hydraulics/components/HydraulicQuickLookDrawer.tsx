import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Gauge,
  Layers,
  Activity,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  ExternalLink,
  Plus,
  Pencil,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import { type WellHydraulicSummary } from '@/features/wells/lib/hydraulics';
import { wellDetailPath } from '@/features/wells/lib/wellRoutes';

interface HydraulicQuickLookDrawerProps {
  summary: WellHydraulicSummary | null;
  isOpen: boolean;
  onClose: () => void;
  isManager: boolean;
  onEditSurvey?: (summary: WellHydraulicSummary) => void;
  onLogNewSurvey?: (summary: WellHydraulicSummary) => void;
}

export function HydraulicQuickLookDrawer({
  summary,
  isOpen,
  onClose,
  isManager,
  onEditSurvey,
  onLogNewSurvey,
}: HydraulicQuickLookDrawerProps) {
  const navigate = useNavigate();

  if (!summary) return null;

  const {
    wellId,
    wellName,
    plantId,
    plantName,
    drillingDepth,
    latestSurvey,
    previousSurvey,
    daysSinceSurvey,
    isSurveyDue,
    drawdown,
    swl,
    pwl,
    pumpSetting,
    motorHp,
    surveyTds,
    surveyTurbidity,
    surveyDate,
    missingCoreFields,
    status,
    statusMeta,
    delta,
    livePressure,
    livePressureDate,
    liveTds,
    liveTdsDate,
  } = summary;

  const handleNavigateDetail = () => {
    onClose();
    if (plantId && wellId) {
      navigate(wellDetailPath(plantId, wellId));
    }
  };

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
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-6 space-y-5">
        <SheetHeader className="space-y-2 pb-3 border-b">
          <div className="flex items-center justify-between gap-2 flex-wrap pr-6">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-info/10 text-info">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                  {wellName}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Plant: <strong className="text-foreground">{plantName}</strong>
                </SheetDescription>
              </div>
            </div>
            <Badge variant="outline" className={`text-2xs font-medium gap-1 px-2 py-0.5 ${statusMeta.badgeClass}`}>
              {status === 'no_survey' && <AlertTriangle className="h-3 w-3" />}
              {status === 'incomplete' && <AlertCircle className="h-3 w-3" />}
              {status === 'overdue' && <Clock className="h-3 w-3" />}
              {status === 'ok' && <CheckCircle2 className="h-3 w-3" />}
              {statusMeta.label}
            </Badge>
          </div>
        </SheetHeader>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            className="h-8 text-xs gap-1.5 flex-1"
            onClick={handleNavigateDetail}
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open Well Detail
          </Button>

          {isManager && (
            <>
              {latestSurvey ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      onClose();
                      onEditSurvey?.(summary);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Survey
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      onClose();
                      onLogNewSurvey?.(summary);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Log New
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => {
                    onClose();
                    onLogNewSurvey?.(summary);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Log Survey
                </Button>
              )}
            </>
          )}
        </div>

        {/* Alerts & Warnings */}
        {status === 'no_survey' && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" /> No Hydraulic Survey Recorded
            </div>
            <p className="text-2xs opacity-90">
              This well does not have any baseline hydraulic measurements logged yet.
            </p>
          </div>
        )}

        {status === 'incomplete' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" /> Incomplete Survey Data
            </div>
            <p className="text-2xs opacity-90">
              Missing fields: <strong>{missingCoreFields.map((f) => f.label).join(', ')}</strong>.
            </p>
          </div>
        )}

        {status === 'overdue' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Clock className="h-4 w-4 shrink-0" /> Quarterly Survey Due
            </div>
            <p className="text-2xs opacity-90">
              Last survey was conducted <strong>{daysSinceSurvey} days ago</strong> on {surveyDate}. Recommended frequency is every 90 days.
            </p>
          </div>
        )}

        {/* Previous Survey Delta Callout (if previous survey available) */}
        {previousSurvey && (
          <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground border-b pb-1.5">
              <span>Historical Trend vs Previous Survey</span>
              <span className="text-2xs text-muted-foreground font-normal">
                {previousSurvey.date_gathered} → {surveyDate}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-2xs text-muted-foreground block">SWL Delta</span>
                <span className="font-mono-num font-medium text-foreground">
                  {latestSurvey?.static_water_level_m ?? '—'} m
                </span>
                {renderDelta(delta.swlDelta, 'm')}
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block">PWL Delta</span>
                <span className="font-mono-num font-medium text-foreground">
                  {latestSurvey?.pumping_water_level_m ?? '—'} m
                </span>
                {renderDelta(delta.pwlDelta, 'm')}
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block">Drawdown Delta</span>
                <span className="font-mono-num font-bold text-info">
                  {drawdown != null ? `${drawdown} m` : '—'}
                </span>
                {renderDelta(delta.drawdownDelta, 'm')}
              </div>
              <div>
                <span className="text-2xs text-muted-foreground block">TDS Delta</span>
                <span className="font-mono-num font-medium text-foreground">
                  {latestSurvey?.tds_ppm != null ? `${latestSurvey.tds_ppm} ppm` : '—'}
                </span>
                {renderDelta(delta.tdsDelta, 'ppm')}
              </div>
            </div>
          </div>
        )}

        {/* 3 Metric Clusters */}
        <div className="space-y-3">
          {/* Cluster 1: Borehole & Levels */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-info" /> Borehole & Water Levels
              </span>
              <span className="text-3xs text-muted-foreground uppercase tracking-wider font-normal">
                {surveyDate ? `Survey · ${surveyDate}` : 'Survey'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Drilling Depth</div>
                <div className="font-mono-num font-medium">{drillingDepth ? `${drillingDepth} m` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Static Level (SWL)</div>
                <div className="font-mono-num font-medium">{swl != null ? `${swl} m` : '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pumping Level (PWL)</div>
                <div className="font-mono-num font-medium">{pwl != null ? `${pwl} m` : '—'}</div>
              </div>
              <div className="rounded bg-info/10 p-1.5 -m-0.5 border border-info/20">
                <div className="text-2xs uppercase tracking-wide text-info font-medium flex items-center justify-between">
                  <span>Drawdown</span>
                  <span className="text-3xs lowercase font-normal opacity-80">(PWL − SWL)</span>
                </div>
                <div className="font-mono-num font-bold text-info text-sm">
                  {drawdown != null ? `${drawdown} m` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Cluster 2: Pumping Equipment */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-accent" /> Pumping Equipment & Pressure
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Pump Setting</div>
                <div className="font-mono-num font-medium">{pumpSetting ?? '—'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Motor Rating</div>
                <div className="font-mono-num font-medium">{motorHp != null ? `${motorHp} HP` : '—'}</div>
              </div>
              <div className="col-span-2 rounded bg-muted/40 p-2 border border-border/50">
                <div className="flex items-center justify-between text-2xs uppercase tracking-wide text-muted-foreground font-medium">
                  <span>Live Operating Pressure</span>
                  <span className="text-3xs text-info font-normal">
                    {livePressureDate ? `Live · ${livePressureDate.slice(0, 10)}` : 'Live Telemetry'}
                  </span>
                </div>
                <div className="font-mono-num font-semibold text-sm text-foreground mt-0.5">
                  {livePressure != null ? `${livePressure} psi` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Cluster 3: Water Quality */}
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-warn" /> Water Quality & Salinity
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (Survey)</div>
                <div className="font-mono-num font-medium">{surveyTds != null ? `${surveyTds} ppm` : '—'}</div>
                <div className="text-3xs text-muted-foreground">{surveyDate ? `Survey · ${surveyDate}` : 'Survey'}</div>
              </div>
              <div>
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">TDS (Live Sensor)</div>
                <div className="font-mono-num font-medium">{liveTds != null ? `${liveTds} ppm` : '—'}</div>
                <div className="text-3xs text-muted-foreground">{liveTdsDate ? `Live · ${liveTdsDate.slice(0, 10)}` : 'Telemetry'}</div>
              </div>
              <div className="col-span-2">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">Turbidity</div>
                <div className="font-mono-num font-medium">{surveyTurbidity != null ? `${surveyTurbidity} NTU` : '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Survey Footer Metadata */}
        {latestSurvey && (
          <div className="pt-2 border-t text-2xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span>Date Logged: <strong className="text-foreground">{surveyDate}</strong></span>
              <span>Total Surveys: <strong className="text-foreground">{summary.allSurveysCount}</strong></span>
            </div>
            {latestSurvey.remarks && (
              <div className="italic pt-0.5">
                Remarks: &ldquo;{latestSurvey.remarks}&rdquo;
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
