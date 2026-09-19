import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-2xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-sm break-words">{value}</div>
      </div>
    </div>
  );
}

export { InfoRow };
