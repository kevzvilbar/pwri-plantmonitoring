import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clock, AlertCircle } from 'lucide-react';
import { AuditLogTab } from './AuditLogTab';
import { NormalizationAuditTab } from './NormalizationAuditTab';

interface AuditTabsSectionProps {
  sourceTable: string;
}

export function AuditTabsSection({ sourceTable }: AuditTabsSectionProps) {
  return (
    <Card>
      <Tabs defaultValue="audit">
        <CardHeader className="pb-0 pt-4 px-4">
          <TabsList className="grid w-full grid-cols-2 max-w-xs">
            <TabsTrigger value="audit" className="text-xs">
              <Clock className="h-3 w-3 mr-1" /> Edit Audit
            </TabsTrigger>
            <TabsTrigger value="normalization" className="text-xs">
              <AlertCircle className="h-3 w-3 mr-1" /> Flagged Readings
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="pt-3 px-3 pb-4">
          <TabsContent value="audit" className="mt-0">
            <AuditLogTab sourceTable={sourceTable} />
          </TabsContent>
          <TabsContent value="normalization" className="mt-0">
            <NormalizationAuditTab sourceTable={sourceTable} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
