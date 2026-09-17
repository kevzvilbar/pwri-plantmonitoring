import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface PWRIAnimatedLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  showText?: boolean;
  /** Pass-through motion attribute for accessibility/testing */
  'data-motion'?: string;
}

export const PWRIAnimatedLogo: React.FC<PWRIAnimatedLogoProps> = ({
  size = 220,
  showText = true,
  className,
  'data-motion': dataMotion = 'loading',
  ...props
}) => {
  const rawId = useId();
  const id = rawId.replace(/:/g, '-');
  const topTeardropGradId = `${id}-topTeardropGrad`;
  const midBodyGradId = `${id}-midBodyGrad`;
  const deepWaveGradId = `${id}-deepWaveGrad`;
  const dropletMaskId = `${id}-dropletMask`;

  return (
    <div
      className={cn('pwri-container', className)}
      style={{ width: size, textAlign: 'center' }}
      {...props}
    >
      <svg
        viewBox="0 0 200 240"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="pwri-svg"
        aria-hidden="true"
        data-motion={dataMotion}
      >
        <defs>
          {/* Gradients */}
          <linearGradient
            id={topTeardropGradId}
            x1="100"
            y1="20"
            x2="100"
            y2="90"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#00f5ff" />
            <stop offset="100%" stopColor="#00b4d8" />
          </linearGradient>

          <linearGradient
            id={midBodyGradId}
            x1="100"
            y1="60"
            x2="100"
            y2="180"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#00b4d8" />
            <stop offset="100%" stopColor="#0077b6" />
          </linearGradient>

          <linearGradient
            id={deepWaveGradId}
            x1="100"
            y1="140"
            x2="100"
            y2="200"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#023e8a" />
            <stop offset="100%" stopColor="#03045e" />
          </linearGradient>

          {/* Mask for outer teardrop shape */}
          <mask id={dropletMaskId}>
            <path
              d="M100 15 C100 15 170 85 170 145 C170 183.66 138.66 215 100 215 C61.34 215 30 183.66 30 145 C30 85 100 15 100 15 Z"
              fill="#ffffff"
            />
          </mask>
        </defs>

        {/* Droplet Body with Mask */}
        <g mask={`url(#${dropletMaskId})`} className="pwri-drop-body">
          {/* Base Background */}
          <rect width="200" height="240" fill={`url(#${midBodyGradId})`} />

          {/* Top inner peak/droplet accent */}
          <path
            d="M100 20 C105 45 125 65 125 85 C125 98.8 113.8 110 100 110 C86.2 110 75 98.8 75 85 C75 65 95 45 100 20 Z"
            fill={`url(#${topTeardropGradId})`}
            className="pwri-inner-flame"
          />

          {/* Flowing Waves */}
          <g className="pwri-waves">
            {/* Wave Layer 1 */}
            <path
              d="M10 140 Q 55 120, 100 140 T 190 140 L 190 220 L 10 220 Z"
              fill="#0077b6"
              className="wave wave-back"
            />
            {/* White dividing ribbon */}
            <path
              d="M10 142 Q 55 122, 100 142 T 190 142"
              stroke="#ffffff"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              className="wave-ribbon"
            />
            {/* Wave Layer 2 (Deep Navy Base) */}
            <path
              d="M10 165 Q 55 180, 100 165 T 190 165 L 190 220 L 10 220 Z"
              fill={`url(#${deepWaveGradId})`}
              className="wave wave-front"
            />
            {/* Lower White ribbon */}
            <path
              d="M10 167 Q 55 182, 100 167 T 190 167"
              stroke="#ffffff"
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              className="wave-ribbon"
            />
          </g>
        </g>

        {/* Outer Droplet Outline Contour */}
        <path
          d="M100 15 C100 15 170 85 170 145 C170 183.66 138.66 215 100 215 C61.34 215 30 183.66 30 145 C30 85 100 15 100 15 Z"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="3"
          fill="none"
        />
      </svg>

      {/* Typography */}
      {showText && (
        <div className="pwri-typography">
          <h2 className="pwri-title">PILIPINAS WATER RESOURCES INC.</h2>
          <span className="pwri-badge">PWRI</span>
        </div>
      )}

      {/* Scoped Styles with Dark Mode and Reduced Motion Support */}
      <style>{`
        .pwri-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          user-select: none;
        }

        .pwri-svg {
          width: 100%;
          height: auto;
          filter: drop-shadow(0 10px 25px rgba(0, 119, 182, 0.25));
          animation: dropEntrance 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .pwri-inner-flame {
          animation: pulseGlow 3s ease-in-out infinite alternate;
          transform-origin: center;
        }

        .wave-back {
          animation: waveShift 4s ease-in-out infinite alternate;
        }

        .wave-front {
          animation: waveShiftRev 3.5s ease-in-out infinite alternate;
        }

        .pwri-typography {
          margin-top: 14px;
          animation: textFadeIn 0.9s ease 0.4s both;
        }

        .pwri-title {
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #03045e;
          margin: 0;
          text-transform: uppercase;
        }

        .dark .pwri-title,
        [data-theme] .pwri-title {
          color: #f1f5f9;
        }

        .pwri-badge {
          display: inline-block;
          margin-top: 4px;
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.18em;
          color: #00b4d8;
        }

        .dark .pwri-badge,
        [data-theme] .pwri-badge {
          color: #38bdf8;
        }

        @keyframes dropEntrance {
          0% {
            opacity: 0;
            transform: scale(0.65) translateY(20px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes waveShift {
          0% { transform: translateX(-8px) translateY(0); }
          100% { transform: translateX(8px) translateY(-3px); }
        }

        @keyframes waveShiftRev {
          0% { transform: translateX(6px) translateY(-2px); }
          100% { transform: translateX(-6px) translateY(2px); }
        }

        @keyframes pulseGlow {
          0% { filter: brightness(1); }
          100% { filter: brightness(1.15) drop-shadow(0 0 6px rgba(0, 245, 255, 0.6)); }
        }

        @keyframes textFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pwri-svg,
          .pwri-inner-flame,
          .wave-back,
          .wave-front,
          .pwri-typography {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
};

export default PWRIAnimatedLogo;
