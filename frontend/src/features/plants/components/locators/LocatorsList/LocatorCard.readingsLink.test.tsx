import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// P5-7: the "Daily Readings" pill on a locator card opens that locator's row.
// It is built by readingsPath(), so it lands on the Locator tab of Daily
// Readings with this card's id in ?highlight=.

import { LocatorCard } from './LocatorCard';

it('the Daily Readings pill navigates to this locator\u2019s row in Daily Readings', () => {
  const navigate = vi.fn();
  const onDetail = vi.fn();
  render(
    <MemoryRouter>
      <LocatorCard
        l={{ id: 'l1', name: 'Locator 1', status: 'Active', is_locked: false }}
        checked={false}
        onToggle={() => {}}
        selectedLocator={null}
        setSelectedLocator={() => {}}
        isManager={false}
        isAdmin={false}
        productMeters={[]}
        latestByLocator={{}}
        cardRefs={{ current: {} }}
        pulseId={null}
        onEdit={() => {}}
        onDelete={() => {}}
        onDetail={onDetail}
        onStatusToggle={() => {}}
        onLockChange={() => {}}
        navigate={navigate as unknown as ComponentProps<typeof LocatorCard>['navigate']}
      />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open this locator in Daily Readings' }));

  expect(navigate).toHaveBeenCalledWith('/operations?tab=locator&highlight=l1');
  // The pill sits inside a clickable card: it must not also open the locator's detail.
  expect(onDetail).not.toHaveBeenCalled();
});
