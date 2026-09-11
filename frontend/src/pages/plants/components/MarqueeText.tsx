import { useState, useEffect, useRef, type ReactNode } from 'react';

export function MarqueeText({
  text,
  className = '',
  title,
  icon,
}: {
  text: string;
  className?: string;
  title?: string;
  icon?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        const diff = textRef.current.scrollWidth - containerRef.current.clientWidth;
        setOverflowDistance(diff > 2 ? diff : 0);
      }
    };

    checkOverflow();

    const ro = new ResizeObserver(() => {
      checkOverflow();
    });

    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => {
      ro.disconnect();
    };
  }, [text]);

  const duration = Math.max(5, Math.min(14, overflowDistance / 10));

  return (
    <div className="flex items-center gap-1.5 min-w-0 w-full overflow-hidden" title={title ?? text}>
      {icon && <span className="shrink-0">{icon}</span>}
      <div
        ref={containerRef}
        className={`relative flex-1 min-w-0 overflow-hidden ${
          overflowDistance > 0
            ? '[mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent_100%)]'
            : ''
        }`}
      >
        <span
          ref={textRef}
          className={`inline-block whitespace-nowrap hover:[animation-play-state:paused] ${className}`}
          style={
            overflowDistance > 0
              ? {
                  animation: `marquee-pingpong ${duration}s ease-in-out infinite alternate`,
                  ['--marquee-distance' as any]: `-${overflowDistance + 6}px`,
                }
              : undefined
          }
        >
          {text}
        </span>
      </div>
    </div>
  );
}
