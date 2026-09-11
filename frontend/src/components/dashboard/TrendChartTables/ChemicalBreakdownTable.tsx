import React, { useMemo } from 'react';
import {
  TH, TH_DATE, TD, fmtDateKey,
} from '../TrendChartPivotShared';
import { fmtNum } from '@/lib/calculations';

export interface ChemicalDayBreakdown {
  chlorineKg: number;
  chlorineCost: number;
  smbsKg: number;
  smbsCost: number;
  antiScalantL: number;
  antiScalantCost: number;
  sodaAshKg: number;
  sodaAshCost: number;
  freeClPcs: number;
  freeClCost: number;
  otherCost: number;
  totalCost: number;
  prodVol: number | null;
  chemCostPerM3: number | null;
}

export function ChemicalBreakdownTable({
  dates,
  chemicalBreakdown,
  overviewChartRows,
}: {
  dates: string[];
  chemicalBreakdown: Map<string, ChemicalDayBreakdown>;
  overviewChartRows: any[];
}) {
  // Check if optional columns (Free Cl, Other) have data in this range
  const hasFreeCl = useMemo(() => {
    for (const dk of dates) {
      const row = chemicalBreakdown.get(dk);
      if (row && (row.freeClPcs > 0 || row.freeClCost > 0)) return true;
    }
    return false;
  }, [dates, chemicalBreakdown]);

  const hasOther = useMemo(() => {
    for (const dk of dates) {
      const row = chemicalBreakdown.get(dk);
      if (row && row.otherCost > 0) return true;
    }
    return false;
  }, [dates, chemicalBreakdown]);

  // Period totals
  const totals = useMemo(() => {
    let totClKg = 0;
    let totClCost = 0;
    let totSmbsKg = 0;
    let totSmbsCost = 0;
    let totAsL = 0;
    let totAsCost = 0;
    let totSaKg = 0;
    let totSaCost = 0;
    let totFreeClPcs = 0;
    let totFreeClCost = 0;
    let totOtherCost = 0;
    let totGrandCost = 0;
    let totProdVol = 0;

    for (const dk of dates) {
      const row = chemicalBreakdown.get(dk);
      if (row) {
        totClKg += row.chlorineKg;
        totClCost += row.chlorineCost;
        totSmbsKg += row.smbsKg;
        totSmbsCost += row.smbsCost;
        totAsL += row.antiScalantL;
        totAsCost += row.antiScalantCost;
        totSaKg += row.sodaAshKg;
        totSaCost += row.sodaAshCost;
        totFreeClPcs += row.freeClPcs;
        totFreeClCost += row.freeClCost;
        totOtherCost += row.otherCost;
        totGrandCost += row.totalCost;
        if (row.prodVol != null && row.prodVol > 0) {
          totProdVol += row.prodVol;
        }
      }
    }

    const avgChemCostPerM3 = totProdVol > 0 ? +(totGrandCost / totProdVol).toFixed(4) : null;

    return {
      totClKg, totClCost,
      totSmbsKg, totSmbsCost,
      totAsL, totAsCost,
      totSaKg, totSaCost,
      totFreeClPcs, totFreeClCost,
      totOtherCost,
      totGrandCost,
      avgChemCostPerM3,
    };
  }, [dates, chemicalBreakdown]);

  const renderChemCell = (cost: number, qty: number, unit: string) => {
    if (cost <= 0 && qty <= 0) {
      return <span className="text-muted-foreground/40">—</span>;
    }
    return (
      <div className="flex flex-col items-end leading-tight py-0.5 font-mono">
        <span className="font-semibold text-foreground">
          ₱{fmtNum(cost, 2)}
        </span>
        {qty > 0 && (
          <span className="text-3xs text-muted-foreground/80 font-normal">
            {fmtNum(qty, 2)} {unit}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-card">
          <tr>
            <th className={TH_DATE}>Date</th>
            <th className={TH} title="Chlorine consumption and calculated cost">Chlorine (kg · ₱)</th>
            <th className={TH} title="SMBS (Sodium Metabisulfite) consumption and calculated cost">SMBS (kg · ₱)</th>
            <th className={TH} title="Anti Scalant consumption and calculated cost">Anti Scalant (L · ₱)</th>
            <th className={TH} title="Soda Ash consumption and calculated cost">Soda Ash (kg · ₱)</th>
            {hasFreeCl && (
              <th className={TH} title="Free Chlorine Reagent pill/packet consumption and cost">Free Cl (pcs · ₱)</th>
            )}
            {hasOther && (
              <th className={TH} title="Other chemical adjustments or unallocated costs">Other (₱)</th>
            )}
            <th className={TH} title="Total chemical spend for the day">Total Chem (₱)</th>
            <th className={TH} title="Chemical cost per cubic meter produced">Chem (₱/m³)</th>
          </tr>
        </thead>
        <tbody>
          {[...dates].reverse().map((dk, i) => {
            const row = chemicalBreakdown.get(dk);
            return (
              <tr
                key={dk}
                className={i % 2 === 0 ? 'bg-background hover:bg-muted/15' : 'bg-muted/10 hover:bg-muted/25'}
              >
                <td
                  className={[
                    'px-3.5 py-1.5 whitespace-nowrap font-medium text-xs text-muted-foreground sticky left-0 z-10 border-r border-border shadow-[4px_0_6px_-2px_rgba(0,0,0,0.06)]',
                    i % 2 === 0 ? 'bg-card' : 'bg-muted',
                  ].join(' ')}
                >
                  {fmtDateKey(dk)}
                </td>
                <td className={TD}>
                  {renderChemCell(row?.chlorineCost ?? 0, row?.chlorineKg ?? 0, 'kg')}
                </td>
                <td className={TD}>
                  {renderChemCell(row?.smbsCost ?? 0, row?.smbsKg ?? 0, 'kg')}
                </td>
                <td className={TD}>
                  {renderChemCell(row?.antiScalantCost ?? 0, row?.antiScalantL ?? 0, 'L')}
                </td>
                <td className={TD}>
                  {renderChemCell(row?.sodaAshCost ?? 0, row?.sodaAshKg ?? 0, 'kg')}
                </td>
                {hasFreeCl && (
                  <td className={TD}>
                    {renderChemCell(row?.freeClCost ?? 0, row?.freeClPcs ?? 0, 'pcs')}
                  </td>
                )}
                {hasOther && (
                  <td className={TD}>
                    {(row?.otherCost ?? 0) > 0 ? (
                      <span className="font-semibold text-foreground font-mono">₱{fmtNum(row!.otherCost, 2)}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                )}
                <td className={TD}>
                  {(row?.totalCost ?? 0) > 0 ? (
                    <span className="font-bold text-primary font-mono tabular-nums">
                      ₱{fmtNum(row!.totalCost, 2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className={TD}>
                  {row?.chemCostPerM3 != null ? (
                    <span className="font-mono tabular-nums text-foreground">
                      ₱{row.chemCostPerM3.toFixed(4)}/m³
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t-2 border-border shadow-xs">
          <tr>
            <td className="px-3.5 py-2 text-left text-2xs font-bold text-foreground uppercase tracking-wider whitespace-nowrap sticky left-0 bottom-0 z-30 bg-card/95 backdrop-blur-sm border-t border-border">
              Total ({dates.length}d)
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              <div className="flex flex-col items-end leading-tight">
                <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totClCost, 2)}</span>
                {totals.totClKg > 0 && (
                  <span className="text-3xs text-muted-foreground">{fmtNum(totals.totClKg, 2)} kg</span>
                )}
              </div>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              <div className="flex flex-col items-end leading-tight">
                <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totSmbsCost, 2)}</span>
                {totals.totSmbsKg > 0 && (
                  <span className="text-3xs text-muted-foreground">{fmtNum(totals.totSmbsKg, 2)} kg</span>
                )}
              </div>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              <div className="flex flex-col items-end leading-tight">
                <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totAsCost, 2)}</span>
                {totals.totAsL > 0 && (
                  <span className="text-3xs text-muted-foreground">{fmtNum(totals.totAsL, 2)} L</span>
                )}
              </div>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              <div className="flex flex-col items-end leading-tight">
                <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totSaCost, 2)}</span>
                {totals.totSaKg > 0 && (
                  <span className="text-3xs text-muted-foreground">{fmtNum(totals.totSaKg, 2)} kg</span>
                )}
              </div>
            </td>
            {hasFreeCl && (
              <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
                <div className="flex flex-col items-end leading-tight">
                  <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totFreeClCost, 2)}</span>
                  {totals.totFreeClPcs > 0 && (
                    <span className="text-3xs text-muted-foreground">{fmtNum(totals.totFreeClPcs, 0)} pcs</span>
                  )}
                </div>
              </td>
            )}
            {hasOther && (
              <td className="px-3 py-2 text-right font-mono tabular-nums sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
                <span className="font-bold text-foreground text-xs">₱{fmtNum(totals.totOtherCost, 2)}</span>
              </td>
            )}
            <td className="px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-primary sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              ₱{fmtNum(totals.totGrandCost, 2)}
            </td>
            <td className="px-3 py-2 text-right font-bold font-mono tabular-nums text-xs text-foreground sticky bottom-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border">
              {totals.avgChemCostPerM3 != null ? `₱${totals.avgChemCostPerM3.toFixed(4)}/m³` : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
