import React from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Gauge,
  Droplet,
  MapPin,
  RotateCw,
  Sliders,
  ChevronDown,
  ChevronRight,
  Sun,
} from 'lucide-react';
import { GridPylonIcon } from '@/features/plants/shared';
import { cn } from '@/lib/utils';
import {
  MeterMultiplierHistoryDrawer,
  type PowerMeterChangeRow,
} from './MeterMultiplierHistoryDrawer';
import type { MeterEvent } from '@/data/queries/meterEvents';

export interface UnifiedMeterRow {
  id: string;
  name: string;
  type: 'product' | 'well' | 'locator' | 'power';
  typeLabel: string;
  meter_serial: string | null;
  meter_multiplier: number;
  multiplier_enabled: boolean;
  last_reading?: number | null;
  powerKind?: 'grid' | 'solar';
  meterIndex?: number;
}

interface MeterMultiplierTableRowProps {
  meter: UnifiedMeterRow;
  isExpanded: boolean;
  canEdit: boolean;
  waterEvents: MeterEvent[];
  powerChanges: PowerMeterChangeRow[];
  onToggleExpand: (id: string) => void;
  onOpenWaterWorkflow: (target: UnifiedMeterRow, eventType: 'physical_replacement' | 'multiplier_cutover') => void;
  onOpenPowerManage: () => void;
  onOpenPowerReplace: (gridIndex: number) => void;
}

export function MeterMultiplierTableRow({
  meter: m,
  isExpanded,
  canEdit,
  waterEvents,
  powerChanges,
  onToggleExpand,
  onOpenWaterWorkflow,
  onOpenPowerManage,
  onOpenPowerReplace,
}: MeterMultiplierTableRowProps) {
  const isPower = m.type === 'power';
  const historyCount = isPower ? powerChanges.length : waterEvents.length;
  const hasEvents = historyCount > 0;

  const icon =
    m.type === 'product' ? (
      <Gauge className="h-3.5 w-3.5 text-primary" />
    ) : m.type === 'well' ? (
      <Droplet className="h-3.5 w-3.5 text-kpi-wells" />
    ) : m.type === 'locator' ? (
      <MapPin className="h-3.5 w-3.5 text-kpi-locator" />
    ) : m.powerKind === 'solar' ? (
      <Sun className="h-3.5 w-3.5 text-warn" />
    ) : (
      <GridPylonIcon className="h-3.5 w-3.5 text-info" />
    );

  return (
    <React.Fragment>
      <TableRow className={cn('hover:bg-muted/20 transition-colors', isExpanded && 'bg-muted/10')}>
        <TableCell className="p-2 text-center">
          <button
            type="button"
            onClick={() => onToggleExpand(m.id)}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
            title={hasEvents ? `${historyCount} audit event(s)` : 'No replacement history'}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className={cn('h-3.5 w-3.5', !hasEvents && 'opacity-40')} />
            )}
          </button>
        </TableCell>
        <TableCell className="py-2.5">
          <div className="flex items-center gap-2">
            <div className={cn(
              "h-6 w-6 rounded flex items-center justify-center shrink-0",
              m.powerKind === 'solar' ? "bg-warn-soft" : m.powerKind === 'grid' ? "bg-info-soft" : "bg-muted/60"
            )}>
              {icon}
            </div>
            <div>
              <div className="text-xs font-semibold text-foreground">{m.name}</div>
              <div className="text-3xs text-muted-foreground">{m.typeLabel}</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="py-2.5 font-mono text-xs text-muted-foreground">
          {m.meter_serial || '—'}
        </TableCell>
        <TableCell className="py-2.5">
          {m.multiplier_enabled ? (
            <Badge variant="outline" className="border-primary/50 text-primary bg-primary-soft text-2xs font-mono font-semibold">
              ×{m.meter_multiplier} {isPower ? 'CT Active' : 'Active'}
            </Badge>
          ) : m.meter_multiplier > 1 ? (
            <Badge variant="outline" className="border-warn/50 text-warn bg-warn-soft text-2xs font-mono">
              Configured Off (×{m.meter_multiplier})
            </Badge>
          ) : isPower && m.powerKind === 'solar' ? (
            <Badge variant="outline" className="border-border text-muted-foreground text-2xs font-mono">
              Direct / Raw (×1)
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border text-muted-foreground text-2xs font-mono">
              No Multiplier (×1)
            </Badge>
          )}
        </TableCell>
        <TableCell className="py-2.5 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {isPower ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenPowerManage}
                  disabled={!canEdit}
                  className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                >
                  <Sliders className="h-3 w-3 text-muted-foreground" /> Configure
                </Button>
                {m.powerKind === 'grid' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenPowerReplace(m.meterIndex ?? 0)}
                    disabled={!canEdit}
                    className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                  >
                    <RotateCw className="h-3 w-3 text-muted-foreground" /> Replace
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenWaterWorkflow(m, 'multiplier_cutover')}
                  disabled={!canEdit}
                  className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                >
                  <Sliders className="h-3 w-3 text-muted-foreground" /> Configure
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenWaterWorkflow(m, 'physical_replacement')}
                  disabled={!canEdit}
                  className="h-7 text-2xs px-2.5 gap-1 text-foreground"
                >
                  <RotateCw className="h-3 w-3 text-muted-foreground" /> Replace
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <MeterMultiplierHistoryDrawer
          isPower={isPower}
          historyCount={historyCount}
          powerChanges={powerChanges}
          waterEvents={waterEvents}
        />
      )}
    </React.Fragment>
  );
}
