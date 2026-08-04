import { cn } from '@/lib/utils';

export function ToggleSwitch({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group">
      <div className={cn(
        'relative w-9 h-5 rounded-full transition-colors duration-200',
        active ? 'bg-primary' : 'bg-muted-foreground/30'
      )}>
        <div className={cn(
          'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200',
          active ? 'translate-x-4' : 'translate-x-0.5'
        )} />
      </div>
      <span className={cn('text-sm font-medium transition-colors', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}>
        {label}
      </span>
    </button>
  );
}
