import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TrainFormState } from './useTrainForm';

interface ComponentCountsProps {
  state: TrainFormState;
}

export function ComponentCounts({ state }: ComponentCountsProps) {
  const { form, setForm, num, mediaType, filterHousingType, boosterPsiMode, setBoosterPsiMode, boosterTargets, setBoosterTargets } = state;

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Component Counts</div>

      <div>
        <Label htmlFor="traindetail-units-media-filter" className="text-xs">
          {mediaType} units{' '}
          <span className="text-muted-foreground font-normal">(media filter)</span>
        </Label>
        <div className="flex items-center gap-2 mt-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label={`Decrease ${mediaType} units`}
            onClick={() => setForm({ ...form, num_afm: String(Math.max(0, num(form.num_afm) - 1)) })}
            data-testid="dec-afm"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            value={form.num_afm}
            onChange={(e) => setForm({ ...form, num_afm: e.target.value })}
            className="text-center font-mono-num"
            data-testid="num-afm-input"
          id="traindetail-units-media-filter"/>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label={`Increase ${mediaType} units`}
            onClick={() => setForm({ ...form, num_afm: String(num(form.num_afm) + 1) })}
            data-testid="inc-afm"
          >
            +
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="traindetail-pre-filter" className="text-xs">
          {filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'}{' '}
          <span className="text-muted-foreground font-normal">(pre-filter)</span>
        </Label>
        <div className="flex items-center gap-2 mt-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label={`Decrease ${filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'} count`}
            onClick={() => setForm({ ...form, num_cartridge_filters: String(Math.max(0, num(form.num_cartridge_filters) - 1)) })}
            data-testid="dec-cf"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            value={form.num_cartridge_filters}
            onChange={(e) => setForm({ ...form, num_cartridge_filters: e.target.value })}
            className="text-center font-mono-num"
            data-testid="num-cf-input"
          id="traindetail-pre-filter"/>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label={`Increase ${filterHousingType === 'Bag Filter' ? 'Filter Housing' : 'Cartridge Housing'} count`}
            onClick={() => setForm({ ...form, num_cartridge_filters: String(num(form.num_cartridge_filters) + 1) })}
            data-testid="inc-cf"
          >
            +
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="traindetail-booster-pumps" className="text-xs">Booster Pumps</Label>
        <div className="flex items-center gap-2 mt-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Decrease Booster Pumps"
            onClick={() => setForm({ ...form, num_booster_pumps: String(Math.max(0, num(form.num_booster_pumps) - 1)) })}
            data-testid="dec-bp"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            value={form.num_booster_pumps}
            onChange={(e) => setForm({ ...form, num_booster_pumps: e.target.value })}
            className="text-center font-mono-num"
            data-testid="num-bp-input"
          id="traindetail-booster-pumps"/>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Increase Booster Pumps"
            onClick={() => setForm({ ...form, num_booster_pumps: String(num(form.num_booster_pumps) + 1) })}
            data-testid="inc-bp"
          >
            +
          </Button>
        </div>
      </div>

      {num(form.num_booster_pumps) > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">Booster Pump Targets</p>
            <div className="flex rounded-full border border-border overflow-hidden text-2xs font-semibold">
              <button type="button" onClick={() => setBoosterPsiMode(true)}
                className={cn('px-2.5 py-0.5 transition-colors',
                  boosterPsiMode ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
                psi
              </button>
              <button type="button" onClick={() => setBoosterPsiMode(false)}
                className={cn('px-2.5 py-0.5 transition-colors',
                  !boosterPsiMode ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}>
                Hz
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: num(form.num_booster_pumps) }, (_, i) => i + 1).map((u) => (
              <div key={u} className="flex items-center gap-2">
                <span className="text-2xs font-medium text-muted-foreground w-14 shrink-0">Pump {u}</span>
                <Input
                  type="number" step="any" min={0}
                  placeholder={boosterPsiMode ? 'psi — leave blank to enter per reading' : 'Hz — leave blank to enter per reading'}
                  value={boosterTargets[u] ?? ''}
                  onChange={(e) => setBoosterTargets({ ...boosterTargets, [u]: e.target.value })}
                  className="h-8 text-xs font-mono-num"
                  data-testid={`booster-target-${u}`}
                />
              </div>
            ))}
          </div>
          <p className="text-2xs text-muted-foreground">
            Leave a pump blank to keep entering its target manually per reading.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="traindetail-high-pressure-pumps-hpp" className="text-xs">High-Pressure Pumps (HPP)</Label>
        <div className="flex items-center gap-2 mt-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Decrease High-Pressure Pumps"
            onClick={() => setForm({ ...form, num_hp_pumps: String(Math.max(0, num(form.num_hp_pumps) - 1)) })}
            data-testid="dec-hpp"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            value={form.num_hp_pumps}
            onChange={(e) => setForm({ ...form, num_hp_pumps: e.target.value })}
            className="text-center font-mono-num"
            data-testid="num-hpp-input"
          id="traindetail-high-pressure-pumps-hpp"/>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Increase High-Pressure Pumps"
            onClick={() => setForm({ ...form, num_hp_pumps: String(num(form.num_hp_pumps) + 1) })}
            data-testid="inc-hpp"
          >
            +
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="traindetail-hpp-target-pressure-psi" className="text-xs">HPP Target Pressure (psi)</Label>
        <Input
          type="number"
          step="any"
          min={0}
          placeholder="e.g. 180"
          value={form.hpp_target_pressure_psi}
          onChange={(e) => setForm({ ...form, hpp_target_pressure_psi: e.target.value })}
          className="mt-1 font-mono-num"
          data-testid="hpp-target-pressure-input"
        id="traindetail-hpp-target-pressure-psi"/>
        <p className="text-2xs text-muted-foreground mt-1">
          Auto-fills on every reading for this train. Leave blank to keep entering it manually per reading.
        </p>
      </div>

      <div>
        <Label htmlFor="traindetail-controllers" className="text-xs">Controllers</Label>
        <div className="flex items-center gap-2 mt-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Decrease Controllers"
            onClick={() => setForm({ ...form, num_controllers: String(Math.max(0, num(form.num_controllers) - 1)) })}
            data-testid="dec-ctrl"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            value={form.num_controllers}
            onChange={(e) => setForm({ ...form, num_controllers: e.target.value })}
            className="text-center font-mono-num"
            data-testid="num-ctrl-input"
          id="traindetail-controllers"/>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            aria-label="Increase Controllers"
            onClick={() => setForm({ ...form, num_controllers: String(num(form.num_controllers) + 1) })}
            data-testid="inc-ctrl"
          >
            +
          </Button>
        </div>
      </div>

      {filterHousingType !== 'Bag Filter' && (
        <div>
          <Label htmlFor="traindetail-filter-housings" className="text-xs">Filter Housings</Label>
          <div className="flex items-center gap-2 mt-1">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              aria-label="Decrease Filter Housings"
              onClick={() => setForm({ ...form, num_filter_housings: String(Math.max(0, num(form.num_filter_housings) - 1)) })}
              data-testid="dec-fh"
            >
              −
            </Button>
            <Input
              type="number"
              min={0}
              value={form.num_filter_housings}
              onChange={(e) => setForm({ ...form, num_filter_housings: e.target.value })}
              className="text-center font-mono-num"
              data-testid="num-fh-input"
            id="traindetail-filter-housings"/>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8 shrink-0"
              aria-label="Increase Filter Housings"
              onClick={() => setForm({ ...form, num_filter_housings: String(num(form.num_filter_housings) + 1) })}
              data-testid="inc-fh"
            >
              +
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
