import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface TokenIconProps {
  src?: string;
  symbol: string;
  size?: number;
  className?: string;
}

const COLORS = [
  'hsl(192 100% 55%)', 'hsl(330 100% 60%)', 'hsl(210 100% 60%)',
  'hsl(45 100% 50%)', 'hsl(270 80% 60%)', 'hsl(350 80% 55%)',
];

function getColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function TokenIcon({ src, symbol, size = 32, className = '' }: TokenIconProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(!!src);
  const letter = (symbol || '?')[0].toUpperCase();

  if (src && !imgError) {
    return (
      <div
        className={`relative shrink-0 rounded-full overflow-hidden ${className}`}
        style={{ width: size, height: size }}
      >
        {imgLoading && (
          <div
            className="absolute inset-0 bg-secondary animate-pulse rounded-full"
          />
        )}
        <img
          src={src}
          alt={symbol}
          width={size}
          height={size}
          className="rounded-full object-cover"
          onError={() => setImgError(true)}
          onLoad={() => setImgLoading(false)}
        />
      </div>
    );
  }

  if (symbol.includes('..') || imgError) {
    return (
      <div
        className={`shrink-0 rounded-full flex items-center justify-center bg-secondary ${className}`}
        style={{ width: size, height: size }}
      >
        <ImageOff size={size * 0.45} className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-bold ${className}`}
      style={{
        width: size,
        height: size,
        background: getColor(symbol),
        color: 'hsl(220 16% 4%)',
        fontSize: size * 0.4,
      }}
    >
      {letter}
    </div>
  );
}