import { Card } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { Signal } from '@/components/ui/Signal';
import { Activity } from 'lucide-react';
import { sevTier } from './constants';

interface SystemLogsListProps {
  filteredLogs: any[];
  onNavigate: (path: string) => void;
  onDelete: (id: string) => void;
}

export function SystemLogsList({ filteredLogs, onNavigate, onDelete }: SystemLogsListProps) {
  if (filteredLogs.length > 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filteredLogs.map((n) => {
          const tier = sevTier(n.severity);
          return (
            <Signal
              key={n.id}
              variant="card"
              tone={tier}
              title={n.title}
              description={n.message ?? undefined}
              icon={Activity}
              timestamp={n.created_at}
              linkPath={n.link_path ?? undefined}
              onNavigate={(path) => onNavigate(path)}
              onDismiss={() => onDelete(n.id)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <Card className="py-14 text-center space-y-3 rounded-2xl border-dashed">
      <div className="h-12 w-12 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
        <FileText className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h4 className="text-sm font-bold text-foreground">No system logs found</h4>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          No historical workflow notifications match your filter query.
        </p>
      </div>
    </Card>
  );
}
