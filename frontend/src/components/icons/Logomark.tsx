import * as React from 'react';
import logomarkSrc from '@/assets/logomark.png';

export interface LogomarkProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Pixel size for both width and height. Defaults to 32. */
  size?: number | string;
}

/**
 * PWRI Monitoring brand mark.
 *
 * Renders the actual PWRI droplet-and-wave logo — the same asset already
 * used as the favicon, apple-touch-icon, and og:image (see
 * public/favicon.png / public/og-image.png) — so the icon shown in the
 * sidebar, top bar, and auth screen matches the browser tab and shared
 * link previews instead of a different, unrelated mark.
 */
export function Logomark({
  size = 32,
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
      className={className}
      style={{ objectFit: 'contain', ...style }}
      {...props}
    />
  );
}
