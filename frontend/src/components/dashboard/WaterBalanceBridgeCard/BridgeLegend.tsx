import { ModernChartLegend } from '../TrendChartLegend';
import {
  C_RAWWATER, C_RECOVERY, C_BLEND_VOLUME, C_NRW, C_CONSUMPTION,
} from '@/lib/chartColors';

function BridgeLegend() {
  return (
    <ModernChartLegend items={[
      { color: C_RAWWATER, label: 'Raw water in', shape: 'bar' },
      { color: C_RECOVERY, label: 'Treatment loss', shape: 'bar' },
      { color: C_BLEND_VOLUME, label: 'Blending', shape: 'bar' },
      { color: C_NRW, label: 'Distribution / NRW', shape: 'bar' },
      { color: C_CONSUMPTION, label: 'Locator consumption', shape: 'bar' },
    ]}
    />
  );
}

export { BridgeLegend };
