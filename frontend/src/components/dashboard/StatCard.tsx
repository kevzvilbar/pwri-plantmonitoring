import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/StatusPill';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { StatTone, TONE_BG, TONE_ICON } from './types';

// ── Geometric sans-serif for KPI numbers — matches the Solar/Grid/Total cards ──
// DM Sans is a low-contrast geometric sans with perfectly circular bowls,
// identical stroke weight, and clean tabular figures. This is the same
// typeface used by the energy cluster cards.
const GEO_FONT = "'DM Sans', 'Outfit', ui-sans-serif, system-ui, sans-serif";

// Inject the Google Font link once into <head> (no-op if already present).
function useDMSans() {
  useEffect(() => {
    const id = 'dm-sans-link';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap';
    document.head.appendChild(link);
  }, []);
}

// Tiny up/down/flat arrow with percent label — shown BELOW the value.
// Renders nothing when `delta` is null or non-finite.
export function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null || !Number.isFinite(delta)) return null;
  const abs = Math.abs(delta);
  const Icon = abs < 0.5 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const cls = abs < 0.5
    ? 'text-muted-foreground'
    : delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${cls}`} title="vs previous day">
      <Icon className="h-3.5 w-3.5" />
      {abs < 0.5 ? '0%' : `${abs.toFixed(0)}% vs prev day`}
    </span>
  );
}

// Per-train (or per-entity) breakdown row type.
// `value` is null when the entity has no reading for this metric.
export type ExpandRow = { label: string; value: string | number | null };

// Standard KPI tile used across the dashboard clusters. Tone drives
// the gradient background + the StatusPill. `calc` swaps in a sky
// gradient + adds a "calc" pill so derived metrics (NRW, PV) read
// distinctly from raw measurements.
//
// When `expandRows` is supplied (≥2 rows with non-null values) the card
// gains a chevron toggle in the top-right corner. The breakdown list is
// hidden by default so the tile stays compact — the user opts in by clicking.
export function StatCard({
  icon: Icon, label, value, unit, tone, onClick, accent, calc, threshold,
  size = 'default', trend = null, calcTooltip,
  expandRows, expandUnit,
}: {
  icon: any; label: string; value: any; unit?: string;
  tone?: StatTone; onClick?: () => void; accent?: string;
  calc?: boolean; threshold?: string;
  size?: 'default' | 'lg';
  trend?: number | null;
  calcTooltip?: string;
  // Optional per-train breakdown revealed by a chevron toggle (hidden by default).
  expandRows?: ExpandRow[];
  // Unit appended to each row value; defaults to the card's own `unit`.
  expandUnit?: string;
}) {
  useDMSans();
  const [expanded, setExpanded] = useState(false);

  const liveRows    = (expandRows ?? []).filter((r) => r.value != null);
  const showExpand  = liveRows.length >= 2;
  const rowUnit     = expandUnit ?? unit ?? '';

  const lg      = size === 'lg';
  const toneBg  = tone ? TONE_BG[tone] : 'stat-tone-default';
  const calcBg  = !tone && calc ? 'stat-tone-info' : '';
  const baseBg  = '';
  const iconCls = tone ? TONE_ICON[tone] : (accent ?? 'text-muted-foreground');

  return (
    <Card
      className={`stat-card min-w-0 hover:border-primary/40 hover:shadow-sm transition-all ${onClick ? 'cursor-pointer' : 'cursor-default'} ${lg ? 'p-3.5' : 'p-3'} ${baseBg} ${toneBg} ${calcBg}`}
      onClick={onClick}
    >
      {/* ── Header row: icon · LABEL (uppercase) · badges/expand ── */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <Icon className={`shrink-0 ${lg ? 'h-4 w-4' : 'h-3.5 w-3.5'} ${iconCls}`} />
          <span className={`uppercase tracking-wide font-semibold truncate leading-none ${lg ? 'text-[11px]' : 'text-[10px]'} ${tone ? iconCls : 'text-muted-foreground'}`}>
            {label}
          </span>
          {threshold && (
            <span className="text-[9px] text-muted-foreground/60 shrink-0">(limit {threshold})</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {calc && (
            <span
              className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/40 dark:text-sky-200"
              title={calcTooltip ?? 'Calculated / derived metric'}
            >calc</span>
          )}
          {tone && <StatusPill tone={tone}>•</StatusPill>}
          {showExpand && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? 'Hide breakdown' : 'Show per-train breakdown'}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Value row ── */}
      <div
        className={`mt-2 text-foreground leading-none whitespace-nowrap overflow-hidden text-ellipsis ${lg ? 'text-2xl sm:text-3xl font-bold' : 'text-2xl font-bold'}`}
        style={{ fontFamily: GEO_FONT, fontFeatureSettings: '"tnum"' }}
      >
        {value}
        {unit && <span className={`font-sans font-normal text-muted-foreground ml-1 ${lg ? 'text-sm' : 'text-xs'}`}>{unit}</span>}
      </div>

      {/* ── Below-value: trend badge (matches Image 1 "↑ 1.4% vs prev day") ── */}
      {trend !== null && trend !== undefined && (
        <div className="mt-1">
          <TrendBadge delta={trend} />
        </div>
      )}

      {/* ── Per-train expand rows ── */}
      {showExpand && expanded && (
        <div className="mt-2 pt-1.5 border-t space-y-0.5 max-h-24 overflow-y-auto">
          {liveRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground truncate">{row.label}</span>
              <span className="text-foreground/90 tabular-nums shrink-0 ml-2" style={{ fontFamily: GEO_FONT }}>
                {row.value}
                {rowUnit && <span className="text-muted-foreground ml-0.5">{rowUnit}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Quality-cluster card that surfaces an aggregate Raw value at the top
// and renders a compact per-train breakdown beneath. Used for Raw TDS
// and Raw NTU.
//
// Note on schema: Raw TDS / NTU are physically measured at the RO-feed
// inlet (the manifold that BLENDS multiple well sources into a single
// feed line), not at each individual well. So each row in the breakdown
// represents one RO train line. The label uses the train's exact name
// from ro_trains.name rather than the synthetic "Source N" label.
// The breakdown is hidden by default — the user expands it via the
// chevron toggle. When fewer than 2 trains have data the toggle is
// suppressed entirely.
export function PerWellSourceCard({
  icon: Icon, label, unit, aggregate, rows, field, plantCodeById,
  testId, decimals = 0, multiPlant = false,
}: {
  icon: any;
  label: string;
  unit: string;
  aggregate: number | null | undefined;
  rows: any[];
  /** 'tds_ppm' is used when rows come from well_readings (per-well source cards). */
  field: 'feed_tds' | 'tds_ppm' | 'turbidity_ntu' | 'permeate_tds';
  plantCodeById: Map<string, string>;
  testId: string;
  decimals?: number;
  // When true (multiple plants selected) prefixes each row with the plant
  // code so the user can tell which plant each train belongs to.
  multiPlant?: boolean;
}) {
  useDMSans();
  const [expanded, setExpanded] = useState(false);

  // Filter out rows with no reading for this metric — they'd render as
  // "—" and add noise to a list whose whole purpose is to show numbers.
  const liveRows     = rows.filter((r) => r[field] != null);
  const showBreakdown = liveRows.length >= 2;

  // Train label: use exact train name when available, fall back to
  // "Train N". Prefix with plant code only when multiple plants are
  // selected so rows from different plants are unambiguous.
  const rowLabel = (r: any) => {
    const trainName = r.train_name ?? (r.train_number != null ? `Train ${r.train_number}` : '?');
    if (multiPlant) {
      const code = plantCodeById.get(r.plant_id) ?? '';
      return code ? `${code} · ${trainName}` : trainName;
    }
    return trainName;
  };

  return (
    <Card
      className="stat-card min-w-0 hover:border-primary/40 hover:shadow-sm transition-all p-3 bg-gradient-to-br from-card to-card/60"
      data-testid={testId}
    >
      {/* ── Header: icon · LABEL (uppercase) · per-well badge + expand ── */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <Icon className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
          <span className="uppercase tracking-wide font-semibold truncate leading-none text-[10px] text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted/60 text-muted-foreground"
            title="Raw water characteristics measured at the RO feed manifold (per RO train)"
          >
            per well source
          </span>
          {showBreakdown && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? 'Hide breakdown' : 'Show per-train breakdown'}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Value ── */}
      <div className="mt-2 text-foreground leading-none whitespace-nowrap text-2xl font-bold" style={{ fontFamily: GEO_FONT, fontFeatureSettings: '"tnum"' }}>
        {aggregate ?? '—'}
        {unit && <span className="font-sans font-normal text-muted-foreground ml-1 text-xs">{unit}</span>}
      </div>

      {/* ── Expand rows ── */}
      {showBreakdown && expanded && (
        <div className="mt-2 pt-1.5 border-t space-y-0.5 max-h-24 overflow-y-auto">
          {liveRows.map((r) => (
            <div
              key={`${r.plant_id}-${r.well_id ?? r.train_id ?? r.train_number}`}
              className="flex items-center justify-between text-[10px]"
            >
              <span className="text-muted-foreground truncate">{rowLabel(r)}</span>
              <span className="text-foreground/90 tabular-nums shrink-0 ml-2" style={{ fontFamily: GEO_FONT }}>
                {decimals === 0 ? Math.round(r[field]) : (+r[field]).toFixed(decimals)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Section heading shared between the three clusters (Overview /
// Quality / Production Cost). Kept tiny on purpose — the cluster
// header is meant to be glance-able, not a focal element.
export function ClusterHeader({
  icon: Icon, title, subtitle, accent,
}: {
  icon: any; title: string; subtitle?: string; accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mt-1 mb-2 px-0.5">
      <div className={`h-3.5 w-[3px] rounded-full shrink-0 ${accent ?? 'bg-muted-foreground/30'}`}
        style={{ background: accent?.startsWith('#') ? accent : undefined }} />
      <Icon className={`h-3.5 w-3.5 ${accent ?? 'text-muted-foreground'}`} />
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {subtitle && <span className="text-[10px] text-muted-foreground/70">{subtitle}</span>}
    </div>
  );
}
