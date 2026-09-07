import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ChevronLeft, Plus, MapPin, Gauge, Sun, Zap, Trash2, Loader2, Pencil, Upload, TrendingUp, Calendar, Droplet, CalendarClock, ArrowUpRight
} from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { StatusPill } from '@/components/StatusPill';
import { EntityHistoryChart } from '../../../charts/EntityHistoryChart';
import { lastReadingFreshness } from '@/lib/format';

import type { ReactNode } from 'react';

type WellCardProps = {
  w: any;
  checked: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isBlending: boolean;
  blendingPending: boolean;
  selectedWell: string | null;
  wellPulseId: string | null;
  latestByWellId: Record<string, string>;
  onToggleSelect: () => void;
  onCardClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onNavigateOperations: () => void;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleBlending: () => void;
  onToggleElectric: () => void;
  onSetDetail: () => void;
  getWellElectricMode: (wellId: string) => 'none' | 'dedicated' | 'shared';
  powerBusy: Set<string>;
  cardRef: (el: HTMLDivElement | null) => void;
};

export function WellCard({
  w, checked, isAdmin, isManager, isBlending, blendingPending,
  selectedWell, wellPulseId, latestByWellId,
  onToggleSelect, onCardClick, onKeyDown, onNavigateOperations,
  onToggleStatus, onEdit, onDelete, onToggleBlending, onToggleElectric,
  onSetDetail, getWellElectricMode, powerBusy, cardRef,
}: WellCardProps) {
  return (
    <Card
      ref={cardRef}
      className={`p-3 card-interactive border-l-2 ${checked ? 'ring-1 ring-primary' : ''} ${
        wellPulseId === w.id ? 'ring-2 ring-accent shadow-elev' : ''} ${
        w.status === 'Active' ? 'border-l-accent' : 'border-l-muted-foreground/30'
      } ${isBlending ? 'border-primary' : ''}`}
      data-testid={`well-card-${w.id}`}
    >
      <div className="flex items-start gap-2">
        {isAdmin && (
          <Checkbox checked={checked} onCheckedChange={onToggleSelect}
            className="mt-1 h-4 w-4 shrink-0 rounded-sm" data-testid={`well-select-${w.id}`} />
        )}
        <div role="button" tabIndex={0}
          className="flex-1 min-w-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 rounded"
          onClick={onCardClick}
          onKeyDown={onKeyDown}
        >
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm flex items-center gap-1.5 flex-wrap">
                <span className="truncate">{w.name}</span>
                <TrendingUp className={`h-3 w-3 transition-colors shrink-0 ${selectedWell === w.id ? 'text-primary' : 'text-muted-foreground/30'}`} />
                {w.has_power_meter && (() => {
                  const elMode = getWellElectricMode(w.id);
                  return (
                    <span className={`text-3xs uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 ${
                      elMode === 'shared' ? 'bg-primary-soft text-primary' : 'bg-warn-soft text-warn'
                    }`} title={elMode === 'shared' ? 'Shared kWh meter group' : 'Dedicated kWh meter'}>
                      <Zap className="h-2.5 w-2.5" />
                      {elMode === 'shared' ? 'Shared kWh' : 'Electric'}
                    </span>
                  );
                })()}
                {isBlending && (
                  <span className="text-3xs uppercase tracking-wide bg-kpi-ro/15 text-kpi-ro px-1.5 py-0.5 rounded"
                    title="Blending: separate water meter feeding product line">Blending</span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                {(() => {
                  const fresh = lastReadingFreshness(latestByWellId[w.id]);
                  return (
                    <StatusPill tone={fresh.tone}>
                      <CalendarClock className="h-2.5 w-2.5" />
                      {fresh.label}
                    </StatusPill>
                  );
                })()}
                <button type="button" onClick={onNavigateOperations} title="Open this well in Operations"
                  className="inline-flex items-center gap-0.5 text-2xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 px-1.5 py-0.5 rounded-full transition-colors">
                  <ArrowUpRight className="h-2.5 w-2.5" /> Operations
                </button>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                {(w.diameter != null || w.drilling_depth_m != null) && (
                  <span>{w.diameter ?? '—'}{w.drilling_depth_m != null ? ` · ${w.drilling_depth_m} m` : ''}</span>
                )}
                {w.meter_serial && (
                  <span className="inline-flex items-center gap-0.5">
                    <Gauge className="h-2.5 w-2.5" /> Water SN {w.meter_serial}
                  </span>
                )}
                {w.has_power_meter && w.electric_meter_serial && (
                  <span className="inline-flex items-center gap-0.5">
                    <Zap className="h-2.5 w-2.5" /> kWh SN {w.electric_meter_serial}
                  </span>
                )}
                {(w.gps_lat != null && w.gps_lng != null) && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-2.5 w-2.5" /> {(+w.gps_lat).toFixed(4)}, {(+w.gps_lng).toFixed(4)}
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={onToggleStatus}
              title={isManager ? `Click to toggle status (currently ${w.status})` : w.status}
              className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 border transition-colors ${
                w.status === 'Active' ? 'text-accent bg-accent-soft border-accent hover:bg-accent-soft'
                : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
              } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${w.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
              {w.status}
            </button>
          </div>
        </div>
        {isManager && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" title="Edit well"
              onClick={e => { e.stopPropagation(); onEdit(); }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
              title="Delete well" onClick={e => { e.stopPropagation(); onDelete(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {isManager && (
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
          <button onClick={onToggleBlending} disabled={blendingPending}
            className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-colors ${
              isBlending ? 'bg-primary border-primary text-primary-foreground'
              : 'bg-background border-border text-muted-foreground hover:bg-muted'
            } ${blendingPending ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            title={isBlending ? 'Blending on — click to clear' : 'Mark as blending well'}
            data-testid={`well-blending-${w.id}`}>
            {blendingPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${isBlending ? 'bg-primary-foreground' : 'bg-muted-foreground'}`} />}
            Blending
          </button>
          {(() => {
            const elMode = getWellElectricMode(w.id);
            return (
              <button onClick={onToggleElectric} disabled={powerBusy.has(w.id)}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-2xs font-medium border transition-colors ${
                  elMode === 'dedicated' ? 'bg-warn border-warn text-white'
                  : elMode === 'shared' ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
                } ${powerBusy.has(w.id) ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                title={
                  elMode === 'dedicated' ? 'Dedicated meter — click to remove'
                  : elMode === 'shared' ? 'In a shared meter group — click to remove from metering'
                  : 'No electric meter — click to add as dedicated'
                }
                data-testid={`well-power-${w.id}`}>
                {powerBusy.has(w.id) ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />}
                {elMode === 'dedicated' ? 'Dedicated' : elMode === 'shared' ? 'Shared' : 'Power'}
              </button>
            );
          })()}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button onClick={onSetDetail}
          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">Details →</button>
      </div>
      {selectedWell === w.id && (
        <div className="mt-3 pt-3 border-t">
          <EntityHistoryChart entityId={w.id} entityType="well" entityName={w.name} isBlendingWell={isBlending} />
        </div>
      )}
    </Card>
  );
}
