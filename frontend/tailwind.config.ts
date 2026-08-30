import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      // Compact type scale for dense data tables/badges (RO train readings,
      // meter config grids, KPI badges) — text-xs (12px) is too large for a
      // lot of that chrome. These two tokens cover it.
      //
      // This comment previously said ~16 one-off text-[Npx] values (7-11.5px)
      // still needed migrating to these tokens; that's now done (verified via
      // repo-wide search — see scripts/check-arbitrary-font-sizes.mjs, which
      // enforces this staying true). The handful of remaining text-[Npx]
      // usages in the codebase are deliberate, not debt, and are NOT part of
      // this scale: components/manual/bookPrimitives.tsx uses its own serif
      // reading-type system (see the book-heading/book-body comment below),
      // components/OdometerRollerInput.tsx's larger digit sizes are a
      // separate readability choice for that control, and the text-[0px] in
      // pages/plants/index.tsx is a responsive label-collapse trick, not a
      // font size at all (each is commented in place explaining why).
      fontSize: {
        '3xs': ['9px', { lineHeight: '12px' }],
        '2xs': ['10px', { lineHeight: '13px' }],
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        // Technical mono numerals with tabular figures for all readings & KPI readouts
        numeral: ['"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        // Reading-optimized serif pairing used only by the full-screen Manual reader
        'book-heading': ['Cormorant Garamond', 'Georgia', 'serif'],
        'book-body': ['Libre Baskerville', 'Georgia', 'serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          soft: "hsl(var(--primary-soft))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          soft: "hsl(var(--accent-soft))",
        },
        warn: {
          DEFAULT: "hsl(var(--warn))",
          foreground: "hsl(var(--warn-foreground))",
          soft: "hsl(var(--warn-soft))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
          soft: "hsl(var(--danger-soft))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
        },
        highlight: {
          DEFAULT: "hsl(var(--highlight))",
          foreground: "hsl(var(--highlight-foreground))",
          soft: "hsl(var(--highlight-soft))",
        },
        // KPI / data-series palette (see index.css "Design System v2" comment
        // for the color language). Previously only available as the seven
        // fixed `.kpi-*` border-top-color helper classes in index.css —
        // registering them here makes them usable as normal bg-/text-/
        // border- utilities anywhere, which is what most components
        // actually need.
        kpi: {
          wells:   "hsl(var(--kpi-wells))",
          locator: "hsl(var(--kpi-locator))",
          ro:      "hsl(var(--kpi-ro))",
          meter:   "hsl(var(--kpi-meter))",
          solar:   "hsl(var(--kpi-solar))",
          grid:    "hsl(var(--kpi-grid))",
          chem:    "hsl(var(--kpi-chem))",
        },
        // Digital-readout housing (PowerMeters.tsx multiplier display) —
        // deliberately dark-always, not part of the light/dark surface set.
        display: {
          DEFAULT: "hsl(var(--display))",
          border: "hsl(var(--display-border))",
          dim: "hsl(var(--display-dim))",
        },
        // CIP chemical identity accents (see index.css for rationale).
        chem: {
          caustic: "hsl(var(--chem-caustic))",
          hcl: "hsl(var(--chem-hcl))",
          sls: "hsl(var(--chem-sls))",
          custom: "hsl(var(--chem-custom))",
        },
        // User role identity accents (UsersPanel avatar badges).
        role: {
          admin: "hsl(var(--role-admin))",
          analyst: "hsl(var(--role-analyst))",
          manager: "hsl(var(--role-manager))",
          technician: "hsl(var(--role-technician))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        topbar: {
          DEFAULT: "hsl(var(--topbar))",
          foreground: "hsl(var(--topbar-foreground))",
          muted: "hsl(var(--topbar-muted))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        elev: "var(--shadow-elev)",
        modal: "var(--shadow-modal)",
      },
      backgroundImage: {
        'gradient-stat': "var(--gradient-stat)",
        'gradient-accent': "var(--gradient-accent)",
        'gradient-highlight': "var(--gradient-highlight)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-up":   { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in":   { from: { opacity: "0", transform: "scale(0.97)" }, to: { opacity: "1", transform: "scale(1)" } },
        "slide-in-right": { from: { opacity: "0", transform: "translateX(8px)" }, to: { opacity: "1", transform: "translateX(0)" } },
        // Bell shake — used by TopBar when there are critical alerts
        "ring": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "10%, 30%":  { transform: "rotate(-12deg)" },
          "20%, 40%":  { transform: "rotate(12deg)" },
          "50%":       { transform: "rotate(0deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 200ms ease-out",
        "slide-up":  "slide-up 250ms cubic-bezier(0.22,1,0.36,1)",
        "scale-in":  "scale-in 180ms ease-out",
        "slide-in-right": "slide-in-right 200ms ease-out",
        "ring": "ring 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
