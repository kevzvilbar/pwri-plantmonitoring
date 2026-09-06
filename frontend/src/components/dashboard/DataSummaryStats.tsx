import React from 'react';
import { Activity, Droplet, Receipt, Gauge } from 'lucide-react';
import { SummaryTab } from './DataSummaryModal';

export interface DataSummaryStatsProps {
  tab: SummaryTab;
  combinedProdPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  consPivot: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
    estimatedKeys: Set<string>;
  };
  currentPivotData: {
    dates: string[];
    entities: any[];
    pivot: Map<string, Map<string, number>>;
  };
  entities: any[];
  dates: string[];
  estimatedKeys: Set<string>;
  hasRoEntities: boolean;
  hasMeterEntities: boolean;
  plantIds: string[];
  modalMeterConfigs: any[] | undefined;
  configLoading: boolean;
}

function summaryPctDelta(today: number, yesterday: number): number | null {
  if (!yesterday) return null;
  return +((((today - yesterday) / yesterday) * 100).toFixed(1));
}

function pctLabel(pct: number | null) {
  if (pct == null) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function DataSummaryStats({
  tab,
  combinedProdPivot,
  consPivot,
  currentPivotData,
  entities,
  dates,
  estimatedKeys,
  hasRoEntities,
  hasMeterEntities,
  plantIds,
  modalMeterConfigs,
  configLoading,
}: DataSummaryStatsProps) {
  return (
    <>
      {/* ── Footer legend ── */}
      <div className="px-5 py-2 border-t shrink-0 flex items-center gap-4 text-2xs text-muted-foreground bg-muted/20">
        {tab === 'both' && <><Activity className="h-3 w-3 text-primary" /> Production vs Consumption — daily totals (m³) · NRW % = (Prod − Cons) ÷ Prod</>}
        {tab === 'consumption' && <><Receipt className="h-3 w-3 text-highlight" /> Consumption — delta volume (m³) per locator · Current Readings — raw meter values per locator per day</>}
        {tab === 'production' && (
          hasRoEntities && hasMeterEntities
            ? <><Droplet className="h-3 w-3 text-primary" /> Production — delta volume (m³) per product meter + permeate_meter_delta (m³) per RO train, summed · Current Readings — raw meter values per entity per day</>
            : hasRoEntities
              ? <><Droplet className="h-3 w-3 text-primary" /> Production — permeate_meter_delta (m³) per RO train · Current Readings — raw permeate meter per train per day</>
              : <><Droplet className="h-3 w-3 text-primary" /> Production — delta volume (m³) per product meter · Current Readings — raw meter values per meter per day</>
        )}
        {(tab === 'production' || tab === 'consumption') && estimatedKeys.size > 0 && (
          <span className="flex items-center gap-1 ml-3 text-warn">
            <span className="font-bold text-2xs">~</span>
            Auto-estimated (Poly. Regression deg. 3) — hover cell for details
          </span>
        )}
        {tab === 'current' && (
          <><Gauge className="h-3 w-3 text-muted-foreground" /> Current Readings — latest raw meter value per entity per day (absolute, not delta)</>
        )}
        <span className="ml-auto">
          {tab === 'both' && `${combinedProdPivot.dates.length} days in range`}
          {tab === 'consumption' && `${entities.length} locators · ${dates.length} days`}
          {tab === 'production' && (
            hasRoEntities && hasMeterEntities
              ? `${combinedProdPivot.entities.length} meters/trains · ${combinedProdPivot.dates.length} days`
              : hasRoEntities
                ? `${combinedProdPivot.entities.length} RO trains · ${combinedProdPivot.dates.length} days`
                : `${combinedProdPivot.entities.length} meters · ${combinedProdPivot.dates.length} days`
          )}
          {tab === 'current' && `${currentPivotData.entities.length} entities · ${currentPivotData.dates.length} days`}
        </span>
      </div>

      {/* ── TEMPORARY DIAGNOSTIC ─────────────────────────────────────────────
          Shows exactly what this modal fetched from plant_meter_config, so we
          can confirm whether a saved production-source change is actually
          reaching this query or not, instead of guessing. Safe to delete once
          the Mambaling RO-permeate issue is root-caused. */}
      {tab === 'production' && (
        <div className="px-4 py-1.5 text-2xs font-mono text-muted-foreground bg-warn-soft/40 border-t border-warn/30 break-all">
          DEBUG plant_meter_config rows fetched for {plantIds.length} plant id(s) [{plantIds.join(', ')}]:{' '}
          {configLoading
            ? 'loading…'
            : (modalMeterConfigs ?? []).length === 0
              ? 'ZERO ROWS RETURNED — either no config row exists for this plant yet, or an RLS policy is silently blocking the read (Supabase returns [] on a blocked SELECT, not an error)'
              : (modalMeterConfigs ?? []).map((c: any) =>
                  `[plant_id=${c.plant_id}] column permeate_is_production=${String(c.permeate_is_production)} · config.permeate_is_production=${String(c.config?.permeate_is_production)} · config.ro_production_source=${String(c.config?.ro_production_source)}`,
                ).join('   |   ')}
        </div>
      )}
    </>
  );
}
