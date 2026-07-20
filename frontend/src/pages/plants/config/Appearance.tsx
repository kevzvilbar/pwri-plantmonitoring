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
import { GridPylonIcon } from '../shared';
// ─── BackwashModeCard ─────────────────────────────────────────────────────────
export function BackwashModeCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager, user, profile } = useAuth();
  const [mode, setMode] = useState<'independent' | 'synchronized'>(plant.backwash_mode ?? 'independent');

  // Derive the media type label dynamically from the plant setting
  const mediaLabel = plant.filter_media_type ?? 'AFM';

  const save = async (next: 'independent' | 'synchronized') => {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    const { error } = await supabase.from('plants').update({ backwash_mode: next }).eq('id', plant.id);
    if (error) { setMode(prev); toast.error(error.message); return; }
    const actorLabel = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
      || (profile as any)?.email
      || user?.email
      || null;
    try {
      const { error: auditErr } = await supabase
        .from('deletion_audit_log' as any)
        .insert({
          kind: 'plant',
          entity_id: plant.id,
          entity_label: plant.name ?? null,
          action: 'soft',
          actor_user_id: user?.id ?? null,
          actor_label: actorLabel,
          reason: `Backwash mode: ${prev} → ${next}`,
          dependencies: { type: 'backwash_mode_change', from: prev, to: next },
        } as any);
      if (auditErr) console.warn('[audit] backwash_mode_change insert failed:', auditErr.message);
    } catch (e: any) {
      console.warn('[audit] backwash_mode_change threw:', e?.message ?? e);
    }
    toast.success(`Backwash mode set to ${next}`);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  return (
    <Card className="p-3 flex flex-col" data-testid="backwash-mode-card">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 flex-1">
        <div className="min-w-0">
          {/* Title updates dynamically based on plant media type */}
          <div className="text-sm font-semibold">
            {mediaLabel} Backwash Mode
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {mode === 'synchronized'
              ? `All ${mediaLabel} units on a train backwash together.`
              : `Each ${mediaLabel} unit backwashes independently.`}
          </div>
        </div>
        {/* Segmented pill toggle */}
        <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg shrink-0 w-full sm:w-auto">
          {(['independent', 'synchronized'] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                disabled={!isManager}
                onClick={() => save(m)}
                data-testid={`backwash-mode-${m}`}
                className={[
                  'flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                  active
                    ? 'bg-teal-700 text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                  !isManager ? 'cursor-default opacity-70' : 'cursor-pointer',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full border ${
                    active ? 'bg-white border-white' : 'border-muted-foreground/40'
                  }`}
                />
                <span className="capitalize">{m}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── EnergySourceInline ──────────────────────────────────────────────────────
// Compact energy source display + edit — sits inside the gradient plant card.

export function EnergySourceInline({ plant }: { plant: any; isManager?: boolean; qc?: any }) {
  const hasSolar = !!plant.has_solar;
  const hasGrid  = plant.has_grid !== false;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold opacity-70 uppercase tracking-wide flex items-center gap-1">
        <Zap className="h-3 w-3" /> Energy
      </span>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {hasSolar && (
          <span className="inline-flex items-center gap-1 opacity-90">
            <Sun className="h-3 w-3 text-yellow-300" />
            Solar{plant.solar_capacity_kw ? ` · ${plant.solar_capacity_kw} kW` : ''}
          </span>
        )}
        {hasGrid && (
          <span className="inline-flex items-center gap-1 opacity-90">
            <GridPylonIcon className="h-3 w-3" /> Grid
          </span>
        )}
        {!hasSolar && !hasGrid && <span className="opacity-50 italic text-xs">No source</span>}
        <span className="opacity-40 text-[10px] ml-1">(configure in Power tab)</span>
      </div>
    </div>
  );
}

export function EnergySourceCard({ plant }: { plant: any }) {
  const qc = useQueryClient();
  const { isManager } = useAuth();
  const [hasSolar, setHasSolar] = useState<boolean>(!!plant.has_solar);
  const [hasGrid, setHasGrid] = useState<boolean>(plant.has_grid !== false);
  const [solarKw, setSolarKw] = useState<string>(
    plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '',
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: any = {
      has_solar: hasSolar,
      has_grid: hasGrid,
      solar_capacity_kw: solarKw ? +solarKw : null,
    };
    const { error } = await supabase.from('plants').update(payload).eq('id', plant.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Energy sources updated');
    setEditing(false);
    qc.invalidateQueries({ queryKey: ['plants'] });
  };

  return (
    <Card className="p-3" data-testid="energy-source-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-chart-6" /> Energy Sources
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {hasSolar && (
                <span className="inline-flex items-center gap-1">
                  <Sun className="h-3 w-3 text-yellow-500" />
                  Solar{plant.solar_capacity_kw ? ` · ${plant.solar_capacity_kw} kW` : ''}
                </span>
              )}
              {hasGrid && (
                <span className="inline-flex items-center gap-1">
                  <GridPylonIcon className="h-3 w-3" /> Grid
                </span>
              )}
              {!hasSolar && !hasGrid && <span className="italic">No source configured</span>}
            </div>
          </div>
        </div>
        {isManager && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="edit-energy-btn">
            <Wrench className="h-3 w-3 mr-1" />Edit
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={hasSolar}
              onCheckedChange={setHasSolar}
              data-testid="energy-has-solar"
              className="h-8 w-14 sm:h-6 sm:w-11 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-5 sm:[&>span]:w-5 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-5"
            />
            <span className="inline-flex items-center gap-1">
              <Sun className="h-3.5 w-3.5 text-yellow-500" /> Has solar
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={hasGrid}
              onCheckedChange={setHasGrid}
              data-testid="energy-has-grid"
              className="h-8 w-14 sm:h-6 sm:w-11 [&>span]:h-6 [&>span]:w-6 sm:[&>span]:h-5 sm:[&>span]:w-5 [&>span]:data-[state=checked]:translate-x-6 sm:[&>span]:data-[state=checked]:translate-x-5"
            />
            <span className="inline-flex items-center gap-1">
              <GridPylonIcon className="h-3.5 w-3.5" /> Has grid
            </span>
          </label>
          <div>
            <Label className="text-xs">Solar capacity (kW)</Label>
            <Input
              type="number" step="any" value={solarKw}
              onChange={(e) => setSolarKw(e.target.value)}
              disabled={!hasSolar}
              placeholder="e.g. 50"
              data-testid="energy-solar-kw"
            />
          </div>
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => {
              setEditing(false);
              setHasSolar(!!plant.has_solar);
              setHasGrid(plant.has_grid !== false);
              setSolarKw(plant.solar_capacity_kw != null ? String(plant.solar_capacity_kw) : '');
            }} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} data-testid="save-energy-btn">
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Entity History Chart ─────────────────────────────────────────────────────
// Reusable historical consumption chart used by Locators, Wells, Product meters.
// Queries the relevant readings table, computes daily consumption, renders a bar+line chart.
// onExport fires a CSV download of the raw data.

