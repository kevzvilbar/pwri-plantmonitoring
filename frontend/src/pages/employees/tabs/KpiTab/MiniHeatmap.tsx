import { useCallback } from 'react';
import type { ScoreMap2 } from './constants';

function MiniHeatmap({ scores, days, label, todayStr, onHover }: {
  scores: ScoreMap2;
  days: string[];
  label: string;
  todayStr: string;
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

    return (
      <div className="flex items-center justify-center py-1">
        <div
          className="flex items-center justify-center rounded-md font-bold text-2xs text-white cursor-default select-none transition-transform hover:scale-105"
          style={{ background: color, width: 44, height: 22, opacity: status === 'na' ? 0.5 : 1 }}
          onMouseEnter={(e) => onHover(
            status === 'na' ? `${label}\nOff duty / Not applicable`
              : status === 'pending' ? `${label} — ${day}\n⏳ Pending — day in progress`
              : `${label} — ${day}\n${pct === 100 ? '✓ Complete' : pct === 0 ? '✗ Missed' : pct + '% done'}`,
            e
          )}
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
        const tooltipText = `${label} — ${day}\n${status === 'na' ? 'Off duty / N/A' : status === 'pending' ? 'Pending — day in progress' : pct + '% complete'}`;
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
