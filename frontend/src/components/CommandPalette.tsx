import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useNavGroups } from '@/hooks/useNavGroups';
import { useVisiblePlants } from '@/hooks/useVisiblePlants';
// Leaf module, not the `@/features/wells` barrel: AppShell (and therefore this
// palette) is in the initial bundle, and the barrel drags in every wells
// component with it.
import { useWells } from '@/features/wells/hooks/useWells';
import { useLocators } from '@/hooks/useLocators';
import { assetPath, readingsPath } from '@/shared/assetLinks';
import { useCan } from '@/hooks/usePermission';
import { Building2, Droplets, MapPin, Gauge } from 'lucide-react';

/**
 * Command palette — P5-10 of docs/NAV-IA-REMEDIATION-PLAN.md (stretch).
 * Jump to a page, a plant, or a well/locator. Uses components/ui/command.tsx
 * (cmdk), previously only used by DesignationCombobox.
 * Pages come from useNavGroups() (custom-role overrides applied), plants from
 * useVisiblePlants() (D5), wells/locators from the cached list hooks scoped
 * to the visible plants. No new queries, no new permissions logic.
 * Asset rows offer both P5-7 directions: the page/card in Plants (assetPath)
 * and the row in Daily Readings (readingsPath). Product meters are out of
 * scope: no cached plant-scoped product-meter list hook exists to read them
 * from, and a new query just for the palette exceeds a stretch budget.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const can = useCan();
  const groups = useNavGroups();
  const { plants, plantIds } = useVisiblePlants();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const pages = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))).filter((i) => matches(`${i.label} ${i.group}`)),
    // `matches` closes over `q`; recompute when the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, q],
  );
  const plantHits = useMemo(
    () => (plants ?? []).filter((p) => matches(p.name ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plants, q],
  );
  const canPlants = can('plants');
  const canReadings = can('operations');
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page, plant, or well…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((item) => (
              <CommandItem key={item.id} value={`${item.label} ${item.group}`} onSelect={() => go(item.route)}>
                <item.icon className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{item.group}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {plantHits.length > 0 && canPlants && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Plants">
              {plantHits.map((p) => (
                <CommandItem key={p.id} value={`${p.name} plant`} onSelect={() => go(`/plants/${p.id}`)}>
                  <Building2 className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">Plant</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {/* Assets only mount when the user has at least one visible plant, so
            an unassigned account fires no wells/locators query at all. */}
        {plantIds.length > 0 && (
          <PaletteAssets
            plantIds={plantIds}
            query={q}
            canPlants={canPlants}
            canReadings={canReadings}
            go={go}
          />
        )}
      </CommandList>
    </CommandDialog>
  );
}

/** Global Ctrl+K / Cmd+K wiring. Mounted once in AppShell. */
export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

/**
 * Wells and locators for the visible plants. Split out so the two list queries
 * mount only when there is at least one plant to ask about: `useWells([])`
 * would skip its `.in(...)` filter and fetch every well the caller can read.
 * Each hit is offered twice — its page/card in Plants (assetPath) and its row
 * in Daily Readings (readingsPath) — which is both directions of P5-7.
 */
function PaletteAssets({ plantIds, query, canPlants, canReadings, go }: {
  plantIds: string[];
  /** Already trimmed + lower-cased. */
  query: string;
  canPlants: boolean;
  canReadings: boolean;
  go: (to: string) => void;
}) {
  const { data: wells = [] } = useWells(plantIds);
  const { data: locators = [] } = useLocators(plantIds);
  const matches = (s: string) => !query || s.toLowerCase().includes(query);
  const wellHits = useMemo(
    () => (wells ?? []).filter((w) => matches(`${w.name} well`)).slice(0, 8),
    // `matches` closes over `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wells, query],
  );
  const locatorHits = useMemo(
    () => (locators ?? []).filter((l) => matches(`${l.name} locator`)).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locators, query],
  );
  if ((!wellHits.length && !locatorHits.length) || (!canPlants && !canReadings)) return null;
  return (
    <>
      {canPlants && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Wells & locators">
            {wellHits.map((w) => (
              <CommandItem key={`well-${w.id}`} value={`${w.name} well`} onSelect={() => go(assetPath('well', w.plant_id, w.id))}>
                <Droplets className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Well</span>
              </CommandItem>
            ))}
            {locatorHits.map((l) => (
              <CommandItem key={`locator-${l.id}`} value={`${l.name} locator`} onSelect={() => go(assetPath('locator', l.plant_id, l.id))}>
                <MapPin className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Locator</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
      {canReadings && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Daily Readings rows">
            {wellHits.map((w) => (
              <CommandItem key={`rw-well-${w.id}`} value={`${w.name} readings row`} onSelect={() => go(readingsPath('well', w.id))}>
                <Gauge className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Readings</span>
              </CommandItem>
            ))}
            {locatorHits.map((l) => (
              <CommandItem key={`rw-loc-${l.id}`} value={`${l.name} readings row`} onSelect={() => go(readingsPath('locator', l.id))}>
                <Gauge className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">Readings</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </>
  );
}
