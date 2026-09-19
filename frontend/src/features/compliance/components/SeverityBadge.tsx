import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface SeverityBadgeProps {
  sev: string;
}

export function SeverityBadge({ sev }: SeverityBadgeProps) {
  const m: Record<string, string> = {
    high:   'bg-danger-soft text-danger border-danger font-bold',
    medium: 'bg-warn-soft text-warn border-warn font-semibold',
    low:    'bg-info-soft text-info border-info font-normal',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-3xs', m[sev] ?? '')}>
      {sev}
    </Badge>
  );
}
