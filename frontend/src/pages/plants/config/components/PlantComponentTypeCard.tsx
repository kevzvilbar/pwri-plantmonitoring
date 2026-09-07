import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, X, Loader2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

export function PlantComponentTypeCard({ plant, embedded = false }: { plant: any; embedded?: boolean }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mediaType, setMediaTypeState] = useState<'AFM' | 'MMF'>(plant.filter_media_type ?? 'AFM');
  const [filterType, setFilterTypeState] = useState<'Cartridge Filter' | 'Bag Filter'>(plant.filter_housing_type ?? 'Cartridge Filter');

  const [mediaOpen, setMediaOpen]   = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const setMediaType = (v: 'AFM' | 'MMF') => { setMediaTypeState(v); setEditing(true); };
  const setFilterType = (v: 'Cartridge Filter' | 'Bag Filter') => { setFilterTypeState(v); setEditing(true); };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('plants')
      .update({ filter_media_type: mediaType, filter_housing_type: filterType })
      .eq('id', plant.id);
    setSaving(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success('Component types updated for all trains');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  const cancel = () => {
    setMediaTypeState(plant.filter_media_type ?? 'AFM');
    setFilterTypeState(plant.filter_housing_type ?? 'Cartridge Filter');
    setEditing(false);
  };

  const inner = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="h-4 w-4 text-chart-6 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Plant-wide Component Types</div>
          <div className="text-2xs text-muted-foreground">Applies universally — reflected in all train labels &amp; forms.</div>
        </div>
      </div>

      <div className="space-y-1.5 flex-1">
        <div className="rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setMediaOpen(o => !o)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Media</span>
              {!mediaOpen && (
                <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                  {mediaType}
                </span>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${mediaOpen ? 'rotate-180' : ''}`} />
          </button>
          {mediaOpen && (
            <div className="p-2">
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
                {(['AFM', 'MMF'] as const).map((opt) => {
                  const active = mediaType === opt;
                  return (
                    <button
                      key={opt}
                      disabled={!isManager}
                      onClick={() => { if (isManager) setMediaType(opt); }}
                      data-testid={`media-type-${opt}`}
                      className={[
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        !isManager ? 'cursor-default opacity-70' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full border ${active ? 'bg-white border-white' : 'border-muted-foreground/40'}`} />
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setFilterOpen(o => !o)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pre-filter</span>
              {!filterOpen && (
                <span className="text-2xs font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                  {filterType === 'Cartridge Filter' ? 'Cartridge' : 'Bag'}
                </span>
              )}
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
          </button>
          {filterOpen && (
            <div className="p-2">
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
                {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => {
                  const active = filterType === opt;
                  return (
                    <button
                      key={opt}
                      disabled={!isManager}
                      onClick={() => { if (isManager) setFilterType(opt); }}
                      data-testid={`filter-type-${opt.replace(' ', '-')}`}
                      className={[
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                        !isManager ? 'cursor-default opacity-70' : 'cursor-pointer',
                      ].join(' ')}
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full border ${active ? 'bg-white border-white' : 'border-muted-foreground/40'}`} />
                      {opt === 'Cartridge Filter' ? 'Cartridge' : 'Bag'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {isManager && editing && (
        <div className="flex gap-1.5 justify-end pt-2.5">
          <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-7 text-xs px-3">Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving} data-testid="save-component-types-btn" className="h-7 text-xs px-3 bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="flex flex-col" data-testid="plant-component-type-card">{inner}</div>;
  return <Card className="p-3 flex flex-col" data-testid="plant-component-type-card">{inner}</Card>;
}
