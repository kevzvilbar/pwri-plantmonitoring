import { cn } from '@/lib/utils';

function StatusDot({ status }: { status: string }) {
  const cls =
    status === 'Active'    ? 'bg-accent' :
    status === 'Suspended' ? 'bg-danger'   : 'bg-warn';
  return <span className={cn('w-2 h-2 rounded-full shrink-0', cls)} title={status} />;
}

export { StatusDot };
