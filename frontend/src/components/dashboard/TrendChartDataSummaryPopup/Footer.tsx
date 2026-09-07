import type { GridMeterBreakdown } from '../TrendChartPivotShared';

interface FooterProps {
  tabDates: string[];
  activeTab: string;
  hasProdTab: boolean;
  hasConsTab: boolean;
  hasGridTab: boolean;
  metric: string;
  prodEntities: { id: string; label: string; kind: string }[];
  consEntities: { id: string; label: string }[];
  gridBreakdown: GridMeterBreakdown;
}

export function Footer({
  tabDates, activeTab, hasProdTab, hasConsTab, hasGridTab, metric,
  prodEntities, consEntities, gridBreakdown,
}: FooterProps) {
  const prodKindCounts = (() => {
    const meterCount = prodEntities.filter((e) => e.kind === 'meter').length;
    const roCount = prodEntities.filter((e) => e.kind === 'ro_train').length;
    if (meterCount > 0 && roCount > 0) {
      return `${meterCount} product meter${meterCount === 1 ? '' : 's'} + ${roCount} RO train${roCount === 1 ? '' : 's'} (permeate)`;
    }
    if (roCount > 0) return `${roCount} RO train${roCount === 1 ? '' : 's'}`;
    return `${meterCount} product meter${meterCount === 1 ? '' : 's'}`;
  })();

  return (
    <div className="px-5 py-2 border-t shrink-0 flex items-center gap-3 text-2xs text-muted-foreground bg-muted/20">
      <span className="font-medium">{tabDates.length} days in range</span>
      {((activeTab === 'production' && hasProdTab) || (activeTab === 'overview' && metric === 'rawwater')) && (
        <span>· {metric === 'rawwater' || metric === 'pv'
          ? `${prodEntities.length} wells`
          : prodKindCounts}</span>
      )}
      {activeTab === 'consumption' && hasConsTab && (
        <span>· {consEntities.length} locators</span>
      )}
      {activeTab === 'grid-by-meter' && hasGridTab && (
        <span>· {gridBreakdown.columns.length} grid meter{gridBreakdown.columns.length === 1 ? '' : 's'}{gridBreakdown.hasUnattributed ? ' (some days only stored as daily totals)' : ''}</span>
      )}
    </div>
  );
}
