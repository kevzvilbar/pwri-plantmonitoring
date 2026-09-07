import React from 'react';
import { calc, fmtNum } from '@/lib/calculations';
import { canEditEntry } from '@/pages/ro-trains/helpers';
import { StatusPill } from '@/components/StatusPill';
import { Loader2, Pencil, X } from 'lucide-react';

interface StandardRowProps {
  r: any;
  i: number;
  rows: any[];
  predecessor: any;
  module: string;
  isDirectMode: boolean;
  anyEditable: boolean;
  hasFullAccess: boolean;
  activeOperatorId?: string;
  actions: any;
  dateStr: string;
  isMeterReplacement: boolean;
  isEstimated: boolean;
  isDeleting: boolean;
  isToggling: boolean;
  rowEditable: boolean;
  isEditing: boolean;
}

export function StandardRow({
  r, i, rows, predecessor, module, isDirectMode,
  anyEditable, hasFullAccess, activeOperatorId, actions,
  dateStr, isMeterReplacement, isEstimated, isDeleting,
  isToggling, rowEditable, isEditing,
}: StandardRowProps) {
  const prevReading = predecessor != null
    ? +predecessor.current_reading
    : (r.previous_reading != null ? +r.previous_reading : null);
  const rawDelta = prevReading != null
    ? calc.dailyVolume(+r.current_reading, prevReading,
        !!r.is_meter_rollover, r.meter_rollover_max != null ? +r.meter_rollover_max : null)
    : null;

  const replCell = (
    <td className="px-2 py-1.5 text-center">
      <button
        title={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
        aria-label={isMeterReplacement ? 'Meter replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
        disabled={isDeleting || isToggling}
        onClick={() => actions.handleToggleReplacement(r)}
        className={[
          'inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          isMeterReplacement
            ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
            : 'border-input bg-background hover:border-kpi-solar/40 hover:bg-kpi-solar/10',
        ].join(' ')}
      >
        {isToggling
          ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
          : isMeterReplacement ? <span className="text-3xs font-bold leading-none">✓</span> : null
        }
      </button>
    </td>
  );

  const flagsList: React.ReactNode[] = [];
  if (isEstimated) {
    flagsList.push(
      <StatusPill
        key="est"
        tone="warn"
        title="System-generated / Backfilled reading — no manual operator entry on file. Saving an edit converts this to a verified human reading."
        aria-label="Estimated reading"
      >
        Est.
      </StatusPill>
    );
  }
  if (r.off_location_flag) {
    flagsList.push(
      <StatusPill
        key="off-loc"
        tone="warn"
        title="GPS mismatch at entry"
        aria-label="Off location reading"
      >
        off-loc
      </StatusPill>
    );
  }
  const flagsCell = (
    <td className="px-3 py-1.5 whitespace-nowrap">
      {flagsList.length > 0 ? (
        <div className="flex items-center gap-1 flex-wrap">{flagsList}</div>
      ) : (
        <span className="text-muted-foreground/30 text-2xs">—</span>
      )}
    </td>
  );

  return (
    <tr
      className={[
        'group border-b border-border/40 transition-colors',
        isEditing ? 'bg-primary-soft/60'
        : isMeterReplacement ? 'bg-warn-soft/40'
        : isEstimated ? 'bg-warn-soft/20'
        : 'hover:bg-muted/40',
      ].join(' ')}
    >
      {anyEditable && (
        <td className="px-2 py-1.5 w-8">
          {rowEditable && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary cursor-pointer"
              checked={actions.selectedIds.has(r.id)}
              onChange={() => actions.handleSelectOne(r.id)}
            />
          )}
        </td>
      )}
      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {dateStr}
          {isMeterReplacement && (
            <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
              repl.
            </span>
          )}
        </span>
      </td>

      {module === 'locator' && (isDirectMode ? <>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
        {replCell}
        {flagsCell}
      </> : <>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {isMeterReplacement
            ? <span className="text-kpi-solar font-medium">0.00</span>
            : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
          }
        </td>
        {replCell}
        {flagsCell}
      </>)}

      {module === 'well' && (isDirectMode ? <>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
        {replCell}
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.power_meter_reading != null ? fmtNum(r.power_meter_reading, 2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.tds_ppm != null ? fmtNum(r.tds_ppm, 2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {(r as any).turbidity_ntu != null ? (+((r as any).turbidity_ntu)).toFixed(2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.pressure_psi != null ? fmtNum(r.pressure_psi, 2) : '—'}
        </td>
        {flagsCell}
      </> : <>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">{fmtNum(r.current_reading, 2)}</td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {isMeterReplacement
            ? <span className="text-kpi-solar font-medium">0.00</span>
            : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
          }
        </td>
        {replCell}
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.power_meter_reading != null ? fmtNum(r.power_meter_reading, 2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.tds_ppm != null ? fmtNum(r.tds_ppm, 2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {(r as any).turbidity_ntu != null ? (+((r as any).turbidity_ntu)).toFixed(2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          {r.pressure_psi != null ? fmtNum(r.pressure_psi, 2) : '—'}
        </td>
        {flagsCell}
      </>)}

      {module === 'blending' && <>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-muted-foreground">
          {r.raw_meter_reading != null ? fmtNum(r.raw_meter_reading, 2) : '—'}
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap">
          <span className={(r.volume_m3 ?? 0) < 0 ? 'text-destructive font-semibold' : ''}>
            {fmtNum(r.volume_m3 ?? 0, 2)}
          </span>
        </td>
        {replCell}
        {flagsCell}
      </>}

      {anyEditable && (
        <td className="px-2 py-1 text-center whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors bg-background group-hover:bg-muted/40">
          {rowEditable && (
            <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
              <button title="Edit" aria-label="Edit" disabled={!!actions.editRow || isDeleting}
                onClick={() => actions.startEdit(r)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40">
                <Pencil className="h-3 w-3" />
              </button>
              <button title="Delete" aria-label="Delete" disabled={!!actions.editRow || isDeleting}
                onClick={() => actions.setPendingDeleteId(r.id)}
                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-40">
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
