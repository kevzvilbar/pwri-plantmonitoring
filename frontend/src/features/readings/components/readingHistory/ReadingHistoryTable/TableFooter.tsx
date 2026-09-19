import React from 'react';

interface TableFooterProps {
  days: string | number;
  appliedFrom?: string;
  appliedTo?: string;
  rows: any[];
}

export function TableFooter({ days, appliedFrom, appliedTo, rows }: TableFooterProps) {
  return (
    <p className="text-2xs text-muted-foreground">
      {days === 'custom'
        ? `Showing ${appliedFrom} → ${appliedTo}`
        : `Showing up to ${days} days of history`
      } · {rows?.length ?? 0} records
    </p>
  );
}
