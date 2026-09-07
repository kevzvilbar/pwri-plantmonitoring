function BridgeHeader({ title, rangeLabel }: { title: string; rangeLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      <span className="text-2xs text-muted-foreground">{rangeLabel}</span>
    </div>
  );
}

export { BridgeHeader };
