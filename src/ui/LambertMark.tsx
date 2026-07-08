/** The Lambert mark as inline SVG — three stacked sheets pointing straight down; the gradients are the normal-map encoding (green/blue-violet/pink = X/Y/Z).
 *  Inline (not an <img>) so it scales crisply, renders identically in dev and packaged builds, and
 *  can be dropped wherever a ReactNode icon is wanted (toolbar, empty states, explorer rows).
 *  Mirrors build/icon.svg, which is the source for the OS/installer icon. */
export function LambertMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="-5 -5 134 134" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id="lm-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6effa8" />
          <stop offset="0.45" stopColor="#8080ff" />
          <stop offset="1" stopColor="#ff7da0" />
        </linearGradient>
        <linearGradient id="lm-mid" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#56c8ff" />
          <stop offset="0.5" stopColor="#6a6fe8" />
          <stop offset="1" stopColor="#ff7dc8" />
        </linearGradient>
        <filter id="lm-cast" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="1.5" dy="5" stdDeviation="3" floodColor="#000000" floodOpacity="0.5" />
        </filter>
      </defs>
      <polygon points="2 24 122 24 62 122.5 2 24" fill="#0d162f" />
      <polygon points="2 14 122 14 62 112.5 2 14" fill="url(#lm-mid)" />
      <polygon points="2 4 122 4 62 102.5 2 4" fill="url(#lm-top)" filter="url(#lm-cast)" />
    </svg>
  );
}
