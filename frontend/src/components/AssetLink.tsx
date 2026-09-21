import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useCan } from '@/hooks/usePermission';
import { assetPath, type AssetKind } from '@/shared/assetLinks';
import { cn } from '@/lib/utils';

/**
 * P5-7: the name of a well, locator or product meter on a Daily Readings row,
 * as a link to the asset's own page in Plants.
 *
 * A real `<a href>` (not a click handler in a menu), so it can be opened in a
 * new tab and an operator can keep the entry form they are typing in. The name
 * is the link because that is where people already look; the arrow says so on
 * touch screens, where there is no hover.
 *
 * Like <CanLink>, it never leads a user somewhere they cannot go: without view
 * access to Plants (a custom role can remove it) the name stays plain text.
 */
export function AssetLink({
  kind,
  plantId,
  id,
  name,
  className,
}: {
  kind: AssetKind;
  plantId: string;
  id: string;
  name: string;
  /** Typography of the name, so the row keeps its own look. */
  className?: string;
}) {
  const can = useCan();
  if (!can('plants')) return <span className={className}>{name}</span>;

  return (
    <Link
      to={assetPath(kind, plantId, id)}
      title={`Open ${name} in Plants`}
      aria-label={`Open ${name} in Plants`}
      className={cn(
        'group inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-primary hover:underline',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
        className,
      )}
    >
      <span className="min-w-0">{name}</span>
      <ArrowUpRight aria-hidden className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
