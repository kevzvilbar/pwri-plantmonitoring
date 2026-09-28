import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChemCard } from './ChemCard';
import { buildQuickUnitOptions } from './quickUnits';
import type { ChemicalCatalogItem } from './useChemCatalog';

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

  // Radix Select needs a few browser APIs that jsdom lacks.
  const stubRadix = () => {
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture = proto.hasPointerCapture ?? (() => false);
    proto.setPointerCapture = proto.setPointerCapture ?? (() => {});
    proto.releasePointerCapture = proto.releasePointerCapture ?? (() => {});
    proto.scrollIntoView = proto.scrollIntoView ?? (() => {});
  };

  const liquidChlorine = {
    id: 'cl-l', name: 'Chlorine - Liquid', price_key: 'Chlorine - Liquid (L)', legacy_name: 'Chlorine',
    family: 'chlorine', category: 'process', form: 'liquid', base_unit: 'L', strength_pct: 12,
    strength_basis: 'w/v', density_kg_per_l: 1.2, reference_basis: 'Cl2', methods: null,
    sample_volume_ml: null, qty_per_test: null, drops_per_test: null, ml_per_drop: null,
    process_stage: null, sort_order: 10, is_active: true,
  } as ChemicalCatalogItem;

  it('splits the list into By weight and By volume when litres are offered, and reports the pick', () => {
    stubRadix();
    const onUnitChange = vi.fn();
    const options = buildQuickUnitOptions('chlorine_kg', [liquidChlorine], [], null);
    render(
      <ChemCard
        name="Chlorine"
        icon={icon}
        value=""
        onChange={() => {}}
        unit="kg"
        unitOptions={options}
        unitId="kg"
        onUnitChange={onUnitChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Chlorine unit' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByText('By weight')).toBeTruthy();
    expect(screen.getByText('By volume')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'Litres (L)' }));
    expect(onUnitChange).toHaveBeenCalledWith('x:Litres (L)');
  });
});

