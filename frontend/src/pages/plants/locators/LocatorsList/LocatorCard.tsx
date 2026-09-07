import { useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { EntityHistoryChart, MeterDetailButton } from '../../charts/EntityHistoryChart';
import { Pencil, Trash2 } from 'lucide-react';
import {
  TrendingUp, CalendarClock, Droplet, ShieldAlert, ArrowUpRight,
} from 'lucide-react';
import { ChangeMeterIcon } from '@/components/icons/water-icons';
import { cn } from '@/lib/utils';
import { lastReadingFreshness } from '@/lib/format';

export function LocatorCard({
  l,
  checked,
  onToggle,
  selectedLocator,
  setSelectedLocator,
  isManager,
  isAdmin,
  productMeters,
  latestByLocator,
  cardRefs,
  pulseId,
  onEdit,
  onDelete,
  onDetail,
  onStatusToggle,
  onLockChange,
  navigate,
}: {
  l: any;
  checked: boolean;
  onToggle: () => void;
  selectedLocator: string | null;
  setSelectedLocator: (id: string | null) => void;
  isManager: boolean;
  isAdmin: boolean;
  productMeters: any[];
  latestByLocator: Record<string, string>;
  cardRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  pulseId: string | null;
  onEdit: (l: any) => void;
  onDelete: (l: any) => void;
  onDetail: (id: string) => void;
  onStatusToggle: (l: any) => void;
  onLockChange: (l: any, checked: boolean) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const supplyMeter = (productMeters ?? []).find((m: any) => m.id === l.product_meter_id);
  const fresh = lastReadingFreshness(latestByLocator[l.id]);

  return (
    <Card
      key={l.id}
      ref={(el) => { cardRefs.current[l.id] = el; }}
      className={`p-3 card-interactive border-l-2 ${
        checked ? 'ring-1 ring-primary' : ''
      } ${
        pulseId === l.id ? 'ring-2 ring-accent shadow-elev' : ''
      } ${
        l.status === 'Active'
          ? 'border-l-accent'
          : 'border-l-muted-foreground/30'
      }`}
      data-testid={`locator-card-${l.id}`}
    >
      <div className="flex items-start gap-2">
        {isAdmin && (
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            className="mt-1 h-4 w-4 shrink-0 rounded-sm"
            data-testid={`locator-select-${l.id}`}
          />
        )}
        <div
          role="button"
          tabIndex={0}
          className="flex-1 min-w-0 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 rounded"
          onClick={() => setSelectedLocator(selectedLocator === l.id ? null : l.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedLocator(selectedLocator === l.id ? null : l.id); }
          }}
        >
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <div className="font-medium text-sm truncate flex items-center gap-1.5">
                {l.name}
                <TrendingUp className={`h-3 w-3 transition-colors shrink-0 ${selectedLocator === l.id ? 'text-primary' : 'text-muted-foreground/30'}`} />
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {l.meter_brand} {l.meter_size} · SN {l.meter_serial ?? '—'}
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {supplyMeter && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-primary-soft text-primary border border-primary/30">
                    <Droplet className="h-2.5 w-2.5" />
                    <span>Fed by: {supplyMeter.name}</span>
                  </div>
                )}
                <StatusPill tone={fresh.tone}>
                  <CalendarClock className="h-2.5 w-2.5" />
                  {fresh.label}
                </StatusPill>
                {isManager ? (
                  <label
                    className={`inline-flex items-center gap-1.5 text-2xs font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                      l.is_locked
                        ? 'text-danger bg-danger-soft border-danger/40'
                        : 'text-muted-foreground bg-muted/40 border-border/60 hover:bg-muted'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={!!l.is_locked}
                      onCheckedChange={(checked) => onLockChange(l, checked === true)}
                      className="h-3 w-3"
                      data-testid={`locator-lock-checkbox-${l.id}`}
                    />
                    <ShieldAlert className="h-2.5 w-2.5 shrink-0" />
                    <span>{l.is_locked ? 'Locked' : 'Unlocked'}</span>
                  </label>
                ) : (
                  l.is_locked && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-danger-soft text-danger border border-danger/40">
                      <ShieldAlert className="h-2.5 w-2.5" />
                      <span>Locked</span>
                    </div>
                  )
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/operations?tab=locator&highlight=${l.id}`);
                  }}
                  title="Open this locator in Operations"
                  aria-label="Open this locator in Operations"
                  className="inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted px-2 py-0.5 rounded-full transition-colors border border-border/50"
                >
                  <ArrowUpRight className="h-2.5 w-2.5" />
                  <span>Operations</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStatusToggle(l); }}
              title={isManager ? `Click to toggle status (currently ${l.status})` : l.status}
              className={`inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0 border transition-colors ${
                l.status === 'Active'
                  ? 'text-accent bg-accent-soft border-accent/30 hover:bg-accent-soft/70'
                  : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
              } ${isManager ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${l.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'}`} />
              {l.status}
            </button>
          </div>
        </div>
        {isManager && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" title="Edit" onClick={() => onEdit(l)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10" title="Delete" onClick={() => onDelete(l)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onDetail(l.id)}
          className="text-2xs text-primary hover:underline inline-flex items-center gap-0.5"
        >
          Details →
        </button>
      </div>
      {selectedLocator === l.id && (
        <div className="mt-3 pt-3 border-t">
          <EntityHistoryChart entityId={l.id} entityType="locator" entityName={l.name} defaultInputMode={l.default_input_mode === 'direct' ? 'direct' : 'raw'} />
        </div>
      )}
    </Card>
  );
}