import { useState, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-1 py-2 hover:bg-muted/30 rounded-md transition-colors text-left group"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-foreground">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}
