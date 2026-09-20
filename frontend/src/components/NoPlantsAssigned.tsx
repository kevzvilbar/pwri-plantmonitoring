import { Droplet } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * D5 (docs/NAV-IA-REMEDIATION-PLAN.md): a user who is not Admin / Manager /
 * Data Analyst and has no plant assignments sees no plants at all. Say why,
 * rather than showing an empty page that looks like a fault.
 *
 * Shown when `useVisiblePlants().needsAssignment` is true.
 */
export function NoPlantsAssigned({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center gap-2 py-10 text-center text-muted-foreground text-sm rounded-xl border border-dashed border-border/60',
        className,
      )}
    >
      <Droplet className="h-8 w-8 opacity-30" aria-hidden />
      <span className="font-semibold text-foreground">No plants assigned</span>
      <span>Ask an admin to assign a plant to your account.</span>
    </div>
  );
}
