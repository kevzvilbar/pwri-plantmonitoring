import { Palette, Check, Moon, Sun } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { COLOR_THEMES } from '@/lib/themes';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function ThemeSelector() {
  const { colorTheme, setColorTheme, darkMode, setDarkMode } = useAppStore();

  const currentThemeObj = COLOR_THEMES.find(t => t.id === colorTheme) || COLOR_THEMES[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-topbar-foreground/70 hover:text-topbar-foreground hover:bg-white/10 relative"
          aria-label="Choose color theme"
          title="Theme & Appearance"
        >
          <Palette className="h-4 w-4" />
          <span
            className="absolute bottom-2 right-2 w-2 h-2 rounded-full border border-topbar"
            style={{ background: currentThemeObj.swatches[1] }}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 max-w-[94vw] p-4 rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl space-y-3.5"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary-soft flex items-center justify-center text-primary">
              <Palette className="h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Theme & Lighting</p>
              <p className="text-3xs text-muted-foreground">Select your workspace style</p>
            </div>
          </div>
          <span className="text-3xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
            {currentThemeObj.name}
          </span>
        </div>

        {/* Segmented Light / Dark Mode Toggle */}
        <div className="p-1 rounded-xl bg-muted/60 border border-border/50 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setDarkMode(false)}
            className={cn(
              'h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
              !darkMode
                ? 'bg-card text-foreground shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Sun className="h-3.5 w-3.5 text-amber-500" />
            <span>Light Mode</span>
          </button>
          <button
            type="button"
            onClick={() => setDarkMode(true)}
            className={cn(
              'h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all',
              darkMode
                ? 'bg-card text-foreground shadow-xs border border-border/80'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Moon className="h-3.5 w-3.5 text-sky-400" />
            <span>Dark Mode</span>
          </button>
        </div>

        {/* Color Palette Grid */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Color Palettes
          </p>
          <div className="grid grid-cols-2 gap-2">
            {COLOR_THEMES.map((theme) => {
              const active = colorTheme === theme.id;
              const [sidebarSwatch, primarySwatch, accentSwatch, bgSwatch] = theme.swatches;

              return (
                <button
                  key={theme.id}
                  onClick={() => setColorTheme(theme.id)}
                  className={cn(
                    'group relative p-2 rounded-xl border text-left transition-all',
                    active
                      ? 'border-primary bg-primary-soft/40 ring-1 ring-primary shadow-2xs'
                      : 'border-border/60 bg-muted/20 hover:bg-muted/60 hover:border-border',
                  )}
                >
                  {/* Swatch Bar */}
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden mb-1.5 shadow-2xs">
                    <span className="flex-1" style={{ background: sidebarSwatch }} />
                    <span className="flex-1" style={{ background: primarySwatch }} />
                    <span className="flex-1" style={{ background: accentSwatch }} />
                    <span className="flex-1" style={{ background: bgSwatch }} />
                  </div>

                  {/* Title & Active Dot */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-2xs font-bold text-foreground truncate">
                      {theme.name}
                    </span>
                    {active && (
                      <Check className="h-3 w-3 text-primary shrink-0 stroke-[3]" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
