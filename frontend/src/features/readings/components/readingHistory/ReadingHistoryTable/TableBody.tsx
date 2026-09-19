import React from 'react';
import { canEditEntry } from '@/pages/ro-trains/helpers';
import { PowerRow } from './PowerRow';
import { StandardRow } from './StandardRow';
import { calc } from '@/lib/calculations';
import { fmtDate, fmtDateTime } from '@/lib/format';

interface TableBodyProps {
  rows: any[];
  module: string;
  isDirectMode: boolean;
  isSolarDirectMode: boolean;
  solarDirectVal: (row: any) => number | null;
  anyEditable: boolean;
  hasFullAccess: boolean;
  activeOperatorId?: string;
  actions: any;
  getHistGridLabel: (idx: number) => string;
  getHistGridMult: (idx: number) => number;
  resolvedGridCount: number;
  meterFilter?: { type: 'solar'; idx: number } | { type: 'grid'; idx: number };
}

export function TableBody(props: TableBodyProps) {
  const { rows, module, isDirectMode, isSolarDirectMode, solarDirectVal, anyEditable, hasFullAccess, activeOperatorId, actions, getHistGridLabel, getHistGridMult, resolvedGridCount, meterFilter } = props;

  return (
    <tbody>
      {rows.map((r: any, i: number) => {
        const dt = r.reading_datetime ?? r.event_date ?? r.noted_at ?? '';
        let dateStr: string;
        if (module === 'blending') {
          if (r.reading_datetime) {
            dateStr = fmtDateTime(r.reading_datetime);
          } else if (r.event_date) {
            dateStr = fmtDate(r.event_date);
          } else {
            dateStr = '—';
          }
        } else {
          dateStr = dt ? fmtDateTime(dt) : '—';
        }

        const isEditing = actions.editRow?.id === r.id;
        const isDeleting = actions.deletingId === r.id;
        const isToggling = actions.togglingId === r.id;
        const isMeterReplacement = !!r.is_meter_replacement;
        const rowEditable = canEditEntry(r, hasFullAccess, activeOperatorId);
        const predecessor: any = rows[i + 1] ?? null;

        if (module === 'power') {
          const isGridRepl = !!(r.is_grid_replacement ?? r.is_meter_replacement);
          const isSolarRepl = !!(r.is_solar_replacement ?? false);
          const isTogglingGrid = actions.togglingGridId === r.id;
          const isTogglingSolar = actions.togglingSolarId === r.id;

          return (
            <PowerRow
              key={r.id ?? i}
              r={r} i={i} rows={rows} predecessor={predecessor}
              isDirectMode={isDirectMode} isSolarDirectMode={isSolarDirectMode}
              solarDirectVal={solarDirectVal} anyEditable={anyEditable}
              hasFullAccess={hasFullAccess} activeOperatorId={activeOperatorId}
              actions={actions} dateStr={dateStr}
              resolvedGridCount={resolvedGridCount}
              getHistGridLabel={getHistGridLabel} getHistGridMult={getHistGridMult}
              meterFilter={meterFilter}
              isEditing={isEditing} isGridRepl={isGridRepl} isSolarRepl={isSolarRepl}
              isDeleting={isDeleting} isTogglingGrid={isTogglingGrid}
              isTogglingSolar={isTogglingSolar} rowEditable={rowEditable}
            />
          );
        }

        return (
          <StandardRow
            key={r.id ?? i}
            r={r} i={i} rows={rows} predecessor={predecessor} module={module}
            isDirectMode={isDirectMode} anyEditable={anyEditable}
            hasFullAccess={hasFullAccess} activeOperatorId={activeOperatorId}
            actions={actions} dateStr={dateStr}
            isMeterReplacement={isMeterReplacement}
            isEstimated={!!r.is_estimated} isDeleting={isDeleting}
            isToggling={isToggling} rowEditable={rowEditable} isEditing={isEditing}
          />
        );
      })}
    </tbody>
  );
}
