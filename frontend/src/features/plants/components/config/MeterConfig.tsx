import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { deltaCache } from '@/lib/deltaCache';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { ChevronLeft, ChevronDown, Plus, MapPin, Gauge, Wrench, Sun, Zap, Trash2, Loader2, Pencil, Upload, FileDown, X, TrendingUp, Download, BarChart2, Calendar, Droplet, RefreshCw, FlaskConical } from 'lucide-react';
import { ROTrainIcon } from '@/components/icons/water-icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area } from 'recharts';
import { fmtNum } from '@/lib/calculations';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/supabaseErrors';
import { format } from 'date-fns';

import {
  usePlantMeterConfig, PlantMeterConfig, CollapsibleSection, GridPylonIcon,
  DEFAULT_METER_CONFIG, PLANT_CHEMICALS,
} from '../../shared';
import { BackwashModeCard } from './Appearance';
import { RoTrainsMeterSection } from './sections/RoTrainsMeterSection';
import { WellsMeterSection } from './sections/WellsMeterSection';
import { LocatorsMeterSection } from './sections/LocatorsMeterSection';
import { ProductMeterSection } from './sections/ProductMeterSection';
import { PowerMeterSection } from './sections/PowerMeterSection';
import { CIPChemicalsSection } from './components/CIPChemicalsSection';
import { MeterToggleTile } from './components/MeterToggleTile';
import { MeterGroupChips } from './components/MeterGroupChips';
import { LocatorGroupRealitySync } from './components/LocatorGroupRealitySync';
import { ChemicalsSection } from './components/ChemicalsSection';
import { PlantComponentTypeCard } from './components/PlantComponentTypeCard';
import { MeterMultiplierSection } from './sections/MeterMultiplierSection';

export { MeterToggleTile, MeterGroupChips, LocatorGroupRealitySync, CIPChemicalsSection };

// ── Config tab accordion ─────────────────────────────────────────────────────
// Each section is an independently collapsible accordion item (type="multiple").
// Defaults to every section open so the first-load experience matches the old
// always-open flat stack.
const ALL_CONFIG_SECTIONS = [
  'ro-trains',
  'product-meters',
  'wells',
  'locators',
  'meter-multipliers',
  'power',
  'component-types',
  'chemicals',
];

const CONFIG_SECTION_BADGE =
  'shrink-0 text-2xs font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded whitespace-nowrap';

// Small tinted icon chip for section-identity coding — reuses the plant's
// existing kpi-wells/kpi-locator/kpi-ro/kpi-meter/kpi-solar/kpi-grid/kpi-chem
// tokens (already defined for exactly this purpose, previously unused here).
// className must be a literal Tailwind string at each call site (e.g.
// "bg-kpi-ro/15 text-kpi-ro") — Tailwind can't resolve interpolated names.
function SectionIcon({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', className)}>
      {children}
    </span>
  );
}

function ConfigSectionTitle({ icon, hint, children }: {
  icon: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
      {icon}
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground truncate">{children}</span>
      {hint && (
        <span className="hidden sm:inline text-2xs font-normal normal-case tracking-normal text-muted-foreground truncate">
          {hint}
        </span>
      )}
    </span>
  );
}

export function PlantMeterConfigCard({ plant }: { plant: any }) {
  const { isManager, isAdmin } = useAuth();
  const canEdit = isManager || isAdmin;
  const { config: savedConfig, isLoading, saveConfig, isLocalOnly } = usePlantMeterConfig(plant.id);
  const qc = useQueryClient();
  const [cfg, setCfg] = useState<PlantMeterConfig>(DEFAULT_METER_CONFIG);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => { setCfg(savedConfig); }, [savedConfig]);

  const { data: wells = [] } = useQuery({
    queryKey: ['wells-list', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, name').eq('plant_id', plant.id).order('name');
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
  const { data: locators = [] } = useQuery({
    queryKey: ['locators-list', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('locators')
        .select('id, name, product_meter_id').eq('plant_id', plant.id).order('name')
        .returns<Array<{ id: string; name: string; product_meter_id: string | null }>>();
      return data ?? [];
    },
  });
  const { data: configProductMeters = [] } = useQuery({
    queryKey: ['config-product-meters', plant.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_meters').select('id, name').eq('plant_id', plant.id).order('sort_order', { ascending: true });
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const update = (patch: Partial<PlantMeterConfig>) => setCfg(c => ({ ...c, ...patch }));

  const doSave = async () => {
    setSaving(true);
    await supabase.from('plants').update({
      has_solar: cfg.has_solar,
      has_grid: cfg.has_grid,
      solar_capacity_kw: cfg.solar_capacity_kw,
    }).eq('id', plant.id);

    const electricWellIds = new Set<string>([
      ...cfg.wells_dedicated_electric_ids,
      ...cfg.wells_shared_electric_groups.flatMap(g => g.members),
    ]);
    if (wells.length > 0) {
      const toEnable  = wells.filter(w => electricWellIds.has(w.id)).map(w => w.id);
      const toDisable = wells.filter(w => !electricWellIds.has(w.id)).map(w => w.id);
      await Promise.all([
        toEnable.length  ? supabase.from('wells').update({ has_power_meter: true  }).in('id', toEnable)  : Promise.resolve(),
        toDisable.length ? supabase.from('wells').update({ has_power_meter: false }).in('id', toDisable) : Promise.resolve(),
      ]);
      qc.invalidateQueries({ queryKey: ['wells', plant.id] });
    }

    const savedToDb = await saveConfig(cfg);
    setSaving(false);
    if (savedToDb) {
      toast.success('Meter configuration saved');
    } else {
      toast.warning('Saved on this device only — not yet in the database', {
        description: 'Other screens (Dashboard, Production totals) won\'t show this change until it syncs. It will retry automatically.',
        duration: 10000,
      });
    }
  };

  if (isLoading) return (
    <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading meter config…
    </div>
  );

  const roFlags = [
    cfg.ro_has_feed_meter && 'Feed',
    cfg.ro_has_permeate_meter && 'Perm',
    cfg.ro_has_reject_meter && 'Reject',
  ].filter(Boolean).join(' · ') || 'None';

  return (
    <Card className="overflow-hidden" data-testid="plant-meter-config-card">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-3 hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2.5">
          <Gauge className="h-4 w-4 text-primary shrink-0" />
          <div>
            <CardTitle className="text-sm font-semibold">Plant Configuration Settings</CardTitle>
            {!open && (
              <CardDescription className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                <span>RO: {roFlags}</span>
                <span>Prod: {cfg.ro_production_source === 'both'
                  ? `Product meter + Permeate${cfg.permeate_is_production ? '' : ' (⚠ permeate switch off)'}`
                  : cfg.ro_production_source === 'permeate'
                    ? `Permeate${cfg.permeate_is_production
                        ? ` (${cfg.permeate_cutoff_enabled ? `cut-off ${cfg.permeate_cutoff_time || '00:20'}` : 'no cut-off'})`
                        : ''}`
                    : 'Product meter'}</span>
                {cfg.ro_has_per_train_electricity && <span>⚡ Per‑train kWh</span>}
                <span>{cfg.has_solar && cfg.has_grid ? 'Solar + Grid' : cfg.has_solar ? 'Solar' : 'Grid'}</span>
                <span>Loc: {cfg.locator_readings_per_day ?? 3}×/day</span>
              </CardDescription>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!canEdit && <span className="text-2xs bg-muted px-2 py-0.5 rounded font-medium text-muted-foreground">View only</span>}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </CardHeader>

      {open && (
        <div className="px-4 pt-5 pb-4 border-t border-border/50">
          {isLocalOnly && (
            <div className="mb-4 flex items-start gap-2 text-xs text-warn bg-warn-soft border border-warn rounded-md px-3 py-2">
              <span className="mt-0.5">⚠</span>
              <span>
                A saved change to this plant's configuration hasn't reached the database yet — it's stored
                only on this device. Dashboard, Trend, and Production totals elsewhere won't reflect it until
                it syncs. This retries automatically in the background; keep this app open on this device for
                it to take effect, or ask an admin to check the <code className="font-mono">plant_meter_config</code> table/RLS setup.
              </span>
            </div>
          )}
          <Accordion type="multiple" defaultValue={ALL_CONFIG_SECTIONS}>
            <AccordionItem value="ro-trains" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle icon={<SectionIcon className="bg-kpi-ro/15 text-kpi-ro"><ROTrainIcon className="h-3.5 w-3.5" /></SectionIcon>}>
                  RO Trains
                </ConfigSectionTitle>
                <span className={CONFIG_SECTION_BADGE}>{roFlags}</span>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <RoTrainsMeterSection cfg={cfg} update={update} canEdit={canEdit} plantId={plant.id} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="product-meters" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle icon={<SectionIcon className="bg-kpi-meter/15 text-kpi-meter"><Gauge className="h-3.5 w-3.5" /></SectionIcon>}>
                  Product Meters
                </ConfigSectionTitle>
                <span className={CONFIG_SECTION_BADGE}>
                  {cfg.ro_production_source === 'both'
                    ? 'Product meter + Permeate'
                    : cfg.ro_production_source === 'permeate'
                      ? 'Permeate'
                      : 'Product meter'}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <ProductMeterSection cfg={cfg} update={update} canEdit={canEdit} plantId={plant.id} plantName={plant.name} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="wells" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle
                  icon={<SectionIcon className="bg-kpi-wells/15 text-kpi-wells"><Droplet className="h-3.5 w-3.5" /></SectionIcon>}
                  hint="(each well always has its own water meter)"
                >
                  Wells
                </ConfigSectionTitle>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <WellsMeterSection cfg={cfg} update={update} canEdit={canEdit} wells={wells} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="locators" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle
                  icon={<SectionIcon className="bg-kpi-locator/15 text-kpi-locator"><MapPin className="h-3.5 w-3.5" /></SectionIcon>}
                  hint="(each locator always has its own water meter)"
                >
                  Locators
                </ConfigSectionTitle>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <LocatorsMeterSection cfg={cfg} update={update} canEdit={canEdit} locators={locators} configProductMeters={configProductMeters} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="meter-multipliers" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle
                  icon={<SectionIcon className="bg-primary/15 text-primary"><Gauge className="h-3.5 w-3.5" /></SectionIcon>}
                  hint="(registers requiring ×10 or custom factors to calculate m³)"
                >
                  Meter Multipliers
                </ConfigSectionTitle>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <MeterMultiplierSection plantId={plant.id} canEdit={canEdit} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="power" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle icon={<SectionIcon className="bg-kpi-solar/15 text-kpi-solar"><Zap className="h-3.5 w-3.5" /></SectionIcon>}>
                  Power
                </ConfigSectionTitle>
                <span className={CONFIG_SECTION_BADGE}>
                  {cfg.has_solar && cfg.has_grid ? 'Solar + Grid' : cfg.has_solar ? 'Solar' : 'Grid'}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <PowerMeterSection cfg={cfg} update={update} canEdit={canEdit} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="component-types" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle icon={<SectionIcon className="bg-kpi-grid/15 text-kpi-grid"><Wrench className="h-3.5 w-3.5" /></SectionIcon>}>
                  Component Types & Backwash
                </ConfigSectionTitle>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <PlantComponentTypeCard plant={plant} />
                  <BackwashModeCard plant={plant} />
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="chemicals" className="border-border/50">
              <AccordionTrigger className="py-3 hover:no-underline">
                <ConfigSectionTitle icon={<SectionIcon className="bg-kpi-chem/15 text-kpi-chem"><FlaskConical className="h-3.5 w-3.5" /></SectionIcon>}>
                  Chemicals
                </ConfigSectionTitle>
              </AccordionTrigger>
              <AccordionContent className="space-y-5">
                <ChemicalsSection cfg={cfg} update={update} canEdit={canEdit} />
                <CIPChemicalsSection cfg={cfg} update={update} canEdit={canEdit} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {canEdit && (
            <Button onClick={doSave} disabled={saving} className="mt-4 w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 text-sm" data-testid="save-meter-config-btn">
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save meter configuration
            </Button>
          )}
          {!canEdit && (
            <p className="mt-4 text-xs text-muted-foreground text-center">Only managers and admins can edit meter configuration.</p>
          )}
        </div>
      )}
    </Card>
  );
}
