export type WaterBalanceTotals = {
  hasAnyData: boolean;
  rawWater: number;
  production: number;
  locatorConsumption: number;
  blending: number;
};

export type BridgeRow = {
  name: string;
  base: number;
  height: number;
  fill: string;
  deltaLabel: string;
  kind: 'start' | 'delta' | 'end';
};
