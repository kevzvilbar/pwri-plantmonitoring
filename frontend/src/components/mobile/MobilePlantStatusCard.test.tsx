import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobilePlantStatusCard } from './MobilePlantStatusCard';

describe('MobilePlantStatusCard', () => {
  it('renders glanceable hero metrics, telemetry freshness, and recovery %', () => {
    render(
      <MemoryRouter>
        <MobilePlantStatusCard
          plantName="Central Desalination Plant"
          isOnline={true}
          freshnessLabel="2m ago"
          freshnessTone="good"
          production={12500}
          dProduction={3.5}
          recovery={76.2}
          rawWater={16400}
          specificPower={2.85}
          openIncidentsCount={1}
          unacknowledgedAlertsCount={2}
          trainsCount={4}
          onlineTrainsCount={3}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('Central Desalination Plant')).toBeInTheDocument();
    expect(screen.getByText('• 2m ago')).toBeInTheDocument();
    expect(screen.getByText("Today's Product Water")).toBeInTheDocument();
    expect(screen.getByText('12,500')).toBeInTheDocument();
    expect(screen.getByText('+3.5%')).toBeInTheDocument();
    expect(screen.getByText('76.2%')).toBeInTheDocument();
    expect(screen.getByText('3/4 Active')).toBeInTheDocument();
  });

  it('toggles expandable drill-down details on tap', () => {
    render(
      <MemoryRouter>
        <MobilePlantStatusCard
          plantName="Central Desalination Plant"
          isOnline={true}
          freshnessLabel="Just now"
          production={10000}
          recovery={75.0}
          rawWater={14000}
          specificPower={3.1}
          openIncidentsCount={0}
          unacknowledgedAlertsCount={0}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText('Raw Water Intake')).not.toBeInTheDocument();

    const toggleBtn = screen.getByText('View Raw Water & Power Details');
    fireEvent.click(toggleBtn);

    expect(screen.getByText('Raw Water Intake')).toBeInTheDocument();
    expect(screen.getByText('Specific Power')).toBeInTheDocument();
  });
});
