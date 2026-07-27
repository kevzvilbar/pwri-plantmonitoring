import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileSearch } from 'lucide-react';

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

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['dashboard-pending-review-count', plantIds],
    queryFn: async () => {
      const counts = await Promise.all(
        PENDING_REVIEW_TABLES.map((t) => {
          let q = supabase.from(t as any).select('id', { count: 'exact', head: true }).eq('norm_status', 'pending_review');
          if (plantIds.length) q = q.in('plant_id', plantIds);
          return q as any;
        }),
      );
      return counts.reduce((sum, r) => sum + (r.count ?? 0), 0);
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (pendingCount === 0) {
    return (
      <Card className="p-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <FileSearch className="h-4 w-4 shrink-0" aria-hidden />
        No readings awaiting review.
      </Card>
    );
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-amber-600 shrink-0" aria-hidden />
        <span className="text-[12px] font-medium">Pending review</span>
        <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40 text-[10px] font-medium">
          {pendingCount} reading{pendingCount > 1 ? 's' : ''}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Flagged as backward or a spike, waiting on Admin/Data Analyst review before they normalize.
      </p>

      <div className="flex justify-end pt-0.5 border-t border-border/40">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-[11px] text-muted-foreground"
          onClick={() => navigate('/data-corrections')}
        >
          Review now →
        </Button>
      </div>
    </Card>
  );
}
