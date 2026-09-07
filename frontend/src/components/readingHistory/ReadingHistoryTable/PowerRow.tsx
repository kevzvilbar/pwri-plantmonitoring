import React from 'react';
import { fmtNum } from '@/lib/format';
import { getGridMeterVal } from '../types';
import { Loader2, Pencil, X } from 'lucide-react';
import { GridPylonIcon } from '@/pages/operations/shared';

interface PowerRowProps {
  r: any;
  i: number;
  rows: any[];
  predecessor: any;
  isDirectMode: boolean;
  isSolarDirectMode: boolean;
  solarDirectVal: (row: any) => number | null;
  anyEditable: boolean;
  hasFullAccess: boolean;
  activeOperatorId?: string;
  actions: any;
  dateStr: string;
  resolvedGridCount: number;
  getHistGridLabel: (idx: number) => string;
  getHistGridMult: (idx: number) => number;
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
  isEditing: boolean;
  isGridRepl: boolean;
  isSolarRepl: boolean;
  isDeleting: boolean;
  isTogglingGrid: boolean;
  isTogglingSolar: boolean;
  rowEditable: boolean;
}

export function PowerRow({
  r, i, rows, predecessor, isDirectMode, isSolarDirectMode, solarDirectVal,
  anyEditable, hasFullAccess, activeOperatorId, actions, dateStr,
  resolvedGridCount, getHistGridLabel, getHistGridMult, meterFilter,
  isEditing, isGridRepl, isSolarRepl, isDeleting, isTogglingGrid,
  isTogglingSolar, rowEditable,
}: PowerRowProps) {
  const gmr = r.grid_meter_readings as Record<string, number> | null | undefined;
  const prevGmr = predecessor?.grid_meter_readings as Record<string, number> | null | undefined;
  const hasSolar = r.solar_meter_reading != null || (r.daily_solar_kwh != null && +r.daily_solar_kwh > 0);
  const solarDisplayVal = isSolarDirectMode ? solarDirectVal(r) : r.solar_meter_reading;

  if (meterFilter) {
    const isSolar = meterFilter.type === 'solar';
    if (isSolar && r.is_estimated && r.solar_meter_reading == null && (r.daily_solar_kwh == null || +r.daily_solar_kwh === 0)) {
      return null;
    }

    const solarDirect = isSolar && isSolarDirectMode;
    const gridIdx = !isSolar ? (meterFilter as { type: 'grid'; idx: number }).idx : 0;
    const mMult = isSolar ? 1 : getHistGridMult(gridIdx);
    const curr = isSolar
      ? (solarDirect ? solarDirectVal(r) : r.solar_meter_reading)
      : getGridMeterVal(r, gridIdx, i, rows);

    if (!isSolar && curr == null) {
      return null;
    }
    let prevVal = isSolar
      ? predecessor?.solar_meter_reading
      : (predecessor ? getGridMeterVal(predecessor, gridIdx, i + 1, rows) : null);
    if (!isSolar && curr != null && prevVal == null) {
      for (let j = i + 1; j < rows.length; j++) {
        const v = getGridMeterVal(rows[j], gridIdx, j, rows);
        if (v != null) {
          prevVal = v;
          break;
        }
      }
    }
    const rawDelta = solarDirect ? null : (curr != null && prevVal != null ? curr - prevVal : null);
    const isRepl = isSolar ? isSolarRepl : isGridRepl;
    const effective = isRepl ? 0 : solarDirect ? curr : (rawDelta != null ? rawDelta * mMult : null);

    return (
      <tr
        className={[
          'group border-b border-border/40 transition-colors',
          isEditing ? 'bg-primary-soft/60'
          : isRepl ? 'bg-warn-soft/40'
          : r.is_estimated ? 'bg-warn-soft/20'
          : 'hover:bg-muted/40',
        ].join(' ')}
      >
        {anyEditable && (
          <td className="px-2 py-1.5 w-8">
            {rowEditable && (
              <input type="checkbox" className="h-3.5 w-3.5 accent-primary cursor-pointer"
                checked={actions.selectedIds.has(r.id)} onChange={() => actions.handleSelectOne(r.id)} />
            )}
          </td>
        )}
        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {dateStr}
            {r.is_estimated && (
              <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                Est.
              </span>
            )}
            {isRepl && (
              <span className={`text-3xs font-semibold uppercase tracking-wide px-1 py-0.5 rounded leading-none ${isSolar ? 'text-kpi-solar bg-kpi-solar/15' : 'text-kpi-grid bg-kpi-grid/15'}`}>
                repl.
              </span>
            )}
          </span>
        </td>
        <td />
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-2xs">
          <span className={isSolar ? 'text-kpi-solar' : 'text-kpi-grid'}>
            {curr != null ? fmtNum(curr, 2) : '—'}
          </span>
        </td>
        <td className="px-3 py-1.5 text-right font-mono-num whitespace-nowrap text-2xs">
          {isRepl
            ? <span className={isSolar ? 'text-kpi-solar font-medium' : 'text-kpi-grid font-medium'}>0.00</span>
            : solarDirect
              ? <span className="text-muted-foreground" title="Direct kWh input — no delta to compute">n/a</span>
              : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
          }
        </td>
        <td className="px-2 py-1.5 text-center font-mono-num whitespace-nowrap text-muted-foreground text-2xs">
          {mMult !== 1 ? `×${mMult}` : '×1'}
        </td>
        <td className={['px-3 py-1.5 text-right font-mono-num whitespace-nowrap font-medium text-2xs',
          effective != null && effective < 0 ? 'text-destructive font-semibold' : isSolar ? 'text-kpi-solar' : 'text-kpi-grid',
        ].join(' ')}>
          {effective != null ? fmtNum(effective, 2) : '—'}
        </td>
        <td className="px-2 py-1.5 text-center whitespace-nowrap">
          <button
            title={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
            aria-label={isRepl ? 'Replacement — click to unmark' : 'Mark as meter replacement (zeroes Δ)'}
            disabled={isDeleting || isTogglingGrid || isTogglingSolar}
            onClick={() => isSolar ? actions.handleToggleSolarReplacement(r) : actions.handleToggleGridReplacement(r, gridIdx)}
            className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              isRepl
                ? (isSolar ? 'bg-kpi-solar border-kpi-solar' : 'bg-kpi-grid border-kpi-grid') + ' text-white'
                : 'border-input bg-background hover:border-kpi-grid/40 hover:bg-kpi-grid/10',
            ].join(' ')}
          >
            {(isTogglingGrid || isTogglingSolar) ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
              : isRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
          </button>
        </td>
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

  const dateCols = 7;
  const actionsCell = anyEditable ? (
    <td className="px-2 py-1 text-center align-top whitespace-nowrap sticky right-0 z-10 border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] transition-colors bg-muted/20" rowSpan={resolvedGridCount + (hasSolar ? 1 : 0) + 1}>
      {rowEditable && (
        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 max-md:opacity-100 transition-opacity flex items-center justify-center gap-0.5 pt-0.5">
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
  ) : null;

  return (
    <React.Fragment>
      <tr className={[
        'border-t',
        isEditing ? 'bg-primary-soft/60'
        : isGridRepl ? 'bg-warn-soft/40'
        : r.is_estimated ? 'bg-warn-soft/20'
        : 'bg-muted/20',
      ].join(' ')}>
        {anyEditable && (
          <td className="px-2 py-1 w-8">
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
        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground font-medium" colSpan={dateCols}>
          <span className="flex items-center gap-1.5">
            {dateStr}
            {r.is_estimated && (
              <span className="text-3xs font-semibold uppercase tracking-wide text-warn bg-warn-soft/40 px-1 py-0.5 rounded leading-none border border-warn/40" title="Auto-backfilled reading">
                Est.
              </span>
            )}
            {isGridRepl && (
              <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-grid bg-kpi-grid/15 px-1 py-0.5 rounded leading-none">
                grid repl.
              </span>
            )}
            {isSolarRepl && (
              <span className="text-3xs font-semibold uppercase tracking-wide text-kpi-solar bg-kpi-solar/15 px-1 py-0.5 rounded leading-none">
                solar repl.
              </span>
            )}
          </span>
        </td>
        {actionsCell}
      </tr>

      {Array.from({ length: resolvedGridCount }).map((_, mi) => {
        const mLabel = getHistGridLabel(mi);
        const mMult = getHistGridMult(mi);
        const curr = getGridMeterVal(r, mi, i, rows);
        let prev = predecessor ? getGridMeterVal(predecessor, mi, i + 1, rows) : null;
        if (curr != null && prev == null) {
          for (let j = i + 1; j < rows.length; j++) {
            const v = getGridMeterVal(rows[j], mi, j, rows);
            if (v != null) {
              prev = v;
              break;
            }
          }
        }
        const rawDelta = (curr != null && prev != null) ? curr - prev : null;
        const effective = isGridRepl ? 0 : rawDelta != null ? rawDelta * mMult : null;

        return (
          <tr key={`g${mi}`} className="hover:bg-muted/30">
            {anyEditable && <td />}
            <td className="px-3 py-1 pl-6">
              <span className="flex items-center gap-1 text-2xs">
                <GridPylonIcon className="h-2.5 w-2.5 text-kpi-grid shrink-0" />
                <span className="text-muted-foreground truncate">{mLabel}</span>
              </span>
            </td>
            <td className="px-3 py-1 text-right font-mono-num text-kpi-grid text-2xs">
              {curr != null ? fmtNum(curr, 2) : '—'}
            </td>
            <td className="px-3 py-1 text-right font-mono-num text-2xs">
              {isGridRepl
                ? <span className="text-kpi-grid font-medium">0.00</span>
                : rawDelta != null ? <span className={rawDelta < 0 ? 'text-destructive font-semibold' : ''}>{fmtNum(rawDelta, 2)}</span> : '—'
              }
            </td>
            <td className="px-2 py-1 text-center font-mono-num text-muted-foreground text-2xs">
              {mMult !== 1 ? `×${mMult}` : '×1'}
            </td>
            <td className={[
              'px-3 py-1 text-right font-mono-num font-medium text-2xs',
              effective != null && effective < 0 ? 'text-destructive font-semibold' : 'text-kpi-grid',
            ].join(' ')}>
              {effective != null ? fmtNum(effective, 2) : '—'}
            </td>
            <td className="px-2 py-1 text-center">
              {mi === 0 && (
                <button
                  title={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                  aria-label={isGridRepl ? 'Grid replacement — click to unmark' : 'Mark grid meter replacement (zeroes Δ Grid)'}
                  disabled={isDeleting || isTogglingGrid}
                  onClick={() => actions.handleToggleGridReplacement(r)}
                  className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    isGridRepl
                      ? 'bg-kpi-grid border-kpi-grid text-white hover:bg-kpi-grid/90'
                      : 'border-input bg-background hover:border-kpi-grid/40 hover:bg-kpi-grid/10',
                  ].join(' ')}
                >
                  {isTogglingGrid
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    : isGridRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
                </button>
              )}
            </td>
          </tr>
        );
      })}

      {hasSolar && (
        <tr className="hover:bg-muted/30">
          {anyEditable && <td />}
          <td className="px-3 py-1 pl-6">
            <span className="flex items-center gap-1 text-2xs">
              <span className="text-kpi-solar text-xs leading-none">☀</span>
              <span className="text-muted-foreground">Solar</span>
            </span>
          </td>
          <td className="px-3 py-1 text-right font-mono-num text-kpi-solar text-2xs">
            {solarDisplayVal != null ? fmtNum(solarDisplayVal, 2) : '—'}
          </td>
          <td className="px-3 py-1 text-right font-mono-num text-2xs">
            {isSolarRepl
              ? <span className="text-kpi-solar font-medium">0.00</span>
              : isSolarDirectMode
                ? (solarDisplayVal != null
                    ? <span className={solarDisplayVal < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(solarDisplayVal, 2)}</span>
                    : '—')
                : (predecessor?.solar_meter_reading != null && r.solar_meter_reading != null)
                  ? (() => {
                      const sDelta = r.solar_meter_reading - predecessor.solar_meter_reading;
                      return <span className={sDelta < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(sDelta, 2)}</span>;
                    })()
                  : r.daily_solar_kwh != null && +r.daily_solar_kwh !== 0
                    ? <span className={+r.daily_solar_kwh < 0 ? 'text-destructive font-semibold' : 'text-kpi-solar'}>{fmtNum(+r.daily_solar_kwh, 2)}</span>
                    : '—'
            }
          </td>
          <td />
          <td />
          <td className="px-2 py-1 text-center">
            <button
              title={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
              aria-label={isSolarRepl ? 'Solar replacement — click to unmark' : 'Mark solar meter replacement (zeroes Δ Solar)'}
              disabled={isDeleting || isTogglingSolar}
              onClick={() => actions.handleToggleSolarReplacement(r)}
              className={['inline-flex items-center justify-center w-5 h-5 rounded border transition-colors',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                isSolarRepl
                  ? 'bg-kpi-solar border-kpi-solar text-white hover:bg-kpi-solar/90'
                  : 'border-input bg-background hover:border-kpi-solar/40 hover:bg-kpi-solar/10',
              ].join(' ')}
            >
              {isTogglingSolar
                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                : isSolarRepl ? <span className="text-3xs font-bold leading-none">✓</span> : null}
            </button>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
