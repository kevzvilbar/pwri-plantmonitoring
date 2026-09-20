import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./AppManual', () => ({ AppManual: () => <div data-testid="manual" /> }));

import HelpPage from './HelpPage';

describe('HelpPage (P5-5)', () => {
  it('hosts the manual under a "Help & Manual" heading', () => {
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(screen.getByText('Help & Manual')).toBeInTheDocument();
    expect(screen.getByTestId('manual')).toBeInTheDocument();
  });
});
