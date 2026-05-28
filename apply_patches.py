#!/usr/bin/env python3
"""
Apply all changes to Dashboard.tsx and TrendChart.tsx.
Usage: python3 apply_patches.py <path-to-frontend-src>
Example: python3 apply_patches.py ./frontend/src
"""
import sys, re, os

src = sys.argv[1] if len(sys.argv) > 1 else '.'
DASH = os.path.join(src, 'pages/Dashboard.tsx')
TREND = os.path.join(src, 'components/dashboard/TrendChart.tsx')

def replace_all(content, pairs):
    for old, new in pairs:
        if old not in content:
            print(f"  WARN: pattern not found — skipping:\n    {repr(old[:80])}")
            continue
        content = content.replace(old, new, 1)
    return content

# ─── Dashboard.tsx ────────────────────────────────────────────────────────────
print("\n── Dashboard.tsx ──")
with open(DASH, 'r') as f:
    dash = f.read()

dash = replace_all(dash, [
    # Remove clamp on daily_volume field
    (
        'delta = Math.max(0, +r[dailyVolumeField]);',
        'delta = +r[dailyVolumeField];'
    ),
    # Remove clamp on previous_reading subtraction
    (
        'delta = Math.max(0, +r.current_reading - +r.previous_reading);',
        'delta = +r.current_reading - +r.previous_reading;'
    ),
    # Remove clamp on sequential lastReading subtraction (inside computePivotFromReadings)
    (
        '      delta = Math.max(0, +r.current_reading - lastReading.get(entityKey)!);\n      lastReading.set(entityKey, +r.current_reading);\n      // Populate the cache',
        '      delta = +r.current_reading - lastReading.get(entityKey)!;\n      lastReading.set(entityKey, +r.current_reading);\n      // Populate the cache'
    ),
])

with open(DASH, 'w') as f:
    f.write(dash)
print("  ✓ Removed 3 Math.max(0, ...) clamps in computePivotFromReadings")


# ─── TrendChart.tsx ────────────────────────────────────────────────────────────
print("\n── TrendChart.tsx ──")
with open(TREND, 'r') as f:
    trend = f.read()

# 1. Add MoreVertical to lucide imports
trend = trend.replace(
    "import { ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Sun, Zap, Download } from 'lucide-react';",
    "import { ChevronsDown, ChevronsUp, BarChart2, Filter, X, Check, Search, Sun, Zap, Download, MoreVertical } from 'lucide-react';"
)
print("  ✓ Added MoreVertical to lucide imports")

# 2. Add Popover imports after Dialog imports
trend = trend.replace(
    "import {\n  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,\n} from '@/components/ui/dialog';",
    "import {\n  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,\n} from '@/components/ui/dialog';\nimport {\n  Popover, PopoverContent, PopoverTrigger,\n} from '@/components/ui/popover';"
)
print("  ✓ Added Popover imports")

# 3. Remove accumulateRaw helper function entirely
trend = trend.replace(
    """    // Helper: accumulate raw delta into a _raw field only when it's negative.
    // Keeps null when all readings are non-negative (tooltip shows normal value).
    const accumulateRaw = (row: any, field: string, rawDelta: number | null) => {
      if (rawDelta === null) return;
      if (rawDelta < 0) {
        row[field] = (row[field] ?? 0) + rawDelta;
      }
    };

    """,
    "    "
)
print("  ✓ Removed accumulateRaw helper")

# 4. In computeEntityDeltas — remove clamps on storedVol
trend = trend.replace(
    "        const delta     = Math.max(0, storedVol);\n          lastReading.set(entityKey, +r.current_reading);\n          // daily_volume is the operator-recorded value — do NOT pass it as a\n          // rawDelta that triggers the negative-reading warning. The value is\n          // already the ground truth; clamping it to 0 is the correct display.\n          // Return rawDelta = null so accumulateRaw never fires for this path.\n          return { r, delta, rawDelta: null, isMeterReplacement: false };",
    "        const delta     = storedVol;\n          lastReading.set(entityKey, +r.current_reading);\n          return { r, delta, rawDelta: null, isMeterReplacement: false };"
)

# 5. Remove clamp on previous_reading fallback in computeEntityDeltas
trend = trend.replace(
    "            const delta    = Math.max(0, rawDelta);\n            return { r, delta, rawDelta, isMeterReplacement: false };",
    "            const delta    = rawDelta;\n            return { r, delta, rawDelta, isMeterReplacement: false };"
)

# 6. Remove clamp on sequential diff in computeEntityDeltas
trend = trend.replace(
    "        const delta    = Math.max(0, rawDelta);\n        lastReading.set(entityKey, +r.current_reading);\n        return { r, delta, rawDelta, isMeterReplacement: false };",
    "        const delta    = rawDelta;\n        lastReading.set(entityKey, +r.current_reading);\n        return { r, delta, rawDelta, isMeterReplacement: false };"
)
print("  ✓ Removed Math.max(0) clamps in computeEntityDeltas")


# 7. Remove _raw* fields from ensure() and accumulateRaw calls in chartData useMemo
trend = trend.replace(
    """        // _raw* fields accumulate the true unclamped deltas so the tooltip
        // can show the real value even when the chart plots 0 (clamped).
        // null means "no negative delta seen" → tooltip shows normal value.
        _rawProduction: null as number | null,
        _rawConsumption: null as number | null,
        _rawRawwater: null as number | null,
        _rawKwh: null as number | null,
        // _meterReplacements""",
    "        // _meterReplacements"
)
print("  ✓ Removed _raw* fields from ensure()")

# 8. Remove accumulateRaw calls in raw-water section
trend = trend.replace(
    """      row.rawwater += delta;
      accumulateRaw(row, '_rawRawwater', rawDelta);
      if (isMeterReplacement) {""",
    """      row.rawwater += delta;
      if (isMeterReplacement) {"""
)

# 9. Remove accumulateRaw calls in product meters section
trend = trend.replace(
    """      row.production += delta;
      accumulateRaw(row, '_rawProduction', rawDelta);
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';""",
    """      row.production += delta;
      if (isMeterReplacement) {
        const entityName = productMeterNames?.get(r.meter_id) ?? r.meter_id ?? 'Product Meter';"""
)

# 10. Remove accumulateRaw calls in consumption section
trend = trend.replace(
    """      row.consumption += delta;
      accumulateRaw(row, '_rawConsumption', rawDelta);
      if (isMeterReplacement) {""",
    """      row.consumption += delta;
      if (isMeterReplacement) {"""
)
print("  ✓ Removed all accumulateRaw() calls")

# 11. Remove negative clamp + accumulateRaw in power multi-meter JSONB section
trend = trend.replace(
    """            if (total >= 0) gridKwh = total;
            else accumulateRaw(ensure(format(new Date(r.reading_datetime), 'MMM d'), new Date(r.reading_datetime).getTime()), '_rawKwh', total);""",
    "            gridKwh = total;"
)

# 12. Remove negative accumulateRaw in power single-meter section
trend = trend.replace(
    """            if (rawDelta >= 0) kwh = delta * (multArr[0] ?? 1);
          } else if (pMeter != null && gridCurrent != null) {
            // Priority 2: single-meter legacy — (curr − prev) × multArr[0]
            const rawDelta = gridCurrent - pMeter;
            gridKwh = Math.max(0, rawDelta) * (multArr[0] ?? 1);
            if (rawDelta < 0) accumulateRaw(ensure(format(new Date(r.reading_datetime), 'MMM d'), new Date(r.reading_datetime).getTime()), '_rawKwh', rawDelta * (multArr[0] ?? 1));""",
    """            if (rawDelta >= 0) kwh = delta * (multArr[0] ?? 1);
          } else if (pMeter != null && gridCurrent != null) {
            // Priority 2: single-meter legacy — (curr − prev) × multArr[0]
            const rawDelta = gridCurrent - pMeter;
            gridKwh = rawDelta * (multArr[0] ?? 1);"""
)
print("  ✓ Removed negative clamps/accumulateRaw in power section")


# 13. Remove _raw* from gap-fill stub rows
trend = trend.replace(
    """        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
        // _meterReplacements is already in ...d — preserved for the tooltip""",
    """        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
        // _meterReplacements preserved for the tooltip"""
)

# 14. Remove _raw* from gap-fill allCalDays stub rows
trend = trend.replace(
    """        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
        _meterReplacements: [], _permeateSourceNames: [],
        _rawProduction: null, _rawConsumption: null, _rawRawwater: null, _rawKwh: null,""",
    """        production: null, consumption: null, rawwater: null,
        recovery: null, tds: null, kwh: null, solarKwh: null,
        nrw: null, powerCost: null, chemCost: null, totalCost: null,
        _meterReplacements: [], _permeateSourceNames: [],"""
)
print("  ✓ Removed _raw* from stub rows")

# 15. Remove negativeByDate useMemo entirely
neg_by_date_start = "\n  // ── Per-day negative-value index ────────────────────────────────────────\n  // Built from the _raw* fields stored in chartData."
neg_by_date_end = "\n  }, [chartData, metric]);\n\n  // Custom tooltip"

start_idx = trend.find(neg_by_date_start)
end_idx = trend.find(neg_by_date_end, start_idx) + len(neg_by_date_end)
if start_idx > -1 and end_idx > len(neg_by_date_end):
    trend = trend[:start_idx] + "\n\n  // Custom tooltip"
    print("  ✓ Removed negativeByDate useMemo")
else:
    print("  WARN: negativeByDate useMemo not found at expected location")


# 16. Replace NegativeAwareTooltip — keep meter replacement notice, drop negative-reading warning
old_tooltip = '''  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const warnings = negativeByDate.get(label as string) ?? [];

    // Meter replacements and permeate source info — from chartData row
    const chartRow = chartData.find((d) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];

    // Warnings that are NOT covered by a meter replacement (genuine negatives).
    // A warning is "covered" if there are replacements on this day — the zero
    // was caused by the replacement, not a true data anomaly.
    const genuineNegatives = replacements.length > 0
      ? warnings.filter((w) => {
          const entry = payload.find((p: any) => p.name === w.label);
          const chartVal = entry?.value ?? 0;
          // If the chart shows 0, the replacement explains it — not a genuine negative
          return chartVal !== 0;
        })
      : warnings;

    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)', opacity: 0.92, backdropFilter: 'blur(4px)',
      }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
        {payload.map((entry: any) => {
          // Always display the actual chart value (already clamped to ≥ 0 at
          // the data layer). Never replace it with a raw negative partial delta
          // from a single locator — entry.value is the correct aggregated total.
          const displayValue = entry.value;
          return (
            <p key={entry.dataKey} style={{
              margin: '1px 0',
              color: entry.color ?? entry.stroke,
            }}>
              {entry.name}:{' '}
              <span>
                {displayValue != null ? displayValue.toLocaleString() : '—'}
              </span>
            </p>
          );
        })}

        {/* ── Meter replacement notice — replaces negative-reading warning ── */}
        {replacements.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
          }}>
            {replacements.map((name) => (
              <div key={name} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 5,
                color: '#92400e',
                marginBottom: 2,
              }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                  {' '}
                  <span style={{ opacity: 0.75 }}>(value adjusted to 0)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Genuine negative readings (not explained by a replacement) ── */}
        {genuineNegatives.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            color: '#92400e',
          }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>⚠️</span>
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              <strong>Negative reading:</strong>{' '}
              {genuineNegatives.map((w) => w.label).join(', ')}
            </span>
          </div>
        )}

        {/* ── Permeate-source note — shown when ≥1 plant uses permeate_is_production ── */}
        {permeateSourceNames.length > 0 && (
          <div style={{
            marginTop: 6,
            paddingTop: 5,
            borderTop: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 5,
            color: 'hsl(var(--muted-foreground))',
          }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              <span style={{ opacity: 0.85 }}>
                Source: Permeate meter ({permeateSourceNames.join(', ')})
              </span>
            </span>
          </div>
        )}
      </div>
    );
  };'''

new_tooltip = '''  const NegativeAwareTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const chartRow = chartData.find((d) => d.date === label);
    const replacements: string[] = chartRow?._meterReplacements ?? [];
    const permeateSourceNames: string[] = chartRow?._permeateSourceNames ?? [];
    return (
      <div style={{
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        borderRadius: 8,
        fontSize: 11,
        padding: '8px 10px',
        minWidth: 148,
        maxWidth: 300,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)', opacity: 0.92, backdropFilter: 'blur(4px)',
      }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ margin: '1px 0', color: entry.color ?? entry.stroke }}>
            {entry.name}:{' '}
            <span>{entry.value != null ? entry.value.toLocaleString() : '—'}</span>
          </p>
        ))}
        {replacements.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))' }}>
            {replacements.map((name) => (
              <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, color: '#92400e', marginBottom: 2 }}>
                <span style={{ fontSize: 12, lineHeight: 1 }}>🔧</span>
                <span style={{ fontSize: 10, lineHeight: 1.4 }}>
                  <strong>{name} was Replaced</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        {permeateSourceNames.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'flex-start', gap: 5, color: 'hsl(var(--muted-foreground))' }}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>💧</span>
            <span style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.85 }}>
              Source: Permeate meter ({permeateSourceNames.join(', ')})
            </span>
          </div>
        )}
      </div>
    );
  };'''

if old_tooltip in trend:
    trend = trend.replace(old_tooltip, new_tooltip)
    print("  ✓ Simplified NegativeAwareTooltip (removed negative-reading warning)")
else:
    print("  WARN: NegativeAwareTooltip not matched exactly — skipping")


# 17. Add mobile ⋮ popover — replace the controls row opening section
# We insert a <Popover> wrapping the secondary controls on mobile
# Target: the section after range pills + Data Summary button, before kwh / productionCost / drill sections

old_controls_end = '''        {/* kwh: Source filter — Both / Solar / Grid + CSV Export */}
        {metric === 'kwh' && (() => {'''

new_mobile_wrap_prefix = '''        {/* ── Mobile ⋮ overflow — secondary controls ───────────────────────── */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="sm:hidden h-6 w-6 flex items-center justify-center rounded border border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
              title="More chart options"
              aria-label="More chart options"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-56 p-2.5 flex flex-col gap-3">
            {/* Drill section — production / nrw */}
            {hasConsumptionDrill && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Consumption drill</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => setDrillMode(drillMode === 'drillup' ? 'default' : 'drillup')}
                    className={['h-6 px-2 rounded text-[10px] font-medium border transition-colors leading-none flex items-center gap-1', drillMode === 'drillup' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>
                    <ChevronsUp className="h-3 w-3" />Monthly
                  </button>
                  <button onClick={() => { setDrillMode('default'); setShowLocatorFilter(false); }}
                    className={['h-6 px-2 rounded text-[10px] font-medium border transition-colors leading-none flex items-center gap-1', drillMode === 'default' ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>
                    <BarChart2 className="h-3 w-3" />Daily
                  </button>
                  <button onClick={() => setDrillMode(drillMode === 'drilldown' ? 'default' : 'drilldown')}
                    className={['h-6 px-2 rounded text-[10px] font-medium border transition-colors leading-none flex items-center gap-1', drillMode === 'drilldown' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground hover:text-foreground border-border'].join(' ')}>
                    <ChevronsDown className="h-3 w-3" />Per locator
                  </button>
                </div>
                {metric === 'production' && drillMode !== 'default' && (
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    <button onClick={() => { setProdDrillSource('locator'); setSelectedLocatorIds(null); }}
                      className={['h-6 px-2 rounded text-[10px] font-medium border', prodDrillSource === 'locator' ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Per Locator</button>
                    <button onClick={() => { setProdDrillSource('source'); setSelectedLocatorIds(null); }}
                      className={['h-6 px-2 rounded text-[10px] font-medium border', prodDrillSource === 'source' ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Per Source</button>
                  </div>
                )}
              </div>
            )}
            {/* RO drill section — tds / recovery */}
            {hasRoDrill && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">RO drill</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => { setRoDrillMode('default'); setShowTrainFilter(false); }}
                    className={['h-6 px-2 rounded text-[10px] font-medium border flex items-center gap-1', roDrillMode === 'default' ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                    <BarChart2 className="h-3 w-3" />Daily
                  </button>
                  <button onClick={() => setRoDrillMode(roDrillMode === 'by-train' ? 'default' : 'by-train')}
                    className={['h-6 px-2 rounded text-[10px] font-medium border flex items-center gap-1', roDrillMode === 'by-train' ? 'bg-chart-2 text-white border-chart-2' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                    <ChevronsDown className="h-3 w-3" />Per train
                  </button>
                  <button onClick={() => setRoDrillMode(roDrillMode === 'by-hour' ? 'default' : 'by-hour')}
                    className={['h-6 px-2 rounded text-[10px] font-medium border flex items-center gap-1', roDrillMode === 'by-hour' ? 'bg-violet-600 text-white border-violet-600' : 'bg-muted text-muted-foreground border-border'].join(' ')}>
                    <ChevronsUp className="h-3 w-3" />Hourly
                  </button>
                </div>
              </div>
            )}
            {/* Plant health granularity */}
            {hasPlantHealth && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Granularity</p>
                <div className="flex flex-wrap gap-1">
                  {(['daily','hourly','monthly'] as const).map((m) => (
                    <button key={m} onClick={() => setPhDrillMode(m)}
                      className={['h-6 px-2 rounded text-[10px] font-medium border capitalize', phDrillMode === m ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{m}</button>
                  ))}
                </div>
              </div>
            )}
            {/* Production cost toggles */}
            {metric === 'productionCost' && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Show lines</p>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => setShowTotalCostLine(v => !v)}
                    className={['h-6 px-2 rounded text-[10px] font-medium border', showTotalCostLine ? 'bg-accent text-accent-foreground border-accent' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Prod</button>
                  <button onClick={() => setShowPowerCostLine(v => !v)}
                    className={['h-6 px-2 rounded text-[10px] font-medium border', showPowerCostLine ? 'border-[hsl(var(--chart-6))] text-[hsl(var(--chart-6))] bg-[hsl(var(--chart-6))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Power</button>
                  <button onClick={() => setShowChemCostLine(v => !v)}
                    className={['h-6 px-2 rounded text-[10px] font-medium border', showChemCostLine ? 'border-[hsl(var(--highlight))] text-[hsl(var(--highlight))] bg-[hsl(var(--highlight))]/10' : 'bg-muted text-muted-foreground border-border'].join(' ')}>Chem</button>
                </div>
              </div>
            )}
            {/* kWh source filter + export */}
            {metric === 'kwh' && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Energy source</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {(['both','solar','grid'] as const).map(s => (
                    <button key={s} onClick={() => setKwhSource(s)}
                      className={['h-6 px-2 rounded text-[10px] font-medium border capitalize', kwhSource === s ? 'bg-teal-700 text-white border-teal-700' : 'bg-muted text-muted-foreground border-border'].join(' ')}>{s}</button>
                  ))}
                </div>
                <button onClick={() => {
                    if (!chartData.length) return;
                    const rows = chartData.map((d: any) => `${d.date},${+(d.solarKwh??0).toFixed(2)},${+(d.kwh??0).toFixed(2)},${+((d.solarKwh??0)+(d.kwh??0)).toFixed(2)}`);
                    const csv = ['date,solar_kwh,grid_kwh,total_kwh',...rows].join('\\n');
                    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
                    const a = document.createElement('a'); a.href=url; a.download='power_energy_mix.csv'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full h-7 rounded border border-border bg-muted text-[11px] font-medium flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
                  <Download className="h-3 w-3" /> Export CSV
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* ── Desktop-only secondary controls (hidden on mobile) ─────────────── */}
        <div className="hidden sm:contents">

        {/* kwh: Source filter — Both / Solar / Grid + CSV Export */}
        {metric === 'kwh' && (() => {'''

if old_controls_end in trend:
    trend = trend.replace(old_controls_end, new_mobile_wrap_prefix, 1)
    print("  ✓ Added mobile ⋮ Popover wrapping secondary controls")
else:
    print("  WARN: kwh controls section not found — mobile popover not inserted")

# Close the hidden sm:contents div — find the closing of the last desktop-only block
# We need to close </div> before </div> that closes the outer flex row
# The outer flex row ends right before the range/custom date input section and before the chartHeight div
old_close_target = "\n      {/* ── Data Summary Popup Dialog"
new_close_target = "\n        </div>{/* end hidden sm:contents */}\n\n      {/* ── Data Summary Popup Dialog"
if old_close_target in trend:
    trend = trend.replace(old_close_target, new_close_target, 1)
    print("  ✓ Closed hidden sm:contents div")
else:
    print("  WARN: closing div insertion point not found")

with open(TREND, 'w') as f:
    f.write(trend)
print("\n── TrendChart.tsx patches complete ──")

