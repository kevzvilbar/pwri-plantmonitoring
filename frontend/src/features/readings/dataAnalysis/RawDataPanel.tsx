import { type RawReading } from '@/lib/regressionCorrection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database } from 'lucide-react';
import { RawDataTable } from './RawDataTable';

interface RawDataPanelProps {
  sourceTable: string;
  column: string;
  plantId: string;
  entityId: string;
  dateFrom: string;
  dateTo: string;
  canEdit: boolean;
  onEdit: (reading: RawReading) => void;
}

export function RawDataPanel({
  sourceTable,
  column,
  plantId,
  entityId,
  dateFrom,
  dateTo,
  canEdit,
  onEdit,
}: RawDataPanelProps) {
  return (
    <Card className="xl:col-span-3">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Raw Data
          <Badge variant="outline" className="text-2xs ml-1">Read-only source</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Latest 200 rows for <span className="font-mono font-medium">{column}</span>.
          {canEdit && ' Click ✏ to edit a value (logged to audit trail).'}
        </p>
      </CardHeader>
      <CardContent className="px-3 pb-4">
        <RawDataTable
          sourceTable={sourceTable}
          column={column}
          plantId={plantId}
          entityId={entityId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          canEdit={canEdit}
          onEdit={onEdit}
        />
      </CardContent>
    </Card>
  );
}
