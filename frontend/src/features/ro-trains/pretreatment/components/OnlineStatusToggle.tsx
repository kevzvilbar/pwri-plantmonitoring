import { Power, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OnlineStatusToggleProps {
  trainOnline: boolean;
  onSetOnline: () => void;
  onSetOffline: () => void;
}

export function OnlineStatusToggle({ trainOnline, onSetOnline, onSetOffline }: OnlineStatusToggleProps) {
  return (
    <div className="pt-2 border-t border-border/50">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSetOnline}
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
            trainOnline
              ? 'border-accent bg-accent-soft/70 shadow-xs ring-1 ring-accent/30'
              : 'border-border/60 bg-muted/20 hover:bg-muted/40 opacity-70'
          )}
        >
          <div className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all',
            trainOnline ? 'bg-accent text-accent-foreground shadow-sm' : 'bg-muted text-muted-foreground'
          )}>
            <Power className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-bold uppercase tracking-wider', trainOnline ? 'text-accent' : 'text-muted-foreground')}>
                Operational / Running
              </span>
              {trainOnline && <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />}
            </div>
            <p className="text-2xs text-muted-foreground truncate">
              Ready to log RO pressures, TDS, flows & backwash
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={onSetOffline}
          className={cn(
            'flex items-center gap-3 p-3 rounded-lg border text-left transition-all',
            !trainOnline
              ? 'border-danger bg-danger-soft/80 shadow-xs ring-1 ring-danger/30'
              : 'border-border/60 bg-muted/20 hover:bg-muted/40 opacity-70'
          )}
        >
          <div className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all',
            !trainOnline ? 'bg-danger text-danger-foreground shadow-sm' : 'bg-muted text-muted-foreground'
          )}>
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-bold uppercase tracking-wider', !trainOnline ? 'text-danger font-semibold' : 'text-muted-foreground')}>
                Offline / Not Running
              </span>
              {!trainOnline && <span className="inline-block h-2 w-2 rounded-full bg-danger animate-pulse" />}
            </div>
            <p className="text-2xs text-muted-foreground truncate">
              Log downtime event, maintenance, trip or outage
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

