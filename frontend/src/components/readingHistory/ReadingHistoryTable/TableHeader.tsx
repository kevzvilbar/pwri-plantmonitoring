import React from 'react';
import { canEditEntry } from '@/pages/ro-trains/helpers';

interface TableHeaderProps {
  module: string;
  isDirectMode: boolean;
  anyEditable: boolean;
  resolvedGridCount: number;
  actions: any;
  hasFullAccess: boolean;
  activeOperatorId?: string;
  rows: any[];
}

export function TableHeader({ module, isDirectMode, anyEditable, resolvedGridCount, actions, hasFullAccess, activeOperatorId, rows }: TableHeaderProps) {
  return (
    <thead className="bg-muted sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.06)] border-b border-border/60">
      <tr>
        {anyEditable && (
          <th className="px-2 py-2 w-8">
            <input type="checkbox"
              className="h-3.5 w-3.5 accent-primary cursor-pointer"
              checked={!!rows?.length && actions.selectedIds.size > 0 &&
                actions.selectedIds.size === rows.filter((r: any) => canEditEntry(r, hasFullAccess, activeOperatorId)).length}
              onChange={actions.handleSelectAll}
              title="Select all"
            />
          </th>
        )}
        <th className="px-3 py-2 font-medium whitespace-nowrap">Date & Time</th>
        {module === 'locator' && (isDirectMode ? <>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
        </> : <>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
        </>)}
        {module === 'well' && (isDirectMode ? <>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Power (kWh)</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">TDS (ppm)</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">NTU</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Pressure (psi)</th>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
        </> : <>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Water</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Power (kWh)</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">TDS (ppm)</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">NTU</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Pressure (psi)</th>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
        </>)}
        {module === 'blending' && <>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Volume (m³)</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Flags</th>
        </>}
        {module === 'power' && <>
          <th className="px-3 py-2 font-medium whitespace-nowrap">Meter</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Reading</th>
          <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Δ (kWh)</th>
          <th className="px-2 py-2 font-medium text-center text-muted-foreground whitespace-nowrap">×</th>
          <th className="px-3 py-2 font-medium text-right text-kpi-grid whitespace-nowrap">Power (kWh)</th>
          <th className="px-2 py-2 font-medium text-center whitespace-nowrap">Repl.</th>
        </>}
        {anyEditable && <th className="px-2 py-2 font-medium text-center w-16 sticky right-0 top-0 z-30 bg-muted border-l border-border/30 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.12)] whitespace-nowrap">Actions</th>}
      </tr>
    </thead>
  );
}
