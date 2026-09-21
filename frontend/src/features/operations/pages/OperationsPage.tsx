import React, { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useActivePlant } from '@/hooks/useActivePlant';
import { Button } from '@/components/ui/button';
import {
  MapPin, Droplet, Zap, Upload, Download, ClipboardCheck,
  Waves, Layers, Clock, FlaskConical, Activity,
} from 'lucide-react';

import { LocatorReadingForm } from '../components/locators/LocatorSection';
import { WellReadingForm }    from '@/features/wells';
import { BlendingForm }       from '../components/blending/BlendingSection';
import { ProductForm }        from '../components/product/ProductSection';
import { PowerForm }          from '../components/power/PowerSection';
import { PageHeader }         from '@/components/PageHeader';
import { CanLink } from '@/components/CanLink';
import { useUrlTab } from '@/hooks/useUrlTab';
import { useRovingTabs } from '@/hooks/useRovingTabs';
import { useCan } from '@/hooks/usePermission';
import { cn } from '@/lib/utils';

const OPERATIONS_TABS = ['locator', 'well', 'product', 'blending', 'power'] as const;
// Older links use the plural or alternate names.
const OPERATIONS_TAB_ALIASES = { locators: 'locator', wells: 'well', production: 'product', bypass: 'blending' } as const;

import { getCurrentShift } from '@/lib/shifts';

export default function Operations() {
  const navigate = useNavigate();
  const can = useCan();
  // P2-1: the ribbon hides entirely when the user can open none of its links.
  const showRibbon = can('data_corrections') || can('manager_scorecard') || can('network_topology');
  const [searchParams] = useSearchParams();  // ?highlight= is read by the forms below
  const [tab, handleTabChange] = useUrlTab('tab', OPERATIONS_TABS, 'locator', { aliases: OPERATIONS_TAB_ALIASES });

  // P5-2: the active plant comes from the global picker. There is no longer a
  // `plants?.[0]` fallback: with "All plants" and several to choose from the
  // tab counts stay blank until a plant is chosen, instead of quietly showing
  // the first plant's numbers above forms that show nothing.
  const { plantId: activePlantId } = useActivePlant();

  const shiftInfo = useMemo(() => getCurrentShift(), []);

  // ── Asset count queries for active plant ──────────────────────────────────
  const { data: locatorCount = 0 } = useQuery({
    queryKey: ['operations-locator-count', activePlantId],
    queryFn: async () => {
      if (!activePlantId) return 0;
      const { count } = await supabase
        .from('locators')
        .select('id', { count: 'exact', head: true })
        .eq('plant_id', activePlantId);
      return count ?? 0;
    },
    enabled: Boolean(activePlantId),
    staleTime: 60_000,
  });

  const { data: wellCount = 0 } = useQuery({
    queryKey: ['operations-well-count', activePlantId],
    queryFn: async () => {
      if (!activePlantId) return 0;
      const { count } = await supabase
        .from('wells')
        .select('id', { count: 'exact', head: true })
        .eq('plant_id', activePlantId);
      return count ?? 0;
    },
    enabled: Boolean(activePlantId),
    staleTime: 60_000,
  });

  const { data: productMeterCount = 0 } = useQuery({
    queryKey: ['operations-pm-count', activePlantId],
    queryFn: async () => {
      if (!activePlantId) return 0;
      const { count } = await supabase
        .from('product_meters')
        .select('id', { count: 'exact', head: true })
        .eq('plant_id', activePlantId);
      return count ?? 0;
    },
    enabled: Boolean(activePlantId),
    staleTime: 60_000,
  });

  const TAB_CONFIG = [
    { key: 'locator',  label: 'Locators', count: locatorCount, icon: MapPin },
    { key: 'well',     label: 'Wells',    count: wellCount,    icon: Droplet },
    { key: 'product',  label: 'Product',  count: productMeterCount, icon: FlaskConical },
    { key: 'blending', label: 'Blending', count: null,         icon: Waves },
    { key: 'power',    label: 'Power',    count: null,         icon: Zap },
  ] as const;

  // P5-11: this bar is hand-rolled buttons, not Radix <Tabs>, so it needs the
  // roles and the roving tabindex that Radix would otherwise provide. Only the
  // open tab's form is mounted below, hence singlePanel.
  const tabs = useRovingTabs({
    ids: OPERATIONS_TABS,
    selected: tab,
    onSelect: handleTabChange,
    idPrefix: 'operations',
    singlePanel: true,
  });

  return (
    <div className="space-y-4 animate-fade-in max-w-[1600px] mx-auto pb-10">
      <PageHeader
        title="Daily Readings"
        titleIcon={<Activity className="h-5 w-5 text-primary" />}
        subtitle="Daily telemetry logs, flow rates, and active bypass management"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border text-xs font-medium">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span>{shiftInfo.name}</span>
              <span className="text-muted-foreground text-3xs font-mono">({shiftInfo.timeRange})</span>
            </div>

            {/* P2-1: Operators have no smart_import view — never show a button
                that ends in an "Access restricted" toast. */}
            <CanLink module="smart_import">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs gap-1.5 font-medium"
                onClick={() => navigate('/import')}
              >
                <Upload className="h-3.5 w-3.5 text-primary" />
                <span>Import</span>
              </Button>
            </CanLink>

            <CanLink module="data_exports">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs gap-1.5 font-medium"
                onClick={() => navigate('/exports')}
              >
                <Download className="h-3.5 w-3.5 text-accent" />
                <span>Export</span>
              </Button>
            </CanLink>
          </div>
        }
      />



      {/* ── Quick Jump Utility Ribbon ── */}
      {/* P2-1: each ribbon link is gated; the whole ribbon hides when the
          user can open none of them (e.g. Operator without overrides). */}
      {showRibbon && (
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/30 border border-border/60 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Operations Tools:</span>
          <CanLink module="data_corrections">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-2xs font-semibold hover:bg-background"
              onClick={() => navigate('/data-corrections')}
            >
              <ClipboardCheck className="h-3.5 w-3.5 mr-1 text-primary" />
              Data Corrections &rarr;
            </Button>
          </CanLink>
          <CanLink module="manager_scorecard">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-2xs font-semibold hover:bg-background"
              onClick={() => navigate('/manager-scorecard')}
            >
              <Activity className="h-3.5 w-3.5 mr-1 text-accent" />
              Manager Scorecard &rarr;
            </Button>
          </CanLink>
          <CanLink module="network_topology">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-2xs font-semibold hover:bg-background"
              onClick={() => navigate(activePlantId ? `/topology?plant=${activePlantId}` : '/topology')}
            >
              <Layers className="h-3.5 w-3.5 mr-1 text-kpi-ro" />
              Plant Topology &rarr;
            </Button>
          </CanLink>
        </div>

      </div>
      )}

      {/* ── Tab Navigation Bar ── */}
      <div
        {...tabs.tablistProps}
        aria-label="Reading type"
        className="flex gap-1.5 p-1.5 bg-muted/60 border border-border/70 rounded-2xl w-full shadow-inner"
      >
        {TAB_CONFIG.map(({ key, label, count, icon: Icon }) => {
          const active = tab === key;
          const tabColor =
            key === 'locator'  ? 'hsl(var(--kpi-locator, 175 84% 32%))'
            : key === 'well'     ? 'hsl(var(--info, 199 95% 60%))'
            : key === 'product'  ? 'hsl(var(--primary, 175 84% 32%))'
            : key === 'blending' ? 'hsl(var(--kpi-ro, 271 81% 56%))'
            : 'hsl(var(--chart-6, 217 91% 60%))';

          return (
            <button
              key={key}
              {...tabs.tabProps(key)}
              type="button"
              onClick={() => handleTabChange(key)}
              style={active ? ({ '--tab-glow': tabColor } as React.CSSProperties) : undefined}
              className={cn(
                'relative flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 text-xs sm:text-sm font-semibold rounded-xl transition-all duration-200 select-none',
                active
                  ? 'bg-card text-foreground shadow-xs border border-border/80 after:absolute after:inset-x-3 after:-bottom-[2px] after:h-[2.5px] after:rounded-full after:bg-[--tab-glow] after:shadow-[0_0_8px_var(--tab-glow)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0 transition-colors', active ? 'text-foreground' : 'text-muted-foreground/70')} />
              <span className="leading-none">{label}</span>
              {count != null && count > 0 && (
                <span className={cn(
                  'text-2xs px-1.5 py-0.5 rounded-full font-bold font-mono-num',
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <div {...tabs.panelProps(tab)}>
        {tab === 'locator'  && <LocatorReadingForm highlightId={tab === 'locator' ? searchParams.get('highlight') : null} />}
        {tab === 'well'     && <WellReadingForm highlightId={tab === 'well' ? searchParams.get('highlight') : null} />}
        {tab === 'product'  && <ProductForm highlightId={tab === 'product' ? searchParams.get('highlight') : null} />}
        {tab === 'blending' && <BlendingForm />}
        {tab === 'power'    && <PowerForm />}
      </div>
    </div>
  );
}
