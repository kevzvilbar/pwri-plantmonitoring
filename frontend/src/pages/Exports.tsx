import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Building2, Activity, Waves, FlaskConical,
  Zap, Wrench, ShieldCheck, ShieldAlert, MapPin, BarChart2, ChevronDown,
  CheckCircle2, Loader2, RefreshCw, Search, CheckSquare, Square,
  Layers, Package, FileSpreadsheet, Filter,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateRangePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { usePermission } from '@/hooks/usePermission';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ExportTable, EXPORT_CATEGORIES, ALL_TABLES, PRESETS, applyPreset } from './Exports/constants';
import { CategorySection } from './Exports/CategorySection';
import { useExportActions, useTableSearch } from './Exports/hooks';

export default function Exports() {
  const navigate = useNavigate();
  const canView = usePermission('data_exports', 'view');
  const { selectedPlantId, setSelectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? 'all');

  const lastSyncedPlantRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPlantId === lastSyncedPlantRef.current) return;
    lastSyncedPlantRef.current = selectedPlantId;
    setPlantId(selectedPlantId ?? 'all');
  }, [selectedPlantId]);
  const [from, setFrom]       = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [to, setTo]           = useState(format(new Date(), 'yyyy-MM-dd'));
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(new Set());
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done'>('idle');

  const {
    toggleSelectTable,
    selectAll,
    clearSelection,
    selectCuratedPackage,
    exportAll,
    exportSelected,
  } = useExportActions(plantId, from, to, selectedTableIds, setSelectedTableIds, setExportState);

  const filteredCategories = useTableSearch(searchQuery);

  const handlePreset = (days: number) => {
    applyPreset(days, setFrom, setTo);
    setActivePreset(days);
  };

  const handleDateChange = (setter: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setActivePreset(null);
  };

  if (!canView) {
    return (
      <Card className="p-6 text-center space-y-2" data-testid="exports-access-denied">
        <ShieldAlert className="h-8 w-8 mx-auto text-danger" />
        <h2 className="font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">
          Data Exports is available to Manager, Data Analyst, and Admin.
        </p>
        <button
          className="text-sm text-accent hover:underline"
          onClick={() => navigate('/')}
        >
          Back to dashboard
        </button>
      </Card>
    );
  }

  const selectedPlantName = plantId === 'all'
    ? 'Fleet Global (All Plants)'
    : plants?.find(p => p.id === plantId)?.name ?? 'Selected Plant';

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <PageHeader
          title="Data Warehouse & Exports"
          titleIcon={<FileSpreadsheet className="h-5 w-5 text-primary" />}
          subtitle={<>Enterprise telemetry and operational database export hub. Download datasets across {ALL_TABLES.length} system tables.</>}
        />
        <div className="flex items-center gap-2 flex-wrap">
          {selectedTableIds.size > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={exportSelected}
              disabled={exportState === 'busy'}
              className="h-8 gap-1.5 font-semibold shrink-0"
            >
              {exportState === 'busy' ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
              ) : (
                <><Download className="h-3.5 w-3.5" /> Export Selected ({selectedTableIds.size})</>
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportAll}
            disabled={exportState === 'busy'}
            className={cn(
              'h-8 gap-1.5 shrink-0 font-semibold',
              exportState === 'done' && 'border-accent/40 text-accent',
            )}
          >
            {exportState === 'busy' ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</>
            ) : exportState === 'done' ? (
              <><CheckCircle2 className="h-3.5 w-3.5" /> Done</>
            ) : (
              <><Download className="h-3.5 w-3.5" /> Export All ({ALL_TABLES.length})</>
            )}
          </Button>
        </div>
      </div>

      {/* Filters & Range Toolbar */}
      <Card className="p-3.5 space-y-3 border-border/70">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2.5 items-end">
          {/* Plant */}
          <div className="space-y-1">
            <Label htmlFor="exports-plant" className="text-xs font-semibold">Plant Facility</Label>
            <Select
              value={plantId}
              onValueChange={(v) => {
                lastSyncedPlantRef.current = v === 'all' ? null : v;
                setPlantId(v);
                setSelectedPlantId(v === 'all' ? null : v);
              }}
            >
              <SelectTrigger className="h-8 text-xs font-medium" id="exports-plant">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plants (Fleet Global)</SelectItem>
                {plants?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="space-y-1">
            <Label htmlFor="exports-from" className="text-xs font-semibold">Date Range</Label>
            <DateRangePicker
              from={from}
              to={to}
              onChange={({ from: f, to: t }) => {
                setFrom(f);
                setTo(t);
              }}
              size="sm"
              className="h-8 text-xs min-w-[220px]"
            />
          </div>

          {/* Quick presets */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Range Horizon</p>
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.days}
                  onClick={() => handlePreset(p.days)}
                  className={cn(
                    'h-8 px-2.5 rounded-md border text-xs font-semibold transition-colors',
                    activePreset === p.days
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Curated Package Presets & Table Search Bar */}
        <div className="pt-2 border-t border-border/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Curated Packages:</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('ops')}
            >
              💧 Operations (4)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('ro')}
            >
              🌊 RO Trains (5)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('chem')}
            >
              🧪 Chemicals (4)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-3xs font-semibold rounded-full"
              onClick={() => selectCuratedPackage('power')}
            >
              ⚡ Energy & Costs (4)
            </Button>
            {selectedTableIds.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-3xs text-muted-foreground hover:text-foreground"
                onClick={clearSelection}
              >
                Clear selection ({selectedTableIds.size})
              </Button>
            )}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tables (e.g. dosing, train)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-7 text-xs pl-8 font-medium"
            />
          </div>
        </div>
      </Card>

      {/* Category sections */}
      <div className="space-y-2.5">
        {filteredCategories.map((cat, i) => (
          <CategorySection
            key={cat.label}
            category={cat}
            plantId={plantId}
            from={from}
            to={to}
            defaultOpen={i < 2 || searchQuery.length > 0}
            selectedTableIds={selectedTableIds}
            onToggleSelect={toggleSelectTable}
          />
        ))}
        {filteredCategories.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No export tables match "{searchQuery}".
          </Card>
        )}
      </div>
    </div>
  );
}
