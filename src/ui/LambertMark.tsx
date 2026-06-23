/** The Lambert mark as inline SVG — the layered normal-map facets (green/blue-violet/pink = the X/Y/Z
 *  normal encoding). Inline (not an <img>) so it scales crisply, renders identically in dev and
 *  packaged builds, and can be dropped wherever a ReactNode icon is wanted (toolbar, empty states).
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
      <polygon points="122.88 32.56 0 19.98 38.23 122.52 122.88 32.56" fill="#0d162f" />
      <polygon points="122.88 22.39 0 9.81 38.23 112.35 122.88 22.39" fill="url(#lm-mid)" />
      <polygon points="122.88 12.59 0 0 38.23 102.55 122.88 12.59" fill="url(#lm-top)" filter="url(#lm-cast)" />
    </svg>
  );
}
