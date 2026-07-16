import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDraft } from '@/hooks/useDraft';
import { CorrectionRequestDialog } from '@/components/CorrectionRequestDialog';
import type { CorrectionTarget } from '@/components/CorrectionRequestDialog';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/StatusPill';
import { fmtNum, getCurrentPosition, isOffLocation, ALERTS } from '@/lib/calculations';
import { fmtSaveToast } from '@/lib/format';
import { findExistingReading } from '@/lib/duplicateCheck';
import { downloadCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MapPin, Pencil, X, Droplet, Zap, Upload, Download, FileText, AlertCircle, Loader2, History, Gauge, FlaskConical, Keyboard } from 'lucide-react';

// High-voltage transmission tower icon — matches Plants.tsx grid icon exactly.

import { LocatorReadingForm } from './locators/LocatorSection';
import { WellReadingForm }    from './wells/WellSection';
import { BlendingForm }       from './blending/BlendingSection';
import { ProductForm }        from './product/ProductSection';
import { PowerForm }          from './power/PowerSection';

const TAB_ALIASES: Record<string, string> = {
  locator: 'locator', locators: 'locator',
  well: 'well', wells: 'well',
  product: 'product', production: 'product',
  blending: 'blending', bypass: 'blending',
  power: 'power',
};
const VALID_TABS = new Set(['locator', 'well', 'product', 'blending', 'power']);

// ─── PlantSelector ───────────────────────────────────────────────────────────
function PlantSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();
  // Fix: onChange is intentionally excluded from deps. Including it caused an
  // infinite render loop when parents passed inline arrow functions (new reference
  // every render → effect fires → onChange(selectedPlantId) → re-render → repeat).
  // value is kept so the effect re-checks after the first auto-select clears the
  // empty-string condition. selectedPlantId covers the "global plant changed" case.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedPlantId && !value) onChange(selectedPlantId); }, [selectedPlantId, value]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select plant" /></SelectTrigger>
      <SelectContent>
        {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Operations page ─────────────────────────────────────────────────────────

const TAB_CONFIG = [
  { key: 'locator',  label: 'Locator',  icon: MapPin },
  { key: 'well',     label: 'Well',     icon: Droplet },
  { key: 'product',  label: 'Product',  icon: FlaskConical },
  { key: 'blending', label: 'Blending', icon: Gauge },
  { key: 'power',    label: 'Power',    icon: Zap },
] as const;

export default function Operations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = TAB_ALIASES[(searchParams.get('tab') || '').toLowerCase()] ?? 'locator';
  const [tab, setTab] = useState<string>(urlTab);

  useEffect(() => {
    if (urlTab !== tab) setTab(urlTab);
  }, [urlTab]);

  const handleTabChange = (next: string) => {
    if (!VALID_TABS.has(next)) return;
    setTab(next);
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', next);
    setSearchParams(sp, { replace: true });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Operations</h1>
        <span className="text-xs text-muted-foreground hidden sm:block">
          {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-0.5 p-1 bg-muted/60 border border-border/50 rounded-xl w-full">
        {TAB_CONFIG.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={[
                'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 sm:px-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40',
                active
                  ? 'bg-white dark:bg-card shadow-sm text-teal-700 dark:text-teal-400 border border-border/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/50 dark:hover:bg-white/5',
              ].join(' ')}
            >
              <Icon className={['h-3.5 w-3.5 shrink-0', active ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground/70'].join(' ')} />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'locator'  && <LocatorReadingForm />}
        {tab === 'well'     && <WellReadingForm />}
        {tab === 'product'  && <ProductForm />}
        {tab === 'blending' && <BlendingForm />}
        {tab === 'power'    && <PowerForm />}
      </div>
    </div>
  );
}

// ─── OdometerRollerInput ─────────────────────────────────────────────────────
// Mobile-only odometer drum display.
//
// Design rules
// • 6 whole-digit cells (######) by default; auto-expands to 8 (########) once
//   the reading value ≥ 1,000,000 (7-digit overflow).
// • 2 fixed decimal cells — always visible but visually muted.
// • Alert colour ring applied to whole cells + decimal dot:
//     neutral → cyan  |  ok → green  |  warn → amber  |  error → red
// • Transparent-safe: cells use translucent tinted backgrounds so the component
//   renders correctly on dark, light, or glass/card backgrounds.
// • A hidden <input type="text" inputMode="decimal"> owns all keyboard / touch
//   events. The visual drum layer is pointer-events: none.

type OdometerAlertState = 'neutral' | 'ok' | 'warn' | 'error';
