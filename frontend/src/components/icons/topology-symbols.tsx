/**
 * P&ID / SCADA Process Flow Symbols for Plant Topology
 * -----------------------------------------------------
 * Moderate-detail industrial symbols for water treatment RO plants.
 * Each symbol is a self-contained SVG component with proper P&ID representation.
 */

import * as React from 'react';

export interface SymbolProps {
  size?: number | string;
  className?: string;
  accent?: string;
  status?: string;
}

function baseProps(props: SymbolProps) {
  const { size, className, ...rest } = props;
  return {
    width: size ?? 48,
    height: size ?? 48,
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    ...rest,
  };
}

function getStatusColor(status?: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'running' || s === 'online') return 'hsl(var(--accent))';
  if (s === 'maintenance' || s === 'standby' || s === 'warning') return 'hsl(var(--warn))';
  if (s === 'error' || s === 'alarm' || s === 'fault') return 'hsl(var(--danger))';
  return 'hsl(var(--muted-foreground))';
}

function StatusDot({ status, cx, cy, r = 3 }: { status?: string; cx: number; cy: number; r?: number }) {
  return (
    <circle cx={cx} cy={cy} r={r}
      fill={getStatusColor(status)}
      stroke="hsl(var(--card))" strokeWidth={1.2} />
  );
}

export function WellSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="16" opacity={0.15} />
      <circle cx="24" cy="24" r="16" />
      <circle cx="24" cy="24" r="11" opacity={0.3} />
      <path d="M24 14 C24 14 18 22 18 27 C18 30.3 20.7 33 24 33 C27.3 33 30 30.3 30 27 C30 22 24 14 24 14 Z" opacity={0.25} />
      <path d="M24 17 C24 17 20 23 20 26.5 C20 29.5 22.2 31 24 31 C25.8 31 28 29.5 28 26.5 C28 23 24 17 24 17 Z" />
      <path d="M20.5 26 C21.5 24 23 24 24 25 C25 26 26.5 26 27.5 25" opacity={0.4} />
      <rect x="21" y="8" width="6" height="4" rx="1" opacity={0.3} />
      <line x1="24" y1="4" x2="24" y2="8" opacity={0.4} />
      <StatusDot status={status} cx={37} cy={11} r={3.5} />
    </svg>
  );
}

export function RawMeterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <circle cx="24" cy="22" r="14" opacity={0.12} />
      <circle cx="24" cy="22" r="14" />
      <circle cx="24" cy="22" r="9" opacity={0.2} />
      <line x1="18" y1="19" x2="30" y2="19" opacity={0.5} />
      <line x1="18" y1="22" x2="30" y2="22" opacity={0.5} />
      <line x1="18" y1="25" x2="30" y2="25" opacity={0.5} />
      <circle cx="24" cy="22" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="24" cy="22" r="4.5" fill="currentColor" opacity={0.08} />
      <text x="24" y="24" textAnchor="middle" fontSize="5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.7}>W</text>
      <line x1="38" y1="22" x2="43" y2="22" />
      <polyline points="41,19 43,22 41,25" />
      <line x1="10" y1="22" x2="5" y2="22" />
      <polyline points="7,19 5,22 7,25" />
      <StatusDot status={status} cx={37} cy={10} r={3.5} />
    </svg>
  );
}

export function FeedMeterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 56 40">
      <rect x="8" y="10" width="40" height="20" rx="3" opacity={0.1} />
      <rect x="8" y="10" width="40" height="20" rx="3" />
      <line x1="22" y1="8" x2="22" y2="12" strokeDasharray="2 1.5" opacity={0.6} />
      <line x1="34" y1="8" x2="34" y2="12" strokeDasharray="2 1.5" opacity={0.6} />
      <line x1="22" y1="28" x2="22" y2="32" strokeDasharray="2 1.5" opacity={0.6} />
      <line x1="34" y1="28" x2="34" y2="32" strokeDasharray="2 1.5" opacity={0.6} />
      <line x1="22" y1="8" x2="22" y2="5" opacity={0.5} />
      <line x1="34" y1="8" x2="34" y2="5" opacity={0.5} />
      <line x1="12" y1="20" x2="16" y2="20" opacity={0.7} />
      <polyline points="14,17 16,20 14,23" opacity={0.7} />
      <line x1="40" y1="20" x2="44" y2="20" opacity={0.7} />
      <polyline points="42,17 44,20 42,23" opacity={0.7} />
      <circle cx="28" cy="20" r="2.8" fill="currentColor" opacity={0.12} />
      <text x="28" y="22" textAnchor="middle" fontSize="4.5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.8}>E</text>
      <rect x="6" y="12" width="4" height="16" rx="1" opacity={0.3} />
      <rect x="46" y="12" width="4" height="16" rx="1" opacity={0.3} />
      <StatusDot status={status} cx={50} cy={6} r={3.5} />
    </svg>
  );
}

export function PretreatSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 56">
      <rect x="10" y="8" width="28" height="38" rx="4" opacity={0.1} />
      <rect x="10" y="8" width="28" height="38" rx="4" />
      <line x1="24" y1="4" x2="24" y2="8" />
      <rect x="21" y="2" width="6" height="4" rx="1" opacity={0.4} />
      <line x1="24" y1="46" x2="24" y2="52" />
      <rect x="12" y="32" width="24" height="6" rx="1" opacity={0.2} />
      <rect x="12" y="26" width="24" height="6" rx="1" opacity={0.15} />
      <rect x="12" y="20" width="24" height="6" rx="1" opacity={0.25} />
      <line x1="12" y1="32" x2="36" y2="32" opacity={0.3} />
      <line x1="12" y1="26" x2="36" y2="26" opacity={0.3} />
      <line x1="12" y1="20" x2="36" y2="20" opacity={0.3} />
      <line x1="14" y1="12" x2="34" y2="12" opacity={0.3} />
      <line x1="16" y1="14" x2="16" y2="16" opacity={0.25} />
      <line x1="20" y1="14" x2="20" y2="17" opacity={0.25} />
      <line x1="24" y1="14" x2="24" y2="17" opacity={0.25} />
      <line x1="28" y1="14" x2="28" y2="17" opacity={0.25} />
      <line x1="32" y1="14" x2="32" y2="16" opacity={0.25} />
      <line x1="16" y1="46" x2="14" y2="52" opacity={0.4} />
      <line x1="32" y1="46" x2="34" y2="52" opacity={0.4} />
      <rect x="10" y="46" width="28" height="6" rx="1" opacity={0.15} />
      <text x="24" y="50.5" textAnchor="middle" fontSize="3.5" fontWeight={600} fontFamily="monospace" fill="currentColor" opacity={0.6}>FILTER</text>
      <StatusDot status={status} cx={38} cy={6} r={3.5} />
    </svg>
  );
}

export function ROTrainSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 80 44">
      <rect x="4" y="8" width="22" height="14" rx="7" opacity={0.1} />
      <rect x="4" y="8" width="22" height="14" rx="7" />
      <line x1="8" y1="15" x2="14" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <line x1="16" y1="15" x2="22" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <line x1="2" y1="15" x2="4" y2="15" opacity={0.5} />
      <line x1="26" y1="15" x2="28" y2="15" opacity={0.5} />
      <rect x="28" y="8" width="22" height="14" rx="7" opacity={0.1} />
      <rect x="28" y="8" width="22" height="14" rx="7" />
      <line x1="32" y1="15" x2="38" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <line x1="40" y1="15" x2="46" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <rect x="52" y="8" width="22" height="14" rx="7" opacity={0.1} />
      <rect x="52" y="8" width="22" height="14" rx="7" />
      <line x1="56" y1="15" x2="62" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <line x1="64" y1="15" x2="70" y2="15" strokeDasharray="1.5 1" opacity={0.6} />
      <line x1="15" y1="22" x2="15" y2="30" opacity={0.4} />
      <line x1="39" y1="22" x2="39" y2="30" opacity={0.4} />
      <line x1="63" y1="22" x2="63" y2="30" opacity={0.4} />
      <line x1="15" y1="30" x2="63" y2="30" opacity={0.5} />
      <line x1="39" y1="30" x2="39" y2="36" opacity={0.5} />
      <line x1="74" y1="15" x2="78" y2="15" opacity={0.4} />
      <line x1="78" y1="15" x2="78" y2="34" opacity={0.4} />
      <line x1="63" y1="34" x2="78" y2="34" opacity={0.4} />
      <line x1="2" y1="15" x2="0" y2="15" opacity={0.5} />
      <text x="15" y="27" textAnchor="middle" fontSize="2.8" fontFamily="monospace" opacity={0.4}>S1</text>
      <text x="39" y="27" textAnchor="middle" fontSize="2.8" fontFamily="monospace" opacity={0.4}>S2</text>
      <text x="63" y="27" textAnchor="middle" fontSize="2.8" fontFamily="monospace" opacity={0.4}>S3</text>
      <text x="39" y="41" textAnchor="middle" fontSize="3.5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.6}>RO MEMBRANE</text>
      <StatusDot status={status} cx={76} cy={5} r={3.5} />
    </svg>
  );
}

export function PermeateSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <path d="M24 12 C24 12 16 22 16 28 C16 33.5 20.5 37 24 37 C27.5 37 32 33.5 32 28 C32 22 24 12 24 12 Z" opacity={0.15} />
      <path d="M24 14 C24 14 18 23 18 28 C18 32.4 21.3 35 24 35 C26.7 35 30 32.4 30 28 C30 23 24 14 24 14 Z" />
      <polyline points="21,27 23,29 27,23" strokeWidth={1.5} />
      <circle cx="24" cy="26" r="18" strokeDasharray="3 3" opacity={0.2} />
      <line x1="24" y1="37" x2="24" y2="42" opacity={0.5} />
      <polyline points="22,40 24,42 26,40" opacity={0.5} />
      <circle cx="24" cy="26" r="2.5" fill="currentColor" opacity={0.12} />
      <text x="24" y="28" textAnchor="middle" fontSize="4" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.8}>P</text>
      <StatusDot status={status} cx={38} cy={10} r={3.5} />
    </svg>
  );
}

export function RejectSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <path d="M24 12 C24 12 16 22 16 28 C16 33.5 20.5 37 24 37 C27.5 37 32 33.5 32 28 C32 22 24 12 24 12 Z" opacity={0.12} />
      <path d="M24 15 C24 15 18 23 18 28 C18 32.4 21.3 35 24 35 C26.7 35 30 32.4 30 28 C30 23 24 15 24 15 Z" opacity={0.7} />
      <path d="M20 25 C21 23 23 23 24 24 C25 25 27 25 28 24" opacity={0.5} />
      <path d="M20 28 C21 26 23 26 24 27 C25 28 27 28 28 27" opacity={0.4} />
      <line x1="21" y1="22" x2="27" y2="30" strokeWidth={1.2} opacity={0.6} />
      <line x1="27" y1="22" x2="21" y2="30" strokeWidth={1.2} opacity={0.6} />
      <circle cx="24" cy="26" r="18" strokeDasharray="4 2" opacity={0.25} />
      <line x1="24" y1="37" x2="24" y2="43" opacity={0.4} />
      <polyline points="21,40 24,43 27,40" opacity={0.4} />
      <circle cx="24" cy="26" r="2.5" fill="currentColor" opacity={0.1} />
      <text x="24" y="28" textAnchor="middle" fontSize="4" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.7}>R</text>
      <StatusDot status={status} cx={38} cy={10} r={3.5} />
    </svg>
  );
}

export function BulkMeterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="15" opacity={0.1} />
      <circle cx="24" cy="24" r="15" />
      <circle cx="24" cy="24" r="10" opacity={0.15} />
      <circle cx="24" cy="24" r="10" />
      <line x1="19" y1="21" x2="29" y2="21" opacity={0.5} />
      <line x1="19" y1="24" x2="29" y2="24" opacity={0.5} />
      <line x1="19" y1="27" x2="29" y2="27" opacity={0.5} />
      <circle cx="24" cy="24" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="24" cy="24" r="5" fill="currentColor" opacity={0.08} />
      <text x="24" y="26.5" textAnchor="middle" fontSize="5.5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.8}>B</text>
      <line x1="39" y1="24" x2="44" y2="24" />
      <polyline points="42,21 44,24 42,27" />
      <line x1="10" y1="24" x2="5" y2="24" />
      <polyline points="7,21 5,24 7,27" />
      <line x1="24" y1="39" x2="24" y2="43" opacity={0.4} />
      <line x1="18" y1="39" x2="16" y2="43" opacity={0.3} />
      <line x1="30" y1="39" x2="32" y2="43" opacity={0.3} />
      <StatusDot status={status} cx={38} cy={10} r={3.5} />
    </svg>
  );
}

export function TankSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 52">
      <rect x="10" y="10" width="28" height="32" rx="3" opacity={0.1} />
      <rect x="10" y="10" width="28" height="32" rx="3" />
      <path d="M10 10 Q24 2 38 10" opacity={0.3} />
      <path d="M12 10 Q24 4 36 10" />
      <rect x="12" y="24" width="24" height="16" rx="1" opacity={0.15} />
      <line x1="12" y1="28" x2="36" y2="28" strokeDasharray="2 1.5" opacity={0.3} />
      <line x1="12" y1="32" x2="36" y2="32" strokeDasharray="2 1.5" opacity={0.3} />
      <rect x="19" y="14" width="10" height="8" rx="2" opacity={0.3} />
      <line x1="24" y1="14" x2="24" y2="22" opacity={0.2} />
      <line x1="24" y1="2" x2="24" y2="10" />
      <line x1="38" y1="30" x2="43" y2="30" />
      <rect x="36" y="28" width="4" height="4" rx="1" opacity={0.3} />
      <line x1="15" y1="42" x2="13" y2="48" opacity={0.4} />
      <line x1="33" y1="42" x2="35" y2="48" opacity={0.4} />
      <line x1="20" y1="42" x2="20" y2="48" opacity={0.3} />
      <line x1="28" y1="42" x2="28" y2="48" opacity={0.3} />
      <StatusDot status={status} cx={38} cy={6} r={3.5} />
    </svg>
  );
}

export function SolarSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 56 44">
      <rect x="4" y="8" width="48" height="28" rx="2" opacity={0.1} />
      <rect x="4" y="8" width="48" height="28" rx="2" />
      <line x1="4" y1="15" x2="52" y2="15" opacity={0.4} />
      <line x1="4" y1="22" x2="52" y2="22" opacity={0.4} />
      <line x1="4" y1="29" x2="52" y2="29" opacity={0.4} />
      <line x1="14" y1="8" x2="14" y2="36" opacity={0.4} />
      <line x1="24" y1="8" x2="24" y2="36" opacity={0.4} />
      <line x1="34" y1="8" x2="34" y2="36" opacity={0.4} />
      <line x1="44" y1="8" x2="44" y2="36" opacity={0.4} />
      <rect x="5" y="9" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.08} />
      <rect x="15" y="9" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.06} />
      <rect x="25" y="9" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.08} />
      <rect x="35" y="9" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.06} />
      <rect x="5" y="16" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.06} />
      <rect x="15" y="16" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.08} />
      <rect x="25" y="16" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.06} />
      <rect x="35" y="16" width="9" height="6" rx="0.5" fill="currentColor" opacity={0.08} />
      <rect x="22" y="32" width="12" height="4" rx="1" opacity={0.4} />
      <line x1="28" y1="36" x2="28" y2="40" opacity={0.5} />
      <line x1="28" y1="40" x2="32" y2="42" opacity={0.4} />
      <circle cx="48" cy="5" r="3" opacity={0.15} />
      <circle cx="48" cy="5" r="2" opacity={0.5} />
      <line x1="48" y1="1" x2="48" y2="0" opacity={0.3} />
      <line x1="52" y1="5" x2="53" y2="5" opacity={0.3} />
      <line x1="44" y1="5" x2="43" y2="5" opacity={0.3} />
      <StatusDot status={status} cx={8} cy={5} r={3} />
    </svg>
  );
}

export function GridSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 40 52">
      <line x1="8" y1="12" x2="32" y2="12" strokeWidth={1.5} />
      <line x1="12" y1="22" x2="28" y2="22" strokeWidth={1.2} />
      <line x1="14" y1="46" x2="18" y2="12" />
      <line x1="26" y1="46" x2="22" y2="12" />
      <line x1="16" y1="30" x2="20" y2="22" opacity={0.4} />
      <line x1="24" y1="30" x2="20" y2="22" opacity={0.4} />
      <line x1="15" y1="38" x2="19" y2="30" opacity={0.4} />
      <line x1="25" y1="38" x2="21" y2="30" opacity={0.4} />
      <line x1="18" y1="12" x2="16" y2="22" opacity={0.3} />
      <line x1="22" y1="12" x2="24" y2="22" opacity={0.3} />
      <rect x="10" y="9" width="3" height="5" rx="1" opacity={0.5} />
      <rect x="18.5" y="9" width="3" height="5" rx="1" opacity={0.5} />
      <rect x="27" y="9" width="3" height="5" rx="1" opacity={0.5} />
      <path d="M11 9 Q8 6 5 7" opacity={0.4} />
      <path d="M20 9 Q20 5 20 3" opacity={0.4} />
      <path d="M29 9 Q32 6 35 7" opacity={0.4} />
      <line x1="12" y1="46" x2="28" y2="46" strokeWidth={2} opacity={0.3} />
      <line x1="14" y1="48" x2="26" y2="48" strokeWidth={1.5} opacity={0.2} />
      <polyline points="18,33 21,37 19,37 22,42" fill="none" strokeWidth={1.5} opacity={0.5} />
      <StatusDot status={status} cx={5} cy={5} r={3} />
    </svg>
  );
}

export function PowerMeterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="15" opacity={0.1} />
      <circle cx="24" cy="24" r="15" />
      <circle cx="24" cy="24" r="10" opacity={0.12} />
      <circle cx="24" cy="24" r="10" />
      <text x="24" y="22" textAnchor="middle" fontSize="4.5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.8}>kWh</text>
      <line x1="19" y1="26" x2="29" y2="26" opacity={0.4} />
      <line x1="19" y1="29" x2="29" y2="29" opacity={0.4} />
      <circle cx="24" cy="24" r="1" fill="currentColor" stroke="none" />
      <rect x="14" y="6" width="4" height="3" rx="1" opacity={0.4} />
      <rect x="30" y="6" width="4" height="3" rx="1" opacity={0.4} />
      <line x1="16" y1="6" x2="16" y2="4" opacity={0.3} />
      <line x1="32" y1="6" x2="32" y2="4" opacity={0.3} />
      <rect x="14" y="39" width="4" height="3" rx="1" opacity={0.4} />
      <rect x="30" y="39" width="4" height="3" rx="1" opacity={0.4} />
      <line x1="16" y1="39" x2="16" y2="42" opacity={0.3} />
      <line x1="32" y1="39" x2="32" y2="42" opacity={0.3} />
      <polyline points="23,14 25,17 24,17 26,20" fill="none" strokeWidth={1} opacity={0.4} />
      <StatusDot status={status} cx={38} cy={10} r={3.5} />
    </svg>
  );
}

export function LocatorSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      <circle cx="24" cy="20" r="13" opacity={0.1} />
      <circle cx="24" cy="20" r="13" />
      <circle cx="24" cy="20" r="8" opacity={0.15} />
      <line x1="19" y1="17" x2="29" y2="17" opacity={0.5} />
      <line x1="19" y1="20" x2="29" y2="20" opacity={0.5} />
      <line x1="19" y1="23" x2="29" y2="23" opacity={0.5} />
      <circle cx="24" cy="20" r="1" fill="currentColor" stroke="none" />
      <circle cx="24" cy="20" r="4" fill="currentColor" opacity={0.08} />
      <text x="24" y="22" textAnchor="middle" fontSize="4.5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.8}>L</text>
      <line x1="24" y1="33" x2="24" y2="38" opacity={0.5} />
      <polyline points="22,36 24,38 26,36" opacity={0.5} />
      <line x1="14" y1="33" x2="10" y2="38" opacity={0.4} />
      <polyline points="11,36 10,38 12,37" opacity={0.4} />
      <line x1="34" y1="33" x2="38" y2="38" opacity={0.4} />
      <polyline points="37,36 38,38 36,37" opacity={0.4} />
      <line x1="24" y1="7" x2="24" y2="3" opacity={0.4} />
      <StatusDot status={status} cx={37} cy={8} r={3.5} />
    </svg>
  );
}

// ─── Per-train pre-treatment chain symbols ───────────────────────────────────
// Each primary RO train carries its own set: Raw Tank → Raw Water Pump →
// AFM/MMF → Bag/Cartridge Filter → High Pressure Pump → Feed Meter → Train.

export function RawTankSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Vertical storage tank with domed top and level marks */}
      <rect x="14" y="10" width="20" height="30" rx="4" opacity={0.12} />
      <rect x="14" y="10" width="20" height="30" rx="4" />
      <line x1="18" y1="18" x2="30" y2="18" opacity={0.25} />
      <line x1="18" y1="24" x2="30" y2="24" opacity={0.45} />
      <line x1="18" y1="30" x2="30" y2="30" opacity={0.25} />
      <rect x="21" y="4" width="6" height="6" rx="1" opacity={0.4} />
      {/* Inlet (top left, arrow in) + outlet (bottom right, arrow out) */}
      <line x1="5" y1="14" x2="14" y2="14" />
      <polyline points="10,11 14,14 10,17" />
      <line x1="34" y1="36" x2="43" y2="36" />
      <polyline points="40,33 43,36 40,39" />
      <StatusDot status={status} cx={38} cy={8} r={3.5} />
    </svg>
  );
}

export function RawWaterPumpSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Centrifugal pump volute with impeller */}
      <circle cx="24" cy="27" r="12" opacity={0.12} />
      <circle cx="24" cy="27" r="12" />
      <path d="M24 27 L24 19 M24 27 L31 31 M24 27 L17 31" />
      <circle cx="24" cy="27" r="2" fill="currentColor" stroke="none" />
      {/* Motor block behind the volute */}
      <rect x="6" y="23" width="6" height="8" rx="1.5" opacity={0.5} />
      {/* Suction in (left) + discharge out (right) */}
      <line x1="1" y1="27" x2="6" y2="27" opacity={0.6} />
      <line x1="36" y1="27" x2="43" y2="27" />
      <polyline points="40,24 43,27 40,30" />
      <StatusDot status={status} cx={38} cy={8} r={3.5} />
    </svg>
  );
}

export function MediaFilterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Pressurized vertical media vessel (AFM / MMF / sand) */}
      <rect x="16" y="6" width="16" height="34" rx="5" opacity={0.12} />
      <rect x="16" y="6" width="16" height="34" rx="5" />
      {/* Media bed layers + grains */}
      <line x1="16" y1="22" x2="32" y2="22" opacity={0.5} />
      <line x1="16" y1="30" x2="32" y2="30" opacity={0.5} />
      <circle cx="24" cy="18" r="0.8" fill="currentColor" stroke="none" opacity={0.5} />
      <circle cx="20" cy="26" r="0.8" fill="currentColor" stroke="none" opacity={0.5} />
      <circle cx="28" cy="26" r="0.8" fill="currentColor" stroke="none" opacity={0.5} />
      {/* Underdrain spokes */}
      <line x1="19" y1="40" x2="19" y2="36" opacity={0.4} />
      <line x1="24" y1="41" x2="24" y2="36" opacity={0.4} />
      <line x1="29" y1="40" x2="29" y2="36" opacity={0.4} />
      <line x1="6" y1="14" x2="16" y2="14" />
      <polyline points="12,11 16,14 12,17" />
      <line x1="32" y1="36" x2="42" y2="36" />
      <polyline points="39,33 42,36 39,39" />
      <StatusDot status={status} cx={38} cy={7} r={3.5} />
    </svg>
  );
}

export function CartridgeFilterSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Bag / cartridge housing with core element */}
      <rect x="17" y="8" width="14" height="30" rx="3" opacity={0.12} />
      <rect x="17" y="8" width="14" height="30" rx="3" />
      <rect x="20" y="12" width="8" height="3" rx="1" opacity={0.5} />
      <line x1="24" y1="15" x2="24" y2="30" opacity={0.6} />
      <path d="M20 20 H28 M20 26 H28" opacity={0.35} />
      <path d="M21 31 L21 24 M24 31 L24 22 M27 31 L27 24" opacity={0.3} />
      <line x1="7" y1="14" x2="17" y2="14" />
      <polyline points="13,11 17,14 13,17" />
      <line x1="31" y1="34" x2="41" y2="34" />
      <polyline points="38,31 41,34 38,37" />
      <StatusDot status={status} cx={37} cy={6} r={3.5} />
    </svg>
  );
}

export function HPPumpSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Multi-stage high-pressure centrifugal pump */}
      <circle cx="20" cy="27" r="11" opacity={0.12} />
      <circle cx="20" cy="27" r="11" />
      <circle cx="20" cy="27" r="6" opacity={0.4} />
      <path d="M20 27 L20 21 M20 27 L25.2 30 M20 27 L14.8 30" />
      <circle cx="20" cy="27" r="1.5" fill="currentColor" stroke="none" />
      {/* Stage pressure ramps */}
      <path d="M31 23 H37 M31 27 H40 M31 31 H37" opacity={0.5} />
      {/* Suction in (top) + high-pressure discharge (right, thicker) */}
      <line x1="20" y1="6" x2="20" y2="16" />
      <polyline points="17,13 20,16 23,13" />
      <line x1="31" y1="27" x2="42" y2="27" strokeWidth={2} />
      <polyline points="39,24 42,27 39,30" />
      <StatusDot status={status} cx={36} cy={9} r={3.5} />
    </svg>
  );
}
// ─── Product water storage ───────────────────────────────────────────────────

export function ProductTankSymbol({ size, className, accent, status }: SymbolProps) {
  return (
    <svg {...baseProps({ size, className })} viewBox="0 0 48 48">
      {/* Atmospheric product-water storage tank with domed roof */}
      <path d="M13 12 Q24 4 35 12 L35 38 Q24 43 13 38 Z" opacity={0.12} />
      <path d="M13 12 Q24 4 35 12 L35 38 Q24 43 13 38 Z" />
      {/* Stored product water level (finished water sits high in the tank) */}
      <path d="M13 22 Q24 26 35 22 L35 38 Q24 43 13 38 Z" opacity={0.18} />
      <line x1="13" y1="22" x2="35" y2="22" opacity={0.45} />
      <line x1="13" y1="28" x2="35" y2="28" opacity={0.2} />
      <line x1="13" y1="33" x2="35" y2="33" opacity={0.2} />
      {/* Vent on the roof */}
      <line x1="24" y1="7" x2="24" y2="3" opacity={0.4} />
      {/* Inlet manifold (top left, arrow in) + outlet header (bottom right) */}
      <line x1="4" y1="15" x2="13" y2="15" />
      <polyline points="9,12 13,15 9,18" />
      <line x1="35" y1="36" x2="44" y2="36" />
      <polyline points="41,33 44,36 41,39" />
      <text x="24" y="34" textAnchor="middle" fontSize="5" fontWeight={700} fontFamily="monospace" fill="currentColor" opacity={0.5}>P</text>
      <StatusDot status={status} cx={38} cy={8} r={3.5} />
    </svg>
  );
}
