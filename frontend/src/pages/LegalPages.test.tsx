import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPage from './PrivacyPage';
import TermsPage from './TermsPage';

describe('Legal & Compliance Pages (RA 10173 / Terms)', () => {
  it('renders PrivacyPage with RA 10173 and DPO contacts', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Privacy Notice for PWRI Plant Monitoring Platform/i)).toBeInTheDocument();
    expect(screen.getByText(/RA 10173 \(DPA 2012\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Data Protection Officer/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/dpo@pwri.com.ph/i)).toBeInTheDocument();
  });

  it('renders TermsPage with acceptable use and data integrity policies', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Terms of Use for PWRI Plant Monitoring Platform/i)).toBeInTheDocument();
    expect(screen.getByText(/Data Integrity & True Recording Obligation/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorized Access & Account Responsibility/i)).toBeInTheDocument();
  });
});
