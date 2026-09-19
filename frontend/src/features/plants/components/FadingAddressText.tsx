import { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';

export function FadingAddressText({ address }: { address: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (containerRef.current && textRef.current) {
      const isOver = textRef.current.scrollWidth > containerRef.current.clientWidth;
      setOverflows(isOver);
      if (isOver) {
        setOffset(textRef.current.scrollWidth - containerRef.current.clientWidth + 6);
      }
    }
  }, [address]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden text-xs text-muted-foreground flex items-center gap-1 ${
        overflows
          ? '[mask-image:linear-gradient(to_right,black_80%,transparent_100%)] group-hover:[mask-image:linear-gradient(to_right,transparent_0%,black_6%,black_92%,transparent_100%)]'
          : ''
      }`}
      title={address}
    >
      <MapPin className="h-3 w-3 shrink-0 opacity-70" />
      <span
        ref={textRef}
        className="whitespace-nowrap inline-block"
      >
        <span
          className={
            overflows
              ? 'inline-block transition-transform duration-4000 ease-in-out group-hover:-translate-x-[var(--scroll-offset)]'
              : ''
          }
          style={{ ['--scroll-offset' as any]: `${offset}px` }}
        >
          {address || 'Unassigned'}
        </span>
      </span>
    </div>
  );
}
