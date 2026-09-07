export function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-2 border-t border-border/40 text-2xs text-muted-foreground font-mono">
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#00b4d8]" />
        <span>Budget Target</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#f59e0b]" />
        <span>Power Cost</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#8b5cf6]" />
        <span>Chemical Cost</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#06b6d4]" />
        <span>Other (Filters)</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#3b82f6]" />
        <span>Total Actual</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-xs bg-[#ef4444]" />
        <span>Variance (+Over / −Savings)</span>
      </div>
    </div>
  );
}
