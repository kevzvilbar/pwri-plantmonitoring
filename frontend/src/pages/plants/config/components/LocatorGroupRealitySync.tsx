import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export function LocatorGroupRealitySync({
  productMeters,
  locators,
  members,
  onSync,
  canEdit,
}: {
  productMeters: Array<{ id: string; name: string }>;
  locators: Array<{ id: string; name: string; product_meter_id: string | null }>;
  members: string[];
  onSync: (ids: string[]) => void;
  canEdit: boolean;
}) {
  const [meterId, setMeterId] = useState<string>('');
  if (!canEdit || productMeters.length === 0) return null;

  const realIds = meterId ? locators.filter(l => l.product_meter_id === meterId).map(l => l.id) : [];
  const memberSet = new Set(members);
  const realSet = new Set(realIds);
  const missing = realIds.filter(id => !memberSet.has(id)).length;
  const extra = members.filter(id => !realSet.has(id)).length;
  const inSync = !!meterId && missing === 0 && extra === 0;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1.5 mt-1.5 border-t border-dashed">
      <span className="text-2xs text-muted-foreground whitespace-nowrap">Compare to Assign Locators:</span>
      <Select value={meterId} onValueChange={setMeterId}>
        <SelectTrigger className="h-6 text-xs px-2 py-0 w-auto min-w-[130px]">
          <SelectValue placeholder="Pick a product meter…" />
        </SelectTrigger>
        <SelectContent>
          {productMeters.map(m => (
            <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {meterId && (
        inSync ? (
          <span className="text-2xs text-primary">✓ matches real assignment ({realIds.length})</span>
        ) : (
          <>
            <span className="text-2xs text-warn">
              ⚠ {[
                missing > 0 ? `${missing} really assigned but not listed here` : null,
                extra > 0 ? `${extra} listed here but not really assigned` : null,
              ].filter(Boolean).join(' · ')}
            </span>
            <Button size="sm" variant="outline" className="h-6 text-2xs px-2 gap-1" onClick={() => onSync(realIds)}>
              <RefreshCw className="h-2.5 w-2.5" />Use real list
            </Button>
          </>
        )
      )}
    </div>
  );
}
