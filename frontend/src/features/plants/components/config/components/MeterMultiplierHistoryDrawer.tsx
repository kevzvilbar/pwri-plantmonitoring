import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { TableRow, TableCell } from '@/components/ui/table';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeterEvent } from '@/data/queries/meterEvents';

export interface PowerMeterChangeRow {
  id: string;
  plant_id: string;
  meter_index: number;
  change_date: string;
  old_multiplier: number;
  new_multiplier: number;
  old_meter_final_reading: number | null;
  new_meter_initial_reading: number | null;
  notes: string | null;
  created_at: string;
  user_profiles?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
}

interface MeterMultiplierHistoryDrawerProps {
  isPower: boolean;
  historyCount: number;
  powerChanges: PowerMeterChangeRow[];
  waterEvents: MeterEvent[];
}

export function MeterMultiplierHistoryDrawer({
  isPower,
  historyCount,
  powerChanges,
  waterEvents,
}: MeterMultiplierHistoryDrawerProps) {
  return (
    <TableRow className="bg-muted/15 border-b border-border/40">
      <TableCell colSpan={5} className="py-3 px-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <History className="h-3 w-3" /> Replacement &amp; Multiplier Event History ({historyCount})
            </span>
          </div>

          {historyCount === 0 ? (
            <p className="text-2xs text-muted-foreground italic py-1">
              No replacement or cutover events logged for this meter yet.
            </p>
          ) : isPower ? (
            <div className="space-y-1.5">
              {powerChanges.map((pc) => (
                <div
                  key={pc.id}
                  className="rounded border border-border/60 bg-card p-2 text-2xs space-y-1 shadow-2xs"
                >
                  <div className="flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-3xs px-1.5 py-0 border-info text-info bg-info-soft"
                      >
                        CT Change / Replacement
                      </Badge>
                      <span className="text-foreground">
                        {format(parseISO(pc.change_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {pc.user_profiles?.first_name
                        ? `${pc.user_profiles.first_name} ${pc.user_profiles.last_name || ''}`
                        : pc.user_profiles?.email || 'System'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 text-muted-foreground font-mono">
                    <div>
                      Old CT: <span className="text-foreground">×{pc.old_multiplier}</span>
                    </div>
                    <div>
                      New CT: <span className="text-foreground font-semibold">×{pc.new_multiplier}</span>
                    </div>
                    <div>
                      Old Final Read:{' '}
                      <span className="text-foreground">
                        {pc.old_meter_final_reading != null ? `${pc.old_meter_final_reading} kWh` : '—'}
                      </span>
                    </div>
                    <div>
                      New Initial Read:{' '}
                      <span className="text-foreground font-semibold">
                        {pc.new_meter_initial_reading != null ? `${pc.new_meter_initial_reading} kWh` : '—'}
                      </span>
                    </div>
                  </div>

                  {pc.notes && (
                    <p className="text-3xs text-muted-foreground italic pt-0.5 border-t border-border/30 mt-1">
                      Note: {pc.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {waterEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded border border-border/60 bg-card p-2 text-2xs space-y-1 shadow-2xs"
                >
                  <div className="flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-3xs px-1.5 py-0',
                          ev.event_type === 'physical_replacement'
                            ? 'border-info text-info bg-info-soft'
                            : 'border-primary text-primary bg-primary-soft'
                        )}
                      >
                        {ev.event_type === 'physical_replacement'
                          ? 'Physical Replacement'
                          : 'Multiplier Cutover'}
                      </Badge>
                      <span className="text-foreground">
                        {format(parseISO(ev.effective_at), 'MMM d, yyyy h:mm a')}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {ev.performer?.first_name
                        ? `${ev.performer.first_name} ${ev.performer.last_name || ''}`
                        : ev.performer?.email || 'System'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5 text-muted-foreground font-mono">
                    <div>
                      Old Serial: <span className="text-foreground">{ev.old_meter_serial || '—'}</span>
                    </div>
                    <div>
                      New Serial: <span className="text-foreground">{ev.new_meter_serial || '—'}</span>
                    </div>
                    <div>
                      Multiplier:{' '}
                      <span className="text-foreground font-semibold">
                        {ev.new_multiplier_enabled ? `×${ev.new_multiplier}` : 'Off (×1)'}
                      </span>
                    </div>
                    <div>
                      Baseline Read: <span className="text-foreground">{ev.new_reading_value ?? '—'}</span>
                    </div>
                  </div>

                  {ev.notes && (
                    <p className="text-3xs text-muted-foreground italic pt-0.5 border-t border-border/30 mt-1">
                      Note: {ev.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
