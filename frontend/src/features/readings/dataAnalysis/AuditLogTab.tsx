import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle } from 'lucide-react';

// ── Audit Log Tab — reads raw_edit_log via Supabase ────────────────────────────

export function AuditLogTab({ sourceTable }: { sourceTable: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['raw-edit-log', sourceTable],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('raw_edit_log')
        .select('*')
        .eq('source_table', sourceTable)
        .order('edited_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { log: (data ?? []) as Array<Record<string, unknown>> };
    },
    enabled: !!sourceTable,
    retry: false,
    throwOnError: false,
  });

  const rows = data?.log ?? [];

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading audit log…</div>;
  if (isError)   return (
    <div className="flex items-center gap-2 rounded border border-warn bg-warn-soft px-3 py-2 text-xs text-warn">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      Audit log unavailable — run the <code className="font-mono">20260515_supabase_only_and_data_analysis.sql</code> migration in Supabase to create the <code className="font-mono">raw_edit_log</code> table.
    </div>
  );
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted-foreground">No edits recorded yet.</div>;

  return (
    <div className="overflow-auto max-h-[400px] rounded border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow className="text-xs">
            <TableHead>Edited at</TableHead>
            <TableHead>Column</TableHead>
            <TableHead className="text-right">Old</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="text-xs">
              <TableCell className="font-mono">{String(r.edited_at ?? '').slice(0, 16)}</TableCell>
              <TableCell className="font-mono">{String(r.column_name ?? '')}</TableCell>
              <TableCell className="text-right font-mono text-danger">{r.old_value != null ? Number(r.old_value).toFixed(3) : '—'}</TableCell>
              <TableCell className="text-right font-mono text-primary">{r.new_value != null ? Number(r.new_value).toFixed(3) : '—'}</TableCell>
              <TableCell><Badge variant="outline" className="text-2xs">{String(r.edited_role ?? '')}</Badge></TableCell>
              <TableCell className="text-muted-foreground max-w-[180px] truncate">{String(r.note ?? '')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

