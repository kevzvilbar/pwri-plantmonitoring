import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSearch, CheckCircle2 } from 'lucide-react';

// The tables DataCorrections.tsx treats as sources of truth for norm_status —
// kept in sync with its own usePendingCount() so this card and the page it
// links to never disagree on what "pending review" means.
const PENDING_REVIEW_TABLES = ['locator_readings', 'well_readings', 'product_meter_readings'] as const;

interface Props {
  plantIds: string[];
}

// Every other operational concern (incidents, PM, chemical stock, quality
// breaches) already gets a Dashboard card or badge. Flagged readings awaiting
// Admin/Data Analyst review in Data Corrections had none — a flagged reading
// could sit unreviewed indefinitely unless someone happened to open that page
// directly. This closes that gap with the same count + "click to view" shape
// as ReadingCoverageCard / PMDueSoonCard.
export function PendingReviewCard({ plantIds }: Props) {
  const navigate = useNavigate();

  const { data: pendingData = { total: 0, wells: 0, locators: 0, productMeters: 0, corrections: 0 } } = useQuery({
    queryKey: ['dashboard-pending-review-count', plantIds],
    queryFn: async () => {
      const [tableCounts, corrReqCount] = await Promise.all([
        Promise.all(
          PENDING_REVIEW_TABLES.map(async (t) => {
            let q = supabase.from(t).select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review');
            if (plantIds.length) q = q.in('plant_id', plantIds);
            const { count } = await q;
            return count ?? 0;
          }),
        ),
        (async () => {
          let q = supabase.from('correction_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
          if (plantIds.length) q = q.in('plant_id', plantIds);
          const { count } = await q;
          return count ?? 0;
        })(),
      ]);

      const [locators, wells, productMeters] = tableCounts;
      const total = locators + wells + productMeters + corrReqCount;
      return {
        total,
        wells,
        locators,
        productMeters,
        corrections: corrReqCount,
      };
    },
    // FIX (egress): staleTime matched to refetchInterval — was relying on the 30s
    // global default, so the app-wide background-sync sweep force-refetched this
    // well before its own interval was due.
    staleTime: 120_000,
    refetchInterval: 120_000,
  });

  const pendingCount = pendingData.total;

  if (pendingCount === 0) {
    return (
      <Card className="p-3 flex flex-col justify-between h-full space-y-2" data-testid="pending-review-card">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-emerald-500 dark:text-emerald-400 shrink-0" aria-hidden />
            <span className="text-xs font-medium text-foreground">Pending review</span>
            <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-2xs font-medium">
              <CheckCircle2 className="h-3 w-3" />
              All clear
            </span>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-300 leading-relaxed">
            No readings or corrections awaiting review. All operator entries have been verified and approved.
          </p>
        </div>

        <div className="flex justify-end pt-1 border-t border-border/40">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs font-medium text-primary hover:text-primary/90 hover:underline"
            onClick={() => navigate('/data-corrections')}
          >
            Review history →
          </Button>
        </div>
      </Card>
    );
  }

  const rows = [
    {
      label: 'Wells',
      sublabel: 'Well production readings',
      count: pendingData.wells,
      colorVar: '--kpi-wells',
    },
    {
      label: 'Locators',
      sublabel: 'Distribution meter readings',
      count: pendingData.locators,
      colorVar: '--kpi-locator',
    },
    {
      label: 'Meters & Requests',
      sublabel: 'Product meters & corrections',
      count: pendingData.productMeters + pendingData.corrections,
      colorVar: '--kpi-meter',
    },
  ];

  return (
    <Card className="p-3 flex flex-col justify-between h-full space-y-2.5" data-testid="pending-review-card">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          <span className="text-xs font-medium text-foreground">Pending review</span>
          <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-2xs font-semibold">
            {pendingCount} item{pendingCount > 1 ? 's' : ''}
          </span>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between p-2 rounded-md bg-muted/20 border border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => navigate('/data-corrections')}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: `hsl(var(${r.colorVar}))` }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{r.label}</div>
                  <div className="text-2xs text-slate-400 dark:text-slate-300 truncate">{r.sublabel}</div>
                </div>
              </div>
              {r.count > 0 ? (
                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-3xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  {r.count} flagged
                </span>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-3xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Clean
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1 border-t border-border/40">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs font-medium text-primary hover:text-primary/90 hover:underline"
          onClick={() => navigate('/data-corrections')}
        >
          Review flagged readings →
        </Button>
      </div>
    </Card>
  );
}
