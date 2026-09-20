import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoPlantsAssigned } from './NoPlantsAssigned';

describe('NoPlantsAssigned (D5)', () => {
  it('says why the page is empty and who can fix it', () => {
    render(<NoPlantsAssigned />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No plants assigned')).toBeInTheDocument();
    expect(screen.getByText('Ask an admin to assign a plant to your account.')).toBeInTheDocument();
  });

  it('accepts extra classes without dropping the base styling', () => {
    render(<NoPlantsAssigned className="my-extra" />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('my-extra');
    expect(el.className).toContain('border-dashed');
  });
});
