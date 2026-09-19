import { cn } from '@/lib/utils';
import { scoreColor, scoreLabel } from '../types';

interface ScoreGaugeProps {
  score: number;
}

export function ScoreGauge({ score }: ScoreGaugeProps) {
  const radius = 28;
  const circumference = Math.PI * radius; // half-circle
  const offset = circumference - (score / 100) * circumference;

  const strokeColor =
    score >= 80 ? 'hsl(var(--accent))' : score >= 50 ? 'hsl(var(--warn))' : 'hsl(var(--danger))';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="76" height="44" viewBox="0 0 76 44">
        {/* Background arc */}
        <path
          d="M 6 42 A 32 32 0 0 1 70 42"
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Score arc */}
        <path
          d="M 6 42 A 32 32 0 0 1 70 42"
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${offset}`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="38" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill={strokeColor}>
          {score}
        </text>
      </svg>
      <span className={cn('text-2xs font-semibold uppercase tracking-wide', scoreColor(score))}>
        {scoreLabel(score)}
      </span>
    </div>
  );
}
