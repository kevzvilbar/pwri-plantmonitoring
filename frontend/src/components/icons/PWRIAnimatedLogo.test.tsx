import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PWRIAnimatedLogo } from './PWRIAnimatedLogo';

describe('PWRIAnimatedLogo', () => {
  it('renders the animated SVG and brand typography by default', () => {
    const { container } = render(<PWRIAnimatedLogo size={200} />);
    expect(screen.getByText('PILIPINAS WATER RESOURCES INC.')).toBeInTheDocument();
    expect(screen.getByText('PWRI')).toBeInTheDocument();

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('data-motion', 'loading');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('allows hiding typography when showText is false', () => {
    render(<PWRIAnimatedLogo showText={false} />);
    expect(screen.queryByText('PILIPINAS WATER RESOURCES INC.')).not.toBeInTheDocument();
    expect(screen.queryByText('PWRI')).not.toBeInTheDocument();
  });

  it('maintains unique gradient and mask IDs across multiple instances', () => {
    const { container } = render(
      <>
        <PWRIAnimatedLogo />
        <PWRIAnimatedLogo />
      </>
    );

    const ids = Array.from(container.querySelectorAll('[id]'), (node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
