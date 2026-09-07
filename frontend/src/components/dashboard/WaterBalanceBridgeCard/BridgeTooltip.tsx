import type { BridgeRow } from './types';

function BridgeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row: BridgeRow | undefined = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{
      background: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: 10,
      fontSize: 11,
      padding: '6px 10px',
    }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div style={{ color: row.fill }}>{row.deltaLabel}</div>
    </div>
  );
}

export { BridgeTooltip };
