import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { TrainFormState } from './useTrainForm';

interface TypeOverridesProps {
  state: TrainFormState;
}

export function TypeOverrides({ state }: TypeOverridesProps) {
  const { form, setForm, mediaType, filterHousingType, usingPlantMedia, usingPlantFilter } = state;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Component Types{' '}
        <span className="normal-case font-normal text-muted-foreground">(overrides plant-wide setting for this train)</span>
      </div>

      <div>
        <Label className="text-xs mb-1.5 block">
          Media Filter Type
          {usingPlantMedia && (
            <span className="ml-2 text-2xs text-accent font-normal">
              ✓ Matches plant default
            </span>
          )}
        </Label>
        <div className="flex gap-2">
          {(['AFM', 'MMF'] as const).map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={mediaType === opt ? 'default' : 'outline'}
              onClick={() => setForm({ ...form, filter_media_type: opt })}
              data-testid={`train-media-${opt}`}
              className="flex-1"
            >
              <span
                aria-hidden
                className={`mr-1.5 h-2 w-2 rounded-full border ${mediaType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
              />
              {opt}
            </Button>
          ))}
        </div>
        <p className="text-2xs text-muted-foreground mt-1">AFM = Active Filter Media · MMF = Multi-Media Filter</p>
      </div>

      <div>
        <Label className="text-xs mb-1.5 block">
          Pre-filter Housing Type
          {usingPlantFilter && (
            <span className="ml-2 text-2xs text-accent font-normal">
              ✓ Matches plant default
            </span>
          )}
        </Label>
        <div className="flex gap-2">
          {(['Cartridge Filter', 'Bag Filter'] as const).map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={filterHousingType === opt ? 'default' : 'outline'}
              onClick={() => setForm({ ...form, filter_housing_type: opt })}
              data-testid={`train-filter-${opt.replace(' ', '-')}`}
              className="flex-1"
            >
              <span
                aria-hidden
                className={`mr-1.5 h-2 w-2 rounded-full border ${filterHousingType === opt ? 'bg-primary-foreground border-primary-foreground' : 'border-muted-foreground/40'}`}
              />
              {opt}
            </Button>
          ))}
        </div>
      </div>

      {(!usingPlantMedia || !usingPlantFilter) && (
        <p className="text-2xs text-warn">
          ⚠ This train differs from the plant default. It will display its own type labels.
        </p>
      )}
    </div>
  );
}
