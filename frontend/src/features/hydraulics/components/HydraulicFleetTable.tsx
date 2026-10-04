import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadCSVMatrix } from '@/shared/csv';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Download,
  Eye,
  ExternalLink,
  Pencil,
  Plus,
  ArrowUpDown,
  AlertTriangle,
  AlertCircle,
  Clock,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import {
  type WellHydraulicSummary,
  type HydraulicStatus,
} from '@/features/wells/lib/hydraulics';
import { wellDetailPath } from '@/features/wells/lib/wellRoutes';

export type SortField = 'status_priority' | 'name' | 'plant' | 'drawdown' | 'survey_date_desc' | 'survey_date_asc';

interface HydraulicFleetTableProps {
  summaries: WellHydraulicSummary[];
  counts: {
    total: number;
    ok: number;
    overdue: number;
    incomplete: number;
    no_survey: number;
  };
  visiblePlants: { id: string; name: string }[];
  selectedPlantId: string;
  onSelectPlant: (plantId: string) => void;
  statusFilter: HydraulicStatus | 'ALL';
  onSelectStatusFilter: (status: HydraulicStatus | 'ALL') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenQuickLook: (summary: WellHydraulicSummary) => void;
  onEditSurvey: (summary: WellHydraulicSummary) => void;
  onLogNewSurvey: (summary: WellHydraulicSummary) => void;
  isManager: boolean;
}

export function HydraulicFleetTable({
  summaries,
  counts,
  visiblePlants,
  selectedPlantId,
  onSelectPlant,
  statusFilter,
  onSelectStatusFilter,
  searchQuery,
  onSearchChange,
  onOpenQuickLook,
  onEditSurvey,
  onLogNewSurvey,
  isManager,
}: HydraulicFleetTableProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>('status_priority');

  // Sort comparator
  const sortedSummaries = useMemo(() => {
    const list = [...summaries];
    const statusWeight: Record<HydraulicStatus, number> = {
      no_survey: 1,
      incomplete: 2,
      overdue: 3,
      ok: 4,
    };

    list.sort((a, b) => {
      switch (sortField) {
        case 'status_priority': {
          const diff = statusWeight[a.status] - statusWeight[b.status];
          if (diff !== 0) return diff;
          return a.wellName.localeCompare(b.wellName);
        }
        case 'name':
          return a.wellName.localeCompare(b.wellName);
        case 'plant':
          return a.plantName.localeCompare(b.plantName) || a.wellName.localeCompare(b.wellName);
        case 'drawdown': {
          const aDd = a.drawdown ?? -999;
          const bDd = b.drawdown ?? -999;
          return bDd - aDd;
        }
        case 'survey_date_desc': {
          const aDate = a.surveyDate ?? '';
          const bDate = b.surveyDate ?? '';
          return bDate.localeCompare(aDate);
        }
        case 'survey_date_asc': {
          const aDate = a.surveyDate ?? '9999-99-99';
          const bDate = b.surveyDate ?? '9999-99-99';
          return aDate.localeCompare(bDate);
        }
        default:
          return 0;
      }
    });

    return list;
  }, [summaries, sortField]);

  // Export CSV
  const handleExportCsv = () => {
    const headers = [
      'Well Name',
      'Plant Name',
      'Status',
      'Last Survey Date',
      'Days Since Survey',
      'Drilling Depth (m)',
      'Static Water Level (m)',
      'Pumping Water Level (m)',
      'Drawdown (m)',
      'Pump Setting',
      'Motor HP',
      'Survey TDS (ppm)',
      'Survey Turbidity (NTU)',
      'Live Pressure (psi)',
      'Live TDS (ppm)',
      'Remarks',
    ];

    const rows = sortedSummaries.map((s) => [
      s.wellName,
      s.plantName,
      s.statusMeta.label,
      s.surveyDate ?? '',
      s.daysSinceSurvey ?? '',
      s.drillingDepth ?? '',
      s.swl ?? '',
      s.pwl ?? '',
      s.drawdown ?? '',
      s.pumpSetting ?? '',
      s.motorHp ?? '',
      s.surveyTds ?? '',
      s.surveyTurbidity ?? '',
      s.livePressure ?? '',
      s.liveTds ?? '',
      s.latestSurvey?.remarks ?? '',
    ]);

    downloadCSVMatrix(`hydraulic_fleet_data_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const statusChips: Array<{ id: HydraulicStatus | 'ALL'; label: string; count: number; icon: React.ReactNode }> = [
    { id: 'ALL', label: 'All Wells', count: counts.total, icon: <Filter className="h-3 w-3" /> },
    { id: 'overdue', label: 'Survey Due', count: counts.overdue, icon: <Clock className="h-3 w-3 text-amber-500" /> },
    { id: 'incomplete', label: 'Incomplete', count: counts.incomplete, icon: <AlertCircle className="h-3 w-3 text-amber-500" /> },
    { id: 'no_survey', label: 'No Survey', count: counts.no_survey, icon: <AlertTriangle className="h-3 w-3 text-destructive" /> },
    { id: 'ok', label: 'Up to Date', count: counts.ok, icon: <CheckCircle2 className="h-3 w-3 text-emerald-500" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Status Chips Filter Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {statusChips.map((chip) => {
          const isSelected = statusFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => onSelectStatusFilter(chip.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border shrink-0 ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card text-muted-foreground hover:text-foreground border-border/80 hover:bg-muted/50'
              }`}
            >
              {chip.icon}
              <span>{chip.label}</span>
              <span
                className={`ml-0.5 px-1.5 py-0.2 rounded-full text-2xs font-mono-num font-semibold ${
                  isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: Search, Plant, Sort, CSV Export */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 flex-wrap sm:flex-nowrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by well, plant, or pump..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>

          {/* Plant Scope Selector */}
          <Select value={selectedPlantId} onValueChange={onSelectPlant}>
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="All Plants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Plants</SelectItem>
              {visiblePlants.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort Selector */}
          <Select value={sortField} onValueChange={(val) => setSortField(val as SortField)}>
            <SelectTrigger className="w-[180px] h-9 text-xs gap-1">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground mr-1" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status_priority">Priority (Attention First)</SelectItem>
              <SelectItem value="name">Well Name (A–Z)</SelectItem>
              <SelectItem value="plant">Plant Name (A–Z)</SelectItem>
              <SelectItem value="drawdown">Drawdown (High to Low)</SelectItem>
              <SelectItem value="survey_date_asc">Oldest Survey First</SelectItem>
              <SelectItem value="survey_date_desc">Newest Survey First</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-9 text-xs gap-1.5 shrink-0"
          onClick={handleExportCsv}
          disabled={sortedSummaries.length === 0}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV ({sortedSummaries.length})
        </Button>
      </div>

      {/* Fleet Comparison Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-[180px] text-xs font-semibold">Well & Plant</TableHead>
                <TableHead className="w-[140px] text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold">Last Survey</TableHead>
                <TableHead className="text-xs font-semibold">SWL / PWL</TableHead>
                <TableHead className="text-xs font-semibold">Drawdown</TableHead>
                <TableHead className="text-xs font-semibold">Pump & Motor</TableHead>
                <TableHead className="text-xs font-semibold">TDS (Survey / Live)</TableHead>
                <TableHead className="text-xs font-semibold">Live Pressure</TableHead>
                <TableHead className="w-[110px] text-right text-xs font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-32 text-center text-xs text-muted-foreground">
                    No wells match the current filter and search criteria.
                  </TableCell>
                </TableRow>
              ) : (
                sortedSummaries.map((summary) => {
                  const {
                    wellId,
                    wellName,
                    plantId,
                    plantName,
                    status,
                    statusMeta,
                    surveyDate,
                    daysSinceSurvey,
                    swl,
                    pwl,
                    drawdown,
                    pumpSetting,
                    motorHp,
                    surveyTds,
                    liveTds,
                    livePressure,
                  } = summary;

                  return (
                    <TableRow key={wellId} className="hover:bg-muted/30 transition-colors">
                      {/* Well & Plant */}
                      <TableCell className="py-2.5">
                        <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                          <span>{wellName}</span>
                        </div>
                        <div className="text-2xs text-muted-foreground truncate max-w-[140px]">
                          {plantName}
                        </div>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-3xs font-medium gap-1 px-1.5 py-0.5 whitespace-nowrap ${statusMeta.badgeClass}`}
                          title={statusMeta.description}
                        >
                          {status === 'no_survey' && <AlertTriangle className="h-2.5 w-2.5" />}
                          {status === 'incomplete' && <AlertCircle className="h-2.5 w-2.5" />}
                          {status === 'overdue' && <Clock className="h-2.5 w-2.5" />}
                          {status === 'ok' && <CheckCircle2 className="h-2.5 w-2.5" />}
                          <span>{statusMeta.label}</span>
                        </Badge>
                      </TableCell>

                      {/* Last Survey */}
                      <TableCell className="py-2.5 text-xs font-mono-num">
                        {surveyDate ? (
                          <div>
                            <span className="font-medium text-foreground">{surveyDate}</span>
                            <span className="block text-3xs text-muted-foreground">
                              {daysSinceSurvey != null ? `${daysSinceSurvey}d ago` : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* SWL / PWL */}
                      <TableCell className="py-2.5 text-xs font-mono-num">
                        {swl != null || pwl != null ? (
                          <div className="space-y-0.5 text-2xs">
                            <div>
                              <span className="text-muted-foreground">SWL: </span>
                              <span className="font-medium">{swl != null ? `${swl} m` : '—'}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">PWL: </span>
                              <span className="font-medium">{pwl != null ? `${pwl} m` : '—'}</span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Drawdown */}
                      <TableCell className="py-2.5 text-xs font-mono-num">
                        {drawdown != null ? (
                          <span className="font-bold text-info">{drawdown} m</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Pump & Motor */}
                      <TableCell className="py-2.5 text-2xs">
                        {pumpSetting || motorHp != null ? (
                          <div className="space-y-0.5">
                            <div className="font-medium text-foreground truncate max-w-[130px]">
                              {pumpSetting ?? '—'}
                            </div>
                            <div className="text-muted-foreground font-mono-num">
                              {motorHp != null ? `${motorHp} HP` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* TDS (Survey vs Live) */}
                      <TableCell className="py-2.5 text-2xs font-mono-num">
                        {surveyTds != null || liveTds != null ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="text-muted-foreground">PMS: </span>
                              <span className="font-medium text-foreground">
                                {surveyTds != null ? `${surveyTds} ppm` : '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Live: </span>
                              <span className="font-medium text-foreground">
                                {liveTds != null ? `${liveTds} ppm` : '—'}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Live Pressure */}
                      <TableCell className="py-2.5 text-xs font-mono-num">
                        {livePressure != null ? (
                          <span className="font-medium text-foreground">{livePressure} psi</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => onOpenQuickLook(summary)}
                            title="Quick View Hydraulic Details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              if (plantId && wellId) {
                                navigate(wellDetailPath(plantId, wellId));
                              }
                            }}
                            title="Go to Well Details"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          {isManager && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => {
                                if (summary.latestSurvey) {
                                  onEditSurvey(summary);
                                } else {
                                  onLogNewSurvey(summary);
                                }
                              }}
                              title={summary.latestSurvey ? 'Edit Hydraulic Survey' : 'Log First Survey'}
                            >
                              {summary.latestSurvey ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
