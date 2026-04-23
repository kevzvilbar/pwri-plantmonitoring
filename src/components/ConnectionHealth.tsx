import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Wifi, WifiOff, AlertCircle, Loader2 } from 'lucide-react';

type Status = 'checking' | 'online' | 'degraded' | 'offline';

export function ConnectionHealth() {
  const [status, setStatus] = useState<Status>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const ping = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline'); setLastChecked(new Date()); setLatencyMs(null);
      return;
    }
    const t0 = performance.now();
    try {
      const { error } = await supabase
        .from('plants')
        .select('id', { head: true, count: 'exact' })
        .limit(1);
      const dt = Math.round(performance.now() - t0);
      setLatencyMs(dt);
      setLastChecked(new Date());
      if (error) {
        setStatus('degraded');
      } else {
        setStatus(dt > 1500 ? 'degraded' : 'online');
      }
    } catch {
      setLatencyMs(null);
      setLastChecked(new Date());
      setStatus('offline');
    }
  };

  useEffect(() => {
    ping();
    const id = window.setInterval(ping, 30_000);
    const onOnline = () => ping();
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={ping}
          aria-label={`Connection ${meta.label}`}
          data-testid="indicator-connection"
          className="relative inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-topbar/40 transition-colors"
        >
          <Icon className={`h-4 w-4 ${meta.iconClass} ${status === 'checking' ? 'animate-spin' : ''}`} />
          <span
            className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-topbar ${meta.dotClass}`}
            aria-hidden
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="text-xs">
          <div className="font-semibold">Backend: {meta.label}</div>
          {latencyMs != null && <div className="text-muted-foreground">Latency: {latencyMs} ms</div>}
          {lastChecked && (
            <div className="text-muted-foreground">
              Checked {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <div className="text-muted-foreground mt-1">Click to re-check</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_META: Record<Status, {
  label: string; icon: typeof Wifi; iconClass: string; dotClass: string;
}> = {
  checking: { label: 'Checking…', icon: Loader2, iconClass: 'text-topbar-foreground/80', dotClass: 'bg-amber-400' },
  online:   { label: 'Online',    icon: Wifi,     iconClass: 'text-topbar-foreground',    dotClass: 'bg-emerald-500' },
  degraded: { label: 'Degraded',  icon: AlertCircle, iconClass: 'text-amber-400',         dotClass: 'bg-amber-500' },
  offline:  { label: 'Offline',   icon: WifiOff,  iconClass: 'text-rose-400',             dotClass: 'bg-rose-500' },
};
