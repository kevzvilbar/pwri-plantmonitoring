import * as React from 'react';

export interface LogomarkProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel size for both width and height. Defaults to 32. */
  size?: number | string;
}

/**
 * PWRI Monitoring brand mark.
 *
 * Replaces the previous og-image.png (a gradient droplet-with-wave icon —
 * the default "AI-generated water company logo," see redesign audit,
 * Aug 2026). Built from the same pressure-gauge-needle language already
 * established in water-icons.tsx's PressureGaugeIcon rather than a new,
 * unrelated visual system: an outer bezel ring, a needle, and a center
 * pivot, scaled up into a filled badge. The brand mark and the product's
 * own instrument iconography are now one shape family instead of two.
 *
 * Colors are drawn from --primary / --primary-glow / --primary-foreground
 * (see index.css) rather than hardcoded hex, so the mark re-skins
 * correctly across dark mode and all 7 selectable brand themes instead of
 * staying a fixed teal-cyan no matter what theme is active — the one thing
 * the static PNG could never do.
 */
export function Logomark({ size = 32, className, ...props }: LogomarkProps) {
  const gradientId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="PWRI Monitoring"
      {...props}
    >
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <circle
        cx="16"
        cy="17.5"
        r="8.5"
        stroke="hsl(var(--primary-foreground))"
        strokeOpacity="0.9"
        strokeWidth="2"
      />
      <path
        d="M16 17.5 20.4 12.3"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16" cy="17.5" r="1.7" fill="hsl(var(--primary-foreground))" />
      <defs>
        <linearGradient id={gradientId} x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--primary-glow))" />
        </linearGradient>
      </defs>
    </svg>
  );
}
