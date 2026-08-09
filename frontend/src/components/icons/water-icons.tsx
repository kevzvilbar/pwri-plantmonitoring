/**
 * Domain icon set for water-treatment / RO-plant concepts that lucide-react
 * doesn't model precisely (RO train, permeate/reject streams, derived meters,
 * meter replacement, etc).
 *
 * Scope: this is a deliberately small starter set, not the full 24-icon
 * taxonomy from the original design spec. It covers the concepts where a
 * generic lucide icon was either standing in ambiguously (Wrench used for
 * both "Maintenance" and "Replace Meter") or missing outright (no icon
 * existed for "this is a derived/estimated reading"). See
 * ICON_INTEGRATION_PLAN.md for the full taxonomy and rollout plan.
 *
 * Design rules (deliberately reusing the app's existing tokens, not the
 * standalone hex palette from the original spec doc):
 *   - Outline uses `currentColor` (stroke), exactly like lucide, so existing
 *     `text-*` utility classes keep working unchanged (text-primary,
 *     text-muted-foreground, etc). This is what makes these drop-in
 *     replacements rather than a second icon system to theme separately.
 *   - Accent fills use the app's existing `-soft` tokens (bg-info-soft
 *     equivalent, applied here as fill-info/25 etc.) rather than new
 *     hardcoded hex — confirmed these opacity modifiers already work
 *     throughout the app (see PowerMeters.tsx, MigrationsPanel.tsx).
 *   - 24x24 viewBox, 2px stroke, round caps/joins — matches lucide's own
 *     defaults, so mixing these with lucide icons in the same row doesn't
 *     look mismatched.
 *   - Same prop shape as lucide-react icons (className + size), so callsites
 *     swap in with a one-line import change.
 */
import * as React from 'react';

export interface WaterIconProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel size for both width and height. Defaults to 24, same as lucide. */
  size?: number | string;
}

function baseProps(size: number | string | undefined, props: WaterIconProps) {
  const { className, ...rest } = props;
  return {
    width: size ?? 24,
    height: size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    ...rest,
  };
}

/** Meter replacement / "Change Meter" action — was previously the same
 * Wrench icon used for Maintenance, which conflated two different actions
 * (ProductMeters.tsx, PowerMeters.tsx "Replace Meter" buttons). */
export const ChangeMeterIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <circle cx="12" cy="13" r="6" />
    <path d="M12 10.5v2.5l1.8 1.8" />
    <path d="M6.5 8A8.1 8.1 0 0 1 9.8 5.4" fill="none" />
    <path d="M17.5 18a8.1 8.1 0 0 1-3.3 2.6" fill="none" />
    <path d="M9 4.5 9.8 5.4 8.6 6.8" />
    <path d="M15 21.5 14.2 20.6 15.4 19.2" />
  </svg>
);

/** Multi-stage RO train — linked membrane blocks. Used for RO Train tab /
 * headers where "Droplet" or "Gauge" were previously standing in generically. */
export const ROTrainIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <rect x="2" y="8" width="7" height="8" rx="1.5" className="fill-info/20" />
    <rect x="11" y="8" width="7" height="8" rx="1.5" className="fill-info/20" />
    <path d="M9 12h2" />
    <path d="M18 12h2.5" />
    <path d="M4.5 8V6M6.5 8V6M4.5 18v-2M6.5 18v-2" />
    <path d="M13.5 8V6M15.5 8V6M13.5 18v-2M15.5 18v-2" />
  </svg>
);

/** Permeate — clean product water exiting a channel. */
export const PermeateIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M12 3.5c2.6 3.2 4.3 5.9 4.3 8.3a4.3 4.3 0 1 1-8.6 0c0-2.4 1.7-5.1 4.3-8.3Z" className="fill-info/25" />
    <path d="M17.5 15.5h3.5" />
    <path d="M17.5 18.5h2" />
  </svg>
);

/** Reject / concentrate stream. Deliberately neutral slate, not amber/warn —
 * a reject stream is a normal, expected process path, not a warning state,
 * and reusing the warn token here would visually cue "something's wrong"
 * every time a train is simply running normally. */
export const RejectIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M5 4h6l5 7-5 9H5l5-9-5-7Z" className="fill-muted-foreground/15" />
    <path d="M14 20h5" />
    <path d="M16.5 17.5 19 20l-2.5 2.5" />
  </svg>
);

/** Derived / estimated reading — for locators like the Hamas case that don't
 * have a physical meter yet and are computed via the residual sweep. Renders
 * as a dashed-gauge to visually distinguish from a real, directly-read meter. */
export const DerivedMeterIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M4 15a8 8 0 0 1 16 0" strokeDasharray="2.5 2.5" />
    <path d="M12 15V10" />
    <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    <path d="M9 19h6" />
  </svg>
);

/** Chemicals / CIP dosing — dual flasks. */
export const ChemicalsIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M9.5 3h3" />
    <path d="M10 3v5.5L6.3 16a2 2 0 0 0 1.8 2.9h7.8a2 2 0 0 0 1.8-2.9L14 8.5V3" className="fill-warn/20" />
    <path d="M8 14h8" />
  </svg>
);

/** Pressure gauge — feed / inter-stage / brine pressure. */
export const PressureGaugeIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <circle cx="12" cy="13" r="7.5" className="fill-info/15" />
    <path d="M12 13 15.2 9.3" />
    <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    <path d="M9 3.5h6" />
    <path d="M12 3.5V6" />
  </svg>
);

/** Cumulative meter / odometer — totalized volume. */
export const MeterOdometerIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <rect x="3" y="8" width="18" height="9" rx="2" className="fill-info/10" />
    <path d="M7 12v1M11 12v1M15 12v1M19 12v1" />
    <path d="M6 8V6.5A2.5 2.5 0 0 1 8.5 4h7A2.5 2.5 0 0 1 18 6.5V8" />
  </svg>
);

/** Raw / source water — untreated water still in the ground, before it
 * reaches any meter or treatment step. Distinct on purpose from Droplet
 * (lucide), which this app uses for finished/produced water — the two
 * were previously conflated (Dashboard's "Production Volume" and "Raw
 * Water" cards both rendered a plain Droplet, right next to each other). */
export const RawWaterIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M3.5 13.5h17" className="opacity-40" />
    <path d="M6 13.5V19a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19v-5.5" className="fill-info/15" />
    <path d="M9 13.5V9M15 13.5V9" className="opacity-40" />
    <path d="M11 20v-4a1 1 0 0 1 2 0v4" className="fill-info/25" />
  </svg>
);

/**
 * Grid Pylon — high-voltage transmission tower, used everywhere the "Grid"
 * power source appears (Wells, Power Meters, Plant Appearance/Energy config,
 * Reading History audit rows).
 *
 * This used to be defined twice — byte-for-byte identically — in
 * pages/plants/shared.tsx and pages/operations/shared.tsx (icon-audit
 * finding: duplicated component, not just duplicated meaning). Both files
 * now re-export this single definition instead of maintaining their own
 * copy. Kept on its own strokeWidth (1.6, not the app's usual 2) and a
 * plain `className` prop — matching its original call sites exactly — so
 * this consolidation doesn't change how a single existing icon renders.
 */
export function GridPylonIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
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

/**
 * Peso sign (₱) — nav/tab icon for Costs & Tariffs. Every actual currency
 * value in the app already renders with the ₱ glyph (BudgetTab, TrendChart,
 * CostSunburst, Dashboard, Costs.tsx, CIPLog.tsx all format amounts as
 * `₱${...}` — grepped, none use a literal $ for a value) except this one
 * spot: the nav icon itself was lucide's `DollarSign`, since lucide has no
 * peso glyph (it ships Dollar/Euro/Yen/Rupee/Ruble/Franc, no ₱). Drawn as a
 * P-bowl with a single crossbar — the same construction as the Unicode ₱
 * character — rather than reusing $'s S-curve, so it doesn't read as the
 * wrong currency at a glance.
 */
export const PesoSignIcon = ({ size, ...props }: WaterIconProps) => (
  <svg {...baseProps(size, props)}>
    <path d="M9 5v14" />
    <path d="M9 5h4a3.5 3.5 0 0 1 0 7H9" />
    <path d="M6 12.5h10" />
  </svg>
);
