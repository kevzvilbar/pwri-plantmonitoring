import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
// ─── Hybrid Strategy: Backend + Frontend Delta Handling ───────────────────────
// Plants.tsx owns recomputePermeateDeltas — the authoritative DB write for
// permeate_meter_delta.  After each successful UPDATE we also call
// deltaCache.set() so the Dashboard and TrendChart immediately use the
// recomputed value without waiting for a refetch (Tier-1 shortcut path).
// When is_meter_replacement is toggled we call deltaCache.invalidate(trainId)
// to force a Tier-2 raw recompute on the next render.
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { format } from 'date-fns';


// Shared constants, helpers, and PlantMeterConfig types for the plants/ split.
// Any plants/ sub-file that needs these utilities imports from '../shared'.

export const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';

// ─── Chemical master list (mirrors ROTrains.tsx KNOWN_CHEMICALS) ─────────────
// Managers configure which chemicals are applicable per plant in Plant Configuration.
// ROTrains → Chemical Dosing hides chemicals not in the enabled list.
// CIP-only chemicals (HCl, SLS, Caustic Soda) are intentionally excluded —
// they are consistent across all plants and managed exclusively in the CIP tab.
export const PLANT_CHEMICALS = [
  { name: 'Chlorine',     defaultUnit: 'kg' },
  { name: 'SMBS',         defaultUnit: 'kg' },
  { name: 'Anti Scalant', defaultUnit: 'L'  },
  { name: 'Soda Ash',     defaultUnit: 'kg' },
];

// ─── SummaryCount pill ───────────────────────────────────────────────────────
// Renders "active/total" — active count in primary color, total in muted.
// If all active: green accent. If any inactive: amber warning.

// ─── Grid Pylon Icon ─────────────────────────────────────────────────────────
// High-voltage transmission tower — used everywhere "Grid" energy source appears.
export function GridPylonIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* Base platform */}
      <line x1="4" y1="22" x2="20" y2="22" />
      {/* Left & right legs */}
      <line x1="8" y1="22" x2="10" y2="14" />
      <line x1="16" y1="22" x2="14" y2="14" />
      {/* Lower cross-brace */}
      <line x1="8" y1="22" x2="14" y2="14" />
      <line x1="16" y1="22" x2="10" y2="14" />
      {/* Tower body */}
      <line x1="10" y1="14" x2="11" y2="8" />
      <line x1="14" y1="14" x2="13" y2="8" />
      {/* Mid cross-brace */}
      <line x1="10" y1="14" x2="13" y2="8" />
      <line x1="14" y1="14" x2="11" y2="8" />
      {/* Upper narrowing */}
      <line x1="11" y1="8" x2="11.8" y2="4" />
      <line x1="13" y1="8" x2="12.2" y2="4" />
      {/* Top cross-brace */}
      <line x1="11" y1="8" x2="12.2" y2="4" />
      <line x1="13" y1="8" x2="11.8" y2="4" />
      {/* Top arm (crossbar) */}
      <line x1="7" y1="6" x2="17" y2="6" />
      <line x1="12" y1="4" x2="12" y2="6" />
      {/* Insulator drop lines */}
      <line x1="7" y1="6" x2="7" y2="8" />
      <line x1="17" y1="6" x2="17" y2="8" />
    </svg>
  );
}

export function SummaryCount({ label }: { label: string }) {
  const [active, total] = label.split('/').map(Number);
  const allActive = active === total && total > 0;
  const noneActive = active === 0;
  const color = allActive
    ? 'text-emerald-600 dark:text-emerald-400'
    : noneActive && total > 0
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground';
  return (
    <div className={`font-mono-num text-sm font-medium ${color}`}>
      {active}
      <span className="text-muted-foreground font-normal">/{total}</span>
    </div>
  );
}

// ─── Entity status change audit logger ───────────────────────────────────────
// Called whenever a Well, Locator, or RO Train flips Active ↔ Inactive.

async function logStatusChange(entry: {
  user_id: string | null;
  plant_id: string;
  entity_type: 'Well' | 'Locator' | 'RO Train';
  entity_id: string;
  entity_label: string;
  from_status: string;
  to_status: string;
  timestamp: string;
}) {
  try {
    await (supabase.from('entity_status_audit_log' as any) as any).insert([entry]);
  } catch {
    // Table may not exist yet — silently ignore.
  }
}

// ─── Plant field-level audit logger ──────────────────────────────────────────
// Logs name / address / capacity edits to plant_edit_audit_log.
// Best-effort: silently ignored if table doesn't exist yet.
async function logPlantEdit(entry: {
  plant_id: string;
  user_id: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}) {
  try {
    await (supabase.from('plant_edit_audit_log' as any) as any).insert([entry]);
  } catch {
    // Table may not exist yet — silently ignore.
  }
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-1 py-2 hover:bg-muted/30 rounded-md transition-colors text-left group"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}


/** A single continuous window in which the permeate meter counts as production. */
export interface PermeateProductionPeriod {
  /** Client-only stable key for React lists — never persisted. */
  id: string;
  /** YYYY-MM-DD inclusive start; null = unbounded past. */
  start: string | null;
  /** YYYY-MM-DD inclusive end; null = ongoing / no end yet. */
  end: string | null;
}

export interface PlantMeterConfig {
  // RO Train flow meters
  ro_has_feed_meter: boolean;
  ro_has_permeate_meter: boolean;
  ro_has_reject_meter: boolean;
  // RO production source
  ro_production_source: 'permeate' | 'product';
  // Per-train utility meters
  ro_has_per_train_electricity: boolean;
  ro_has_per_train_water: boolean;
  // Wells — electricity metering
  wells_shared_electric_groups: Array<{ id: string; name: string; members: string[] }>; // member = well id
  wells_dedicated_electric_ids: string[];   // well ids with dedicated meter
  wells_no_electric: boolean;
  // Locators — bulk/product metering
  locators_dedicated_bulk_ids: string[];    // locator ids with own bulk meter
  locators_shared_bulk_groups: Array<{ id: string; name: string; members: string[] }>;
  locators_no_bulk: boolean;
  // Energy sources (moved here from plants table but mirrored for backwards compat)
  has_solar: boolean;
  has_grid: boolean;
  solar_capacity_kw: number | null;
  // Power meter names and per-meter CT multipliers (from plant_power_config)
  solar_meter_count: number;
  solar_meter_names: string[];
  grid_meter_count: number;
  grid_meter_names: string[];
  /** Per-grid-meter CT multiplier. Index matches grid_meter_names. Defaults to 1 when absent. */
  grid_meter_multipliers: number[];
  // Default solar input mode for Operations entry form
  default_solar_input_mode: 'raw' | 'direct';
  // NRW / product distribution
  nrw_enabled: boolean;
  has_billed_volume_meter: boolean;
  // Permeate meter = daily production (no bulk/mother meter)
  // When true, permeate readings are hourly but grouped into days using cut-off time.
  // Multiple non-overlapping periods are supported — e.g. permeate used → product meter
  // installed → product meter removed → permeate used again.
  permeate_is_production: boolean;
  // HH:mm cut-off time (24-hr). Day N runs from cutoff on day N-1 (exclusive)
  // to cutoff on day N (inclusive). Stored reading is labelled as day N.
  // Example: cutoff "00:20" → May 3 00:21 … May 4 00:20 = "May 4" production.
  permeate_cutoff_time: string; // e.g. "00:20"
  // When false, new entries are NOT shifted by the cut-off (natural calendar date used).
  // Historical data still groups using the saved cut-off time for consistency.
  permeate_cutoff_enabled: boolean;
  // List of non-overlapping date ranges during which permeate meter counts as production.
  // start/end are YYYY-MM-DD; null start = unbounded past; null end = ongoing.
  // Readings outside ALL active periods are pushed to the nearest day boundary:
  //   before the earliest period start → attributed to the day before that start
  //   after a period's end → attributed to the day after that end
  permeate_production_periods: PermeateProductionPeriod[];
  // Chemicals enabled for this plant — only these appear in RO Trains → Chemical Dosing.
  // Default: all chemicals enabled (empty array = all shown for backwards compat).
  enabled_chemicals: string[]; // chemical names from KNOWN_CHEMICALS
  // Locator meter readings allowed per day (manager-configurable, default 3).
  // Operators can submit up to this many readings per locator per calendar day.
  locator_readings_per_day: number;
  // CIP chemicals — the chemicals available in the CIP tab of RO Trains.
  // Built-in defaults: Caustic Soda (kg), HCl (L), SLS (g).
  // Managers can add custom chemicals; any entry maps to DB columns for the
  // 3 built-ins and serialises into the remarks field for custom ones.
  cip_chemicals: Array<{ name: string; unit: string }>;
}

export const DEFAULT_METER_CONFIG: PlantMeterConfig = {
  ro_has_feed_meter: true,
  ro_has_permeate_meter: true,
  ro_has_reject_meter: true,
  ro_production_source: 'product',
  ro_has_per_train_electricity: false,
  ro_has_per_train_water: false,
  wells_shared_electric_groups: [],
  wells_dedicated_electric_ids: [],
  wells_no_electric: false,
  locators_dedicated_bulk_ids: [],
  locators_shared_bulk_groups: [],
  locators_no_bulk: false,
  has_solar: false,
  has_grid: true,
  solar_capacity_kw: null,
  solar_meter_count: 1,
  solar_meter_names: [],
  grid_meter_count: 1,
  grid_meter_names: [],
  grid_meter_multipliers: [],
  default_solar_input_mode: 'raw',
  nrw_enabled: false,
  has_billed_volume_meter: false,
  permeate_is_production: false,
  permeate_cutoff_time: '00:20',
  permeate_cutoff_enabled: true,
  permeate_production_periods: [],
  enabled_chemicals: [], // empty = all chemicals visible (backwards compat)
  locator_readings_per_day: 3,
  cip_chemicals: [
    { name: 'Caustic Soda', unit: 'kg' },
    { name: 'HCl',          unit: 'L'  },
    { name: 'SLS',          unit: 'g'  },
  ],
};

export const METER_CONFIG_LS = (plantId: string) => `plant_meter_config_${plantId}`;

/**
 * One-time forward migration: if a stored config still has the old scalar
 * `permeate_production_start` / `permeate_production_end` fields but is missing
 * the new `permeate_production_periods` array, lift them into the array shape.
 * Safe to run on already-migrated configs (no-op when periods array already present).
 */
export function migrateMeterConfig(cfg: Record<string, unknown>): PlantMeterConfig {
  if (!Array.isArray(cfg.permeate_production_periods)) {
    const start = (cfg.permeate_production_start as string | null) ?? null;
    const end   = (cfg.permeate_production_end   as string | null) ?? null;
    cfg = {
      ...cfg,
      permeate_production_periods: (start !== null || end !== null)
        ? [{ id: crypto.randomUUID(), start, end }]
        : [],
    };
  }
  return cfg as unknown as PlantMeterConfig;
}

export function usePlantMeterConfig(plantId: string | null | undefined) {
  const qc = useQueryClient();

  const { data: config, isLoading } = useQuery<PlantMeterConfig>({
    queryKey: ['plant-meter-config', plantId],
    enabled: !!plantId,
    staleTime: 30_000,
    queryFn: async () => {
      // Try DB first
      try {
        const { data, error } = await (supabase.from('plant_meter_config' as any) as any)
          .select('config')
          .eq('plant_id', plantId)
          .maybeSingle();
        if (!error && data?.config) {
          return migrateMeterConfig({ ...DEFAULT_METER_CONFIG, ...data.config }) as PlantMeterConfig;
        }
      } catch { /* table may not exist yet */ }
      // Fall back to localStorage
      try {
        const raw = localStorage.getItem(METER_CONFIG_LS(plantId!));
        if (raw) return migrateMeterConfig({ ...DEFAULT_METER_CONFIG, ...JSON.parse(raw) }) as PlantMeterConfig;
      } catch { /* ignore */ }
      return DEFAULT_METER_CONFIG;
    },
  });

  const saveConfig = async (next: PlantMeterConfig) => {
    let savedToDb = false;
    try {
      const { error } = await (supabase.from('plant_meter_config' as any) as any)
        .upsert({ plant_id: plantId, config: next, updated_at: new Date().toISOString() }, { onConflict: 'plant_id' });
      if (!error) savedToDb = true;
    } catch { /* table missing */ }
    try { localStorage.setItem(METER_CONFIG_LS(plantId!), JSON.stringify(next)); } catch { /* ignore */ }
    qc.setQueryData(['plant-meter-config', plantId], next);
    qc.invalidateQueries({ queryKey: ['plant-meter-config', plantId] });
    // Propagate config change to Dashboard, TrendChart, and DataSummaryModal immediately.
    // permeate_is_production toggling changes which source powers the Production stat card
    // and the DataSummaryModal Production tab — all three must re-read the updated config.
    qc.invalidateQueries({ queryKey: ['dash-plant-meter-configs'] });
    qc.invalidateQueries({ queryKey: ['plant-meter-config-permeate'] });
    qc.invalidateQueries({ queryKey: ['dsm-meter-configs'] });
    qc.invalidateQueries({ queryKey: ['trend-ro'] });
    qc.invalidateQueries({ queryKey: ['trend-product'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-today'] });
    qc.invalidateQueries({ queryKey: ['dash-ro-permeate-yest'] });
    qc.invalidateQueries();
    return savedToDb;
  };

  return { config: config ?? DEFAULT_METER_CONFIG, isLoading, saveConfig };
}

// ─── CIP Chemicals Section ────────────────────────────────────────────────────
// Renders inside PlantMeterConfigCard. Shows the chemicals available in the CIP
// tab. Managers can add custom chemicals or remove any entry. The 3 built-in
// chemicals (Caustic Soda, HCl, SLS) are visually distinguished but can also be
// removed if a plant doesn't use them.

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Handle quoted fields containing commas
    const vals: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

export function downloadTemplate(filename: string, headers: string[]) {
  const blob = new Blob([headers.join(',') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export function CsvPreviewTable({ rows, headers }: { rows: Record<string, string>[]; headers: string[] }) {
  if (!rows.length) return null;
  // Fixed column width — wide enough to read, narrow enough to scroll cleanly
  const colW = 120;
  return (
    <div className="rounded border overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-44" style={{ fontSize: 11 }}>
        <table className="table-fixed text-left w-max" style={{ minWidth: headers.length * colW }}>
          <thead className="bg-muted/80 sticky top-0 z-10">
            <tr>
              {headers.map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap border-b"
                    style={{ width: colW, minWidth: colW }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                {headers.map(h => (
                  <td key={h} className="px-2 py-1 truncate border-b border-border/40"
                      style={{ width: colW, maxWidth: colW }} title={row[h] ?? ''}>
                    {row[h] ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <p className="text-xs text-muted-foreground px-2 py-1 bg-muted/30 border-t">
          …and {rows.length - 10} more rows
        </p>
      )}
    </div>
  );
}

// ─── Locator CSV Import ───────────────────────────────────────────────────────

