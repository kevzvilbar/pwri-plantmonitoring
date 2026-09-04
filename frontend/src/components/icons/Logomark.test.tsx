import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logomark } from './Logomark';

describe('Logomark', () => {
  it('renders with pwri-logo source and default size', () => {
    render(<Logomark />);
    const img = screen.getByAltText('PWRI Monitoring') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('pwri-logo.png');
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '32');
    expect(img.className).toContain('drop-shadow');
  });

  it('renders with custom size and custom alt text', () => {
    render(<Logomark size={26} alt="Custom Logo" />);
    const img = screen.getByAltText('Custom Logo') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('width', '26');
    expect(img).toHaveAttribute('height', '26');
  });

  it('disables glow when glow={false}', () => {
    render(<Logomark glow={false} />);
    const img = screen.getByAltText('PWRI Monitoring');
    expect(img.className).not.toContain('drop-shadow-[0_0_6px');
  });
});
