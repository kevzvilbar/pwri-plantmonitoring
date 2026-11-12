export function CsvPreviewTable({ rows, headers }: { rows: Record<string, string>[]; headers: string[] }) {
  if (!rows.length) return null;
  // Fixed column width — wide enough to read, narrow enough to scroll cleanly
  const colW = 120;
  return (
    <div className="rounded border overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto max-h-44 text-2xs">
        <table className="table-fixed text-left w-max" style={{ minWidth: headers.length * colW }}>
          <thead className="bg-muted/80 sticky top-0 z-10">
            <tr>
              {headers.map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap border-b"
                    style={{ width: colW, minWidth: colW }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                {headers.map(h => (
                  <td key={h} className="px-2 py-1 truncate border-b border-border/40"
                      style={{ width: colW, maxWidth: colW }} title={row[h] ?? ''}>
                    {row[h] ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <p className="text-xs text-muted-foreground px-2 py-1 bg-muted/30 border-t">
          …and {rows.length - 10} more rows
        </p>
      )}
    </div>
  );
}
