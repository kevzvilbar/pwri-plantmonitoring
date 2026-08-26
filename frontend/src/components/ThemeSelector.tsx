/**
 * ThemeSelector
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a compact swatch grid letting the user switch between the curated
 * color palettes defined in lib/themes.ts.
 *
 * Appearance: a Palette icon button that opens a Popover with a grid of
 * labeled swatches.  The selected theme gets a ring outline.
 *
 * Usage: drop <ThemeSelector /> anywhere in the chrome (TopBar, Profile page,
 * sidebar footer, etc.).
 */

import { Palette, Check, Moon } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { COLOR_THEMES } from '@/lib/themes';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function ThemeSelector() {
  const { colorTheme, setColorTheme, darkMode, setDarkMode } = useAppStore();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          // Matches the 40px hit area used for Bell/SyncIndicator — see TopBar.tsx.
          className="h-10 w-10 text-topbar-foreground/70 hover:text-topbar-foreground hover:bg-white/10"
          aria-label="Choose color theme"
          title="Color theme"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 p-4 shadow-[var(--shadow-modal)]"
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Color Theme
        </p>

        <div className="grid grid-cols-1 gap-2">
          {COLOR_THEMES.map((theme) => {
            const active = colorTheme === theme.id;
            const [sidebarSwatch, primarySwatch, accentSwatch, bgSwatch] =
              theme.swatches;

            return (
              <button
                key={theme.id}
                onClick={() => setColorTheme(theme.id)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left',
                  'transition-all duration-150',
                  active
                    ? 'border-primary bg-primary-soft shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]'
                    : 'border-border hover:border-primary/40 hover:bg-muted/60',
                )}
              >
                {/* Swatch row */}
                <span className="flex shrink-0 overflow-hidden rounded-md shadow-sm" aria-hidden>
                  {[sidebarSwatch, primarySwatch, accentSwatch, bgSwatch].map(
                    (color, i) => (
                      <span
                        key={i}
                        className="h-6 w-6"
                        style={{ background: color }}
                      />
                    ),
                  )}
                </span>

                {/* Label */}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium leading-tight text-foreground">
                    {theme.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {theme.description}
                  </span>
                </span>

                {/* Active check */}
                {active && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t pt-3">
          {/* eslint-disable-next-line jsx-a11y/label-has-associated-control --
              Switch (Radix) renders a button[role=switch], not a native
              input/select/textarea, so eslint's control-recognition doesn't
              see it as "associated" even though it's nested inside this
              label. It already has its own aria-label below; wrapping it in
              a native <label> is the standard WAI-ARIA switch pattern purely
              for click-target delegation (clicking "Dark Mode" toggles it),
              not for the accessible name. */}
          <label className="flex items-center justify-between gap-2 text-sm cursor-pointer">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Moon className="h-3.5 w-3.5 text-muted-foreground" />
              Dark Mode
            </span>
            <Switch
              checked={darkMode}
              onCheckedChange={setDarkMode}
              aria-label="Toggle dark mode"
            />
          </label>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Newer than the color themes above — most of the app adapts
            automatically, but a few spots may not have caught up yet.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
