import * as React from 'react';
import { cn } from '@/lib/utils';

const logomarkSrc = `${import.meta.env.BASE_URL}pwri-logo.png`;

export interface LogomarkProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Pixel size for both width and height. Defaults to 32. */
  size?: number | string;
  /** Whether to apply the subtle cyan water glow effect. Defaults to true. */
  glow?: boolean;
}

/**
 * Enhanced PWRI Monitoring brand mark.
 *
 * Renders the official PWRI droplet-and-wave logo using the ultra-crisp
 * high-resolution asset with subtle cyan water glow and responsive hover micro-interaction.
 */
export function Logomark({
  size = 32,
  glow = true,
  className,
  alt = 'PWRI Monitoring',
  style,
  ...props
}: LogomarkProps) {
  return (
    <img
      src={logomarkSrc}
      width={size}
      height={size}
      alt={alt}
      className={cn(
        'object-contain select-none transition-all duration-300 ease-out',
        'hover:scale-105 active:scale-95',
        glow && 'filter drop-shadow-[0_0_6px_rgba(56,189,248,0.45)] hover:drop-shadow-[0_0_12px_rgba(56,189,248,0.7)]',
        className,
      )}
      style={{ objectFit: 'contain', ...style }}
      {...props}
    />
  );
}
