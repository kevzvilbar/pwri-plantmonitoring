import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileRoundStepper, type RoundAssetItem } from './MobileRoundStepper';

const mockItems: RoundAssetItem[] = [
  {
    id: 'locator-1',
    name: 'Feed Header Main',
    code: 'LOC-01',
    type: 'locator',
    locationName: 'RO Hall A',
    unit: 'm³',
    currentValue: '1240.5',
    previousValue: 1200.0,
    status: 'pending',
  },
  {
    id: 'locator-2',
    name: 'Brine Outlet #1',
    code: 'LOC-02',
    type: 'locator',
    locationName: 'RO Hall B',
    unit: 'm³',
    currentValue: '850.0',
    previousValue: 800.0,
    status: 'pending',
  },
];

describe('MobileRoundStepper', () => {
  it('renders current asset details, previous baseline, and navigation', () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <MobileRoundStepper
        title="Morning Shift Round"
        items={mockItems}
        onSaveReading={onSave}
      />
    );

    expect(screen.getByText('Morning Shift Round')).toBeInTheDocument();
    expect(screen.getByText('Feed Header Main')).toBeInTheDocument();
    expect(screen.getByText('LOC-01')).toBeInTheDocument();
    expect(screen.getByText('RO Hall A')).toBeInTheDocument();
    expect(screen.getByText("Yesterday's Value")).toBeInTheDocument();
    expect(screen.getByText('Next Asset')).toBeInTheDocument();
  });

  it('supports quick increment bumper steps', () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <MobileRoundStepper
        title="Morning Shift Round"
        items={mockItems}
        onSaveReading={onSave}
      />
    );

    // Bump by +1.0
    const plusOneBtn = screen.getByText('+ 1.0');
    fireEvent.click(plusOneBtn);

    // Verify next asset action
    const nextBtn = screen.getByText('Next Asset');
    fireEvent.click(nextBtn);

    expect(onSave).toHaveBeenCalledWith('locator-1', '1241.5', undefined);
  });
});

