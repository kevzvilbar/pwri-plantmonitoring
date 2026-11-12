export function SummaryCount({ label }: { label: string }) {
  const [active, total] = label.split('/').map(Number);
  const allActive = active === total && total > 0;
  const noneActive = active === 0;
  const color = allActive
    ? 'text-accent'
    : noneActive && total > 0
      ? 'text-warn'
      : 'text-foreground';
  return (
    <div className={`font-mono-num text-sm font-medium ${color}`}>
      {active}
      <span className="text-muted-foreground font-normal">/{total}</span>
    </div>
  );
}
