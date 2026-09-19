export function MonthSelector({
  selectedMonth,
  setSelectedMonth,
  rows,
}: {
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  rows: { month: string; label: string; totalBudget: number; totalActual: number }[] | undefined;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 pt-0.5 border-b border-border/40 text-2xs">
      <span className="text-3xs uppercase font-semibold text-muted-foreground mr-1 shrink-0">Period:</span>
      <button
        className={`px-2.5 py-1 rounded-md font-medium shrink-0 transition-all ${
          selectedMonth === 'YTD'
            ? 'bg-primary text-primary-foreground font-bold shadow-xs'
            : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        onClick={() => setSelectedMonth('YTD')}
      >
        YTD Full Year
      </button>
      {(rows ?? []).map((r) => {
        const hasData = r.totalBudget > 0 || r.totalActual > 0;
        const isSel = selectedMonth === r.month;
        return (
          <button
            key={r.month}
            className={`px-2 py-1 rounded-md font-medium shrink-0 transition-all ${
              isSel
                ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                : hasData
                ? 'bg-muted/40 text-foreground hover:bg-muted/80 font-medium'
                : 'bg-muted/20 text-muted-foreground/50 hover:text-muted-foreground'
            }`}
            onClick={() => setSelectedMonth(r.month)}
          >
            {r.label.split(' ')[0]}
          </button>
        );
      })}
    </div>
  );
}
