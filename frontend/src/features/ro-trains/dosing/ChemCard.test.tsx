import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChemCard } from './ChemCard';
import { buildQuickUnitOptions } from './quickUnits';

const icon = <span>icon</span>;

describe('ChemCard', () => {
  it('still shows a fixed unit label when no unit options are given (e.g. the pcs reagent card)', () => {
    render(<ChemCard name="Free Cl Reagent (pcs)" icon={icon} value="2" onChange={() => {}} unit="pcs" />);
    expect(screen.getByText('pcs')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows a unit dropdown with the selected unit when options are given', () => {
    const options = buildQuickUnitOptions('smbs_kg', undefined, undefined, null);
    render(
      <ChemCard
        name="SMBS"
        icon={icon}
        value="3"
        onChange={() => {}}
        unit="kg"
        unitOptions={options}
        unitId="c:Bag (25 kg)"
        onUnitChange={() => {}}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'SMBS unit' });
    expect(trigger.textContent).toContain('Bag');
  });

  it('falls back to the first (base) unit if the saved unit id is not offered', () => {
    const options = buildQuickUnitOptions('anti_scalant_l', undefined, undefined, null);
    render(
      <ChemCard
        name="Anti Scalant"
        icon={icon}
        value=""
        onChange={() => {}}
        unit="L"
        unitOptions={options}
        unitId="c:Gone (99 L)"
        onUnitChange={() => {}}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Anti Scalant unit' }).textContent).toContain('L');
  });

  it('shows the hint text and passes typed values through unchanged', () => {
    const onChange = vi.fn();
    const options = buildQuickUnitOptions('soda_ash_kg', undefined, undefined, null);
    render(
      <ChemCard
        name="Soda Ash"
        icon={icon}
        value="2"
        onChange={onChange}
        unit="kg"
        unitOptions={options}
        unitId="c:Bag (25 kg)"
        onUnitChange={() => {}}
        hint="= 50 kg will be saved"
      />,
    );
    expect(screen.getByText('= 50 kg will be saved')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith('4');
  });
});
