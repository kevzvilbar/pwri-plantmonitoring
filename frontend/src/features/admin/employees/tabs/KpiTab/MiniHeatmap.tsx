import { useCallback } from 'react';
import type { ScoreMap2 } from './constants';
import type { DutyState } from './useKpiData';

function formatDutyStateText(dutyState?: DutyState): string {
  switch (dutyState) {
    case 'data_entry':
      return 'On duty (data entry)';
    case 'dual_duty':
      return 'On duty (dual-duty partner — pooled RO credit)';
    case 'attendance_only':
      return 'On duty (attendance only — no declared partner)';
    case 'plant_active_unattributed':
      return 'Plant active — on duty, didn\'t personally log';
    case 'off_duty':
      return 'Off duty / Not applicable';
    default:
      return '';
  }
}

function MiniHeatmap({ scores, days, label, todayStr, dutyStates, onHover }: {
  scores: ScoreMap2;
  days: string[];
  label: string;
  todayStr: string;
  dutyStates?: Record<string, DutyState>;
  onHover: (text: string | null, e?: React.MouseEvent) => void;
}) {
  const isSingleDay = days.length === 1;

  if (isSingleDay) {
    const day = days[0];
    const raw = scores[day];
    const score = raw === undefined ? null : raw;
    const isToday = day === todayStr;
    const status = scoreStatus(score, isToday);
    const pct = score === null ? null : Math.round((score as number) * 100);
    const color = scoreColor(score, isToday);
    const dutyState = dutyStates?.[day];
    const dutyDesc = formatDutyStateText(dutyState);

    const tooltip = status === 'na'
      ? `${label}\n${dutyDesc || 'Off duty / Not applicable'}`
      : status === 'pending'
      ? `${label} — ${day}\n${dutyDesc ? `[${dutyDesc}]\n` : ''}⏳ Pending — day in progress`
      : `${label} — ${day}\n${dutyDesc ? `[${dutyDesc}]\n` : ''}${pct === 100 ? '✓ Complete' : pct === 0 ? '✗ Missed' : pct + '% done'}`;

    return (
      <div className="flex items-center justify-center py-1">
        <div
          className="flex items-center justify-center rounded-md font-bold text-2xs text-white cursor-default select-none transition-transform hover:scale-105"
          style={{ background: color, width: 44, height: 22, opacity: status === 'na' ? 0.5 : 1 }}
          onMouseEnter={(e) => onHover(tooltip, e)}
          onMouseLeave={() => onHover(null)}
        >
          {status === 'na' ? '—' : status === 'pending' ? '…' : pct === 100 ? '✓' : pct === 0 ? '✗' : `${pct}%`}
        </div>
      </div>
    );
  }

  const sqSize = days.length <= 7 ? 14 : days.length <= 14 ? 10 : 8;

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1.5">
      {days.map((day) => {
        const raw = scores[day];
        const score = raw === undefined ? null : raw;
        const isToday = day === todayStr;
        const status = scoreStatus(score, isToday);
        const pct = score === null ? null : Math.round((score as number) * 100);
        const dutyState = dutyStates?.[day];
        const dutyDesc = formatDutyStateText(dutyState);

        const tooltipText = status === 'na'
          ? `${label} — ${day}\n${dutyDesc || 'Off duty / N/A'}`
          : `${label} — ${day}\n${dutyDesc ? `[${dutyDesc}]\n` : ''}${status === 'pending' ? 'Pending — day in progress' : pct + '% complete'}`;

        return (
          <div
            key={day}
            style={{ width: sqSize, height: sqSize, background: scoreColor(score, isToday), borderRadius: 2, flexShrink: 0, opacity: status === 'na' ? 0.25 : 0.88 }}
            onMouseEnter={(e) => onHover(tooltipText, e)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => onHover(tooltipText, e)}
            className="cursor-pointer transition-transform hover:scale-125"
          />
        );
      })}
    </div>
  );
}

import { scoreStatus, scoreColor } from './constants';
export { MiniHeatmap };
