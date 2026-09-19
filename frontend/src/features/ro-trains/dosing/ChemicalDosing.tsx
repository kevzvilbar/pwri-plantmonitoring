import { useState } from 'react';
import { History } from 'lucide-react';

import { ChemDosingForm } from './ChemDosingForm';
import { ChemInventory } from '../inventory/ChemInventory';
import { DosingHistoryLog } from './DosingHistoryLog';
import { ToggleSwitch } from '../shared/ToggleSwitch';

// ─── Chemical Dosing Tab ──────────────────────────────────────────────────────
export function ChemicalDosing() {
  const [active, setActive] = useState<'dosing' | 'inventory' | 'history'>('dosing');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4">
        <ToggleSwitch label="Dosing"    active={active === 'dosing'}    onClick={() => setActive('dosing')} />
        <ToggleSwitch label="Inventory" active={active === 'inventory'} onClick={() => setActive('inventory')} />
        <ToggleSwitch label="History"   active={active === 'history'}   onClick={() => setActive('history')} />
      </div>
      <div>
        {active === 'dosing'    && <ChemDosingForm />}
        {active === 'inventory' && <ChemInventory />}
        {active === 'history'   && <DosingHistoryLog />}
      </div>
    </div>
  );
}
