import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDraft } from '@/hooks/useDraft';
import { DraftBanner } from '@/components/DraftBanner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { StatusPill } from '@/components/StatusPill';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';
import { ChevronDown, CheckCircle2, Flame } from 'lucide-react';
import { CLOSE_INITIAL } from './useIncidentsData';
import { cn } from '@/lib/utils';

export function IncidentCard({ incident }: { incident: any }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const { draft: v, setDraft: setV, hasDraft, clearDraft, discardDraft } = useDraft(
    `incident-close:${incident.id}`,
    CLOSE_INITIAL,
  );

  const close = async () => {
    if (!v.root_cause && !v.corrective_action) {
      toast.error('Please specify root cause or corrective action before closing');
      return;
    }
    const { error } = await supabase.from('incidents').update({
      ...v,
      status: 'Closed',
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
      closed_by: user?.id,
      closed_at: new Date().toISOString(),
    }).eq('id', incident.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Incident resolved & closed');
    clearDraft();
    qc.invalidateQueries({ queryKey: ['incidents-open'] });
    qc.invalidateQueries({ queryKey: ['incidents-open-count'] });
    qc.invalidateQueries({ queryKey: ['incidents-resolved-30d'] });
  };

  const sevTone =
    incident.severity === 'Critical' || incident.severity === 'High' ? 'danger' :
    incident.severity === 'Medium' ? 'warn' : 'info';

  const isCritical = incident.severity === 'Critical';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={cn(
        'p-3.5 transition-all rounded-xl border',
        isCritical ? 'border-danger/60 bg-danger/5 shadow-xs' : 'border-border/80 hover:border-foreground/30',
      )}>
        <CollapsibleTrigger className="w-full text-left">
          <div className="flex justify-between items-start gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-muted-foreground">{incident.incident_ref || 'INC-PENDING'}</span>
                {incident.incident_type && (
                  <span className="text-3xs px-2 py-0.5 rounded-full bg-muted font-semibold text-foreground">
                    {incident.incident_type}
                  </span>
                )}
                {isCritical && (
                  <span className="flex items-center gap-1 text-3xs px-1.5 py-0.5 rounded bg-danger text-white font-bold animate-pulse">
                    <Flame className="h-2.5 w-2.5" /> Urgent
                  </span>
                )}
              </div>
              <div className="font-bold text-sm text-foreground line-clamp-2">{incident.what_description}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-foreground">{incident.plants?.name}</span>
                <span>·</span>
                <span>{incident.where_location || 'Location unassigned'}</span>
                {incident.when_datetime && (
                  <>
                    <span>·</span>
                    <span>{format(new Date(incident.when_datetime), 'MMM d, yyyy · HH:mm')}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <StatusPill tone={sevTone as any}>{incident.severity}</StatusPill>
              <div className="flex items-center gap-1 text-3xs text-primary font-semibold">
                <span>{open ? 'Hide Actions' : 'Resolve'}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', open ? 'rotate-180' : '')} />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 space-y-3 border-t border-border/60 pt-3">
          {hasDraft && <DraftBanner onDiscard={discardDraft} />}

          {incident.immediate_action && (
            <div className="p-2.5 rounded-lg bg-muted/50 text-xs">
              <span className="text-3xs uppercase font-bold text-muted-foreground block mb-0.5">Immediate Action Logged:</span>
              <p className="text-foreground">{incident.immediate_action}</p>
            </div>
          )}

          <div className="space-y-2">
            <div>
              <Label htmlFor={`root-cause-${incident.id}`} className="text-xs font-semibold">Root Cause Analysis (RCA)</Label>
              <Textarea
                rows={2}
                value={v.root_cause}
                onChange={e => setV({ ...v, root_cause: e.target.value })}
                placeholder="What was the fundamental cause of this occurrence?"
                id={`root-cause-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`corrective-action-${incident.id}`} className="text-xs font-semibold">Corrective Action Taken</Label>
              <Textarea
                rows={2}
                value={v.corrective_action}
                onChange={e => setV({ ...v, corrective_action: e.target.value })}
                placeholder="What immediate repairs or adjustments were completed?"
                id={`corrective-action-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`preventive-measures-${incident.id}`} className="text-xs font-semibold">Preventive Measures</Label>
              <Textarea
                rows={2}
                value={v.preventive_measures}
                onChange={e => setV({ ...v, preventive_measures: e.target.value })}
                placeholder="What changes will prevent recurrence?"
                id={`preventive-measures-${incident.id}`}
                className="text-xs mt-1"
              />
            </div>
          </div>

          <Button size="sm" onClick={close} className="w-full font-bold">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Complete Investigation & Close Incident
          </Button>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
