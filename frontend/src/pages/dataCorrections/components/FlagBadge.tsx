
export function FlagBadge({ reason }: { reason?: string }) {
  switch (reason) {
    case 'backward':
      return (
        <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-destructive/10 text-destructive border border-destructive/20">
          ↓ backward
        </span>
      );
    case 'unchanged':
      return (
        <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground border border-border">
          ⏸ unchanged (0 m³)
        </span>
      );
    case 'edited':
      return (
        <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-info-soft text-info border border-info/30">
          ✎ edited
        </span>
      );
    case 'spike':
    default:
      return (
        <span className="text-2xs px-1.5 py-0.5 rounded font-medium bg-warn-soft text-warn border border-warn/30">
          ↑ spike
        </span>
      );
  }
}