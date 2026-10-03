import React from 'react';
import { Droplets, FlaskConical } from 'lucide-react';
import { ChemCard } from '../ChemCard';
import { ResidualTestsCard, ResidualTestSample } from './ResidualTestsCard';
import { QuickChemKey, QuickUnitOption } from '../quickUnits';

interface QuickDosingGridProps {
  isChemEnabled: (name: string) => boolean;
  quickV: {
    chlorine_kg: string;
    smbs_kg: string;
    anti_scalant_l: string;
    soda_ash_kg: string;
    free_chlorine_reagent_pcs: string;
  };
  setQuickV: React.Dispatch<
    React.SetStateAction<{
      chlorine_kg: string;
      smbs_kg: string;
      anti_scalant_l: string;
      soda_ash_kg: string;
      free_chlorine_reagent_pcs: string;
    }>
  >;
  quickUnits: Record<QuickChemKey, string>;
  setQuickUnits: React.Dispatch<React.SetStateAction<Record<QuickChemKey, string>>>;
  quickUnitOptions: Record<QuickChemKey, QuickUnitOption[]>;
  quickHint: (k: QuickChemKey, base: 'kg' | 'L') => string | undefined;
  residualSamples: ResidualTestSample[];
  setResidualSamples: React.Dispatch<React.SetStateAction<ResidualTestSample[]>>;
}

export function QuickDosingGrid({
  isChemEnabled,
  quickV,
  setQuickV,
  quickUnits,
  setQuickUnits,
  quickUnitOptions,
  quickHint,
  residualSamples,
  setResidualSamples,
}: QuickDosingGridProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">
          Mass-Based Dosing Group
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {isChemEnabled('Chlorine') && (
            <ChemCard
              name="Chlorine"
              icon={
                <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                  Cl₂
                </span>
              }
              value={quickV.chlorine_kg}
              onChange={(val) => setQuickV((prev) => ({ ...prev, chlorine_kg: val }))}
              unit="kg"
              unitOptions={quickUnitOptions.chlorine_kg}
              unitId={quickUnits.chlorine_kg}
              onUnitChange={(id) => setQuickUnits((u) => ({ ...u, chlorine_kg: id }))}
              hint={quickHint('chlorine_kg', 'kg')}
              accent="teal"
            />
          )}
          {isChemEnabled('SMBS') && (
            <ChemCard
              name="SMBS"
              icon={
                <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                  S₂O₅
                </span>
              }
              value={quickV.smbs_kg}
              onChange={(val) => setQuickV((prev) => ({ ...prev, smbs_kg: val }))}
              unit="kg"
              unitOptions={quickUnitOptions.smbs_kg}
              unitId={quickUnits.smbs_kg}
              onUnitChange={(id) => setQuickUnits((u) => ({ ...u, smbs_kg: id }))}
              hint={quickHint('smbs_kg', 'kg')}
              accent="default"
            />
          )}
          {isChemEnabled('Soda Ash') && (
            <ChemCard
              name="Soda Ash"
              icon={
                <span className="inline-flex items-center justify-center w-6 h-6 text-3xs font-bold font-mono bg-muted rounded text-muted-foreground">
                  Na₂CO₃
                </span>
              }
              value={quickV.soda_ash_kg}
              onChange={(val) => setQuickV((prev) => ({ ...prev, soda_ash_kg: val }))}
              unit="kg"
              unitOptions={quickUnitOptions.soda_ash_kg}
              unitId={quickUnits.soda_ash_kg}
              onUnitChange={(id) => setQuickUnits((u) => ({ ...u, soda_ash_kg: id }))}
              hint={quickHint('soda_ash_kg', 'kg')}
              accent="default"
            />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-0.5">
          Volume-Based & Ancillary
        </p>
        <div className="grid grid-cols-2 gap-2">
          {isChemEnabled('Anti Scalant') && (
            <ChemCard
              name="Anti Scalant"
              icon={
                <span className="inline-flex items-center justify-center w-6 h-6 bg-muted rounded text-muted-foreground">
                  <Droplets className="h-3.5 w-3.5" />
                </span>
              }
              value={quickV.anti_scalant_l}
              onChange={(val) => setQuickV((prev) => ({ ...prev, anti_scalant_l: val }))}
              unit="L"
              unitOptions={quickUnitOptions.anti_scalant_l}
              unitId={quickUnits.anti_scalant_l}
              onUnitChange={(id) => setQuickUnits((u) => ({ ...u, anti_scalant_l: id }))}
              hint={quickHint('anti_scalant_l', 'L')}
              accent="olive"
            />
          )}
          <ChemCard
            name="Free Cl Reagent (pcs)"
            icon={
              <span className="inline-flex items-center justify-center w-6 h-6 bg-muted rounded text-muted-foreground">
                <FlaskConical className="h-3.5 w-3.5" />
              </span>
            }
            value={quickV.free_chlorine_reagent_pcs}
            onChange={(val) =>
              setQuickV((prev) => ({ ...prev, free_chlorine_reagent_pcs: val }))
            }
            unit="pcs"
            accent="default"
            inputProps={{ min: '0', max: '20' }}
          />
        </div>
      </div>

      {/* Residual samples */}
      <ResidualTestsCard
        samples={residualSamples}
        onChange={setResidualSamples}
      />
    </div>
  );
}

