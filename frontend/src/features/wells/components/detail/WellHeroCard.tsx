import { Card } from '@/components/ui/card';
import { MapPin } from 'lucide-react';

export function WellHeroCard({
  well,
  drillingDepth,
  hasCoords,
  mapsUrl,
}: {
  well: any;
  drillingDepth?: number | string | null;
  hasCoords: boolean;
  mapsUrl?: string | null;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-base">{well.name}</h3>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
            {well.diameter && <span>{well.diameter}</span>}
            {drillingDepth && <span>{drillingDepth} m depth</span>}
          </div>
          {hasCoords && mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
            >
              <MapPin className="h-3 w-3" />
              {(+well.gps_lat).toFixed(5)}, {(+well.gps_lng).toFixed(5)}
            </a>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
            well.status === 'Active'
              ? 'text-accent bg-accent-soft border-accent'
              : 'text-muted-foreground bg-muted border-border'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              well.status === 'Active' ? 'bg-accent' : 'bg-muted-foreground'
            }`}
          />
          {well.status ?? 'Active'}
        </span>
      </div>
    </Card>
  );
}
