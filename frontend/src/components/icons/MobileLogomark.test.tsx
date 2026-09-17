import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileLogomark } from './MobileLogomark';

 describe('MobileLogomark', () => {
  it('renders an accessible scalable mark with one animation cycle by default', () => {
    render(<MobileLogomark />);
    const logo = screen.getByRole('img', { name: 'PWRI Monitoring' });
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(logo).toHaveAttribute('width', '32');
    expect(logo).toHaveAttribute('height', '32');
    expect(logo).toHaveAttribute('data-motion', 'once');
  });

  it('supports loading, custom size, accessible name and optional glow', () => {
    render(<MobileLogomark size={96} alt="Water logo" motion="loading" glow={false} className="custom" />);
    const logo = screen.getByRole('img', { name: 'Water logo' });
    expect(logo).toHaveAttribute('width', '96');
    expect(logo).toHaveAttribute('height', '96');
    expect(logo).toHaveAttribute('data-motion', 'loading');
    expect(logo).toHaveClass('custom');
    expect(logo).not.toHaveClass('pwri-mobile-logo--glow');
  });

  it('supports decorative and explicitly static usage', () => {
    const { container } = render(<MobileLogomark alt="" motion="none" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('data-motion', 'none');
  });

  it('keeps clip and gradient IDs unique across multiple instances', () => {
    const { container } = render(<><MobileLogomark /><MobileLogomark /></>);
    const ids = Array.from(container.querySelectorAll('[id]'), node => node.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of container.querySelectorAll('[fill^="url"], [clip-path]')) {
      const ref = node.getAttribute('clip-path') ?? node.getAttribute('fill');
      expect(ids).toContain(ref?.slice(5, -1));
    }
  });
});
