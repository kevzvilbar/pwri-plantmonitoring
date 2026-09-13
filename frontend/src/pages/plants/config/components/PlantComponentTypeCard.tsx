import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';

// Always-visible, instant-save segmented controls — deliberately mirrors
// BackwashModeCard's interaction model (click = saved immediately, optimistic
// update with revert-on-error) instead of the old click-to-expand + local
// Save/Cancel flow, so the two cards that sit side by side in "Component
// Types & Backwash" behave and look like one consistent pattern.
export function PlantComponentTypeCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [mediaType, setMediaType] = useState<'AFM' | 'MMF'>(plant.filter_media_type ?? 'AFM');
  const [filterType, setFilterType] = useState<'Cartridge Filter' | 'Bag Filter'>(plant.filter_housing_type ?? 'Cartridge Filter');

  const saveMedia = async (next: 'AFM' | 'MMF') => {
    if (next === mediaType || !isManager) return;
    const prev = mediaType;
    setMediaType(next);
    const { error } = await supabase.from('plants').update({ filter_media_type: next }).eq('id', plant.id);
    if (error) { setMediaType(prev); toast.error(friendlyError(error)); return; }
    toast.success(`Media set to ${next} for all trains`);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  const saveFilter = async (next: 'Cartridge Filter' | 'Bag Filter') => {
    if (next === filterType || !isManager) return;
    const prev = filterType;
    setFilterType(next);
    const { error } = await supabase.from('plants').update({ filter_housing_type: next }).eq('id', plant.id);
    if (error) { setFilterType(prev); toast.error(friendlyError(error)); return; }
    toast.success(`Pre-filter set to ${next === 'Cartridge Filter' ? 'Cartridge' : 'Bag'} for all trains`);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  return (
    <Card className="p-3 flex flex-col gap-3" data-testid="plant-component-type-card">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-kpi-grid shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Plant-wide Component Types</div>
          <div className="text-2xs text-muted-foreground">Applies universally — reflected in all train labels &amp; forms.</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-1">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Media</p>
          <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
            {(['AFM', 'MMF'] as const).map((opt) => {
              const active = mediaType === opt;
              return (
                <button
                  key={opt}
                  disabled={!isManager}
                  onClick={() => saveMedia(opt)}
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

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Pre-filter</p>
          <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
            {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => {
              const active = filterType === opt;
              return (
                <button
                  key={opt}
                  disabled={!isManager}
                  onClick={() => saveFilter(opt)}
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
      </div>
    </Card>
  );
}
