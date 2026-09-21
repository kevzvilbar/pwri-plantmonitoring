import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// P5-7: the asset name on a Daily Readings row is a real link to the asset's
// page in Plants, and stays plain text for a user who cannot view Plants.
let canViewPlants = true;
vi.mock('@/hooks/usePermission', () => ({
  useCan: () => (module: string) => (module === 'plants' ? canViewPlants : true),
}));

import { AssetLink } from './AssetLink';
import { assetPath, type AssetKind } from '@/shared/assetLinks';

const renderLink = (kind: AssetKind = 'locator', className?: string) =>
  render(
    <MemoryRouter>
      <AssetLink kind={kind} plantId="p1" id="a1" name="Asset One" className={className} />
    </MemoryRouter>,
  );

describe('AssetLink', () => {
  beforeEach(() => { canViewPlants = true; });

  it.each(['well', 'locator', 'product'] as const)(
    '%s: is a real link (href, so it opens in a new tab) to the asset',
    (kind) => {
      renderLink(kind);
      const link = screen.getByRole('link', { name: 'Open Asset One in Plants' });
      expect(link).toHaveAttribute('href', assetPath(kind, 'p1', 'a1'));
      expect(link).toHaveTextContent('Asset One');
    },
  );

  it('without view access to Plants: the name is shown, but not as a link', () => {
    canViewPlants = false;
    renderLink('well');
    expect(screen.getByText('Asset One')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the row\u2019s own typography on both the link and the plain-text form', () => {
    const { unmount } = renderLink('well', 'text-sm font-bold');
    expect(screen.getByRole('link')).toHaveClass('text-sm', 'font-bold');
    unmount();

    canViewPlants = false;
    renderLink('well', 'text-sm font-bold');
    expect(screen.getByText('Asset One')).toHaveClass('text-sm', 'font-bold');
  });
});
