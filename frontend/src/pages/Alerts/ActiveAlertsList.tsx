import { Card } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';
import { Signal } from '@/components/ui/Signal';
import { getAlertIcon, sevTier } from './constants';

interface ActiveAlertsListProps {
  filteredPlantAlerts: any[];
  plantNameById: Map<string, string>;
  onNavigate: (path: string) => void;
  onSnooze: (id: string, ms: number) => void;
  onDismiss: (id: string) => void;
}

export function ActiveAlertsList({
  filteredPlantAlerts, plantNameById, onNavigate, onSnooze, onDismiss,
}: ActiveAlertsListProps) {
  if (filteredPlantAlerts.length > 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filteredPlantAlerts.map((alert) => {
          const Icon = getAlertIcon(alert);
          const plantName = plantNameById.get(alert.plantId);
          const tier = sevTier(alert.severity);

          return (
            <Signal
              key={alert.id}
              variant="card"
              tone={tier}
              title={alert.title}
              description={alert.description}
              icon={Icon}
              plantName={plantName}
              source={alert.source}
              timestamp={alert.timestamp}
              linkPath={alert.linkPath ?? undefined}
              onNavigate={(path) => onNavigate(path)}
              onSnooze={(ms) => onSnooze(alert.id, ms)}
              onDismiss={() => onDismiss(alert.id)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <Card className="py-14 text-center space-y-3 rounded-2xl border-dashed">
      <div className="h-12 w-12 rounded-full bg-accent/10 text-accent flex items-center justify-center mx-auto">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h4 className="text-sm font-bold text-foreground">No active alarms matching criteria</h4>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          All supervised sensors and equipment in this filter set are within operating thresholds.
        </p>
      </div>
    </Card>
  );
}
