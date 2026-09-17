import { useId, type SVGProps } from 'react';
import { cn } from '@/lib/utils';
import './MobileLogomark.css';

interface MobileLogomarkProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  alt?: string;
  /** One calm cycle for branding; loop only while a loading state is mounted. */
  motion?: 'once' | 'loading' | 'none';
  glow?: boolean;
}

/** Vector recreation of the PWRI droplet. Motion is mobile-only, even if reused elsewhere. */
export function MobileLogomark({
  size = 32,
  alt = 'PWRI Monitoring',
  motion = 'once',
  glow = true,
  className,
  ...props
}: MobileLogomarkProps) {
  const id = useId();
  const bodyId = `${id}-body`;
  const waterId = `${id}-water`;
  const dropId = `${id}-drop`;
  const lightId = `${id}-light`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 252 252"
      width={size}
      height={size}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      focusable="false"
      className={cn('pwri-mobile-logo', glow && 'pwri-mobile-logo--glow', className)}
      data-motion={motion}
      {...props}
    >
      <defs>
        <clipPath id={bodyId}>
          <path d="M98 64C79 89 50 117 50 150C50 193 82 222 126 222C170 222 203 193 203 151C203 124 183 96 165 79C164 98 150 108 136 108C120 108 111 101 109 91L104 99C97 88 95 75 98 64Z" />
        </clipPath>
        <linearGradient id={waterId} x1="0" y1="65" x2="0" y2="222" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00e5ee" />
          <stop offset="0.5" stopColor="#00bce5" />
          <stop offset="0.72" stopColor="#0077b9" />
          <stop offset="1" stopColor="#08006b" />
        </linearGradient>
        <linearGradient id={dropId} x1="123" y1="30" x2="149" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00ffe0" />
          <stop offset="1" stopColor="#00e7ef" />
        </linearGradient>
        <linearGradient id={lightId}>
          <stop stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="0.22" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${bodyId})`}>
        <path fill={`url(#${waterId})`} d="M40 60H212V230H40Z" />
        <path fill="#08006b" d="M40 184C87 211 143 155 212 154V230H40Z" />
        <path className="pwri-mobile-logo__light" fill={`url(#${lightId})`} d="M-80 50H-30L40 230H-10Z" />
      </g>
      {/* Waves sit outside the body clip: their rounded tips overshoot the droplet like the original mark. */}
      <g fill="none" stroke="white" strokeWidth="8.5" strokeLinecap="round">
        <path className="pwri-mobile-logo__wave pwri-mobile-logo__wave--front" d="M30 181C84 111 130 212 222 145" />
        <path className="pwri-mobile-logo__wave pwri-mobile-logo__wave--back" d="M30 176C93 232 139 137 222 203" />
      </g>
      <path
        className="pwri-mobile-logo__drop"
        fill={`url(#${dropId})`}
        d="M122 30C135 52 132 60 125 72C114 91 123 100 137 100C150 100 159 90 156 77C152 58 139 43 122 30Z"
      />
    </svg>
  );
}
