"use client";

import { useState } from "react";
import Image from "next/image";
import { Factory } from "lucide-react";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

const SIZE_MAP: Record<string, number> = {
  "h-4 w-4": 16,
  "h-5 w-5": 20,
  "h-6 w-6": 24,
  "h-7 w-7": 28,
  "h-8 w-8": 32,
  "h-9 w-9": 36,
  "h-10 w-10": 40,
  "h-12 w-12": 48,
  "h-14 w-14": 56,
  "h-16 w-16": 64,
};

const ICON_CLASS: Record<string, string> = {
  "h-4 w-4": "h-2.5 w-2.5",
  "h-5 w-5": "h-3 w-3",
  "h-6 w-6": "h-3.5 w-3.5",
  "h-7 w-7": "h-4 w-4",
  "h-8 w-8": "h-4 w-4",
  "h-9 w-9": "h-5 w-5",
  "h-10 w-10": "h-5 w-5",
  "h-12 w-12": "h-6 w-6",
  "h-14 w-14": "h-7 w-7",
  "h-16 w-16": "h-8 w-8",
};

export interface CorporationLogoProps {
  logoUrl?: string | null;
  name?: string;
  /** Tailwind size class, default "h-8 w-8" */
  size?: string;
  className?: string;
  /** When true, fills a position:relative parent with defined dimensions */
  fill?: boolean;
}

function FactoryFallback({
  size,
  className,
  fill,
}: {
  size: string;
  className: string;
  fill?: boolean;
}) {
  const iconClass = ICON_CLASS[size] ?? "h-4 w-4";
  const base = fill
    ? "absolute inset-0 flex items-center justify-center text-muted"
    : `flex items-center justify-center shrink-0 text-muted ${size}`;

  return (
    <span className={`${base} ${className}`} aria-hidden>
      <Factory className={iconClass} strokeWidth={1.75} />
    </span>
  );
}

/**
 * Corporation logo with a factory icon fallback when no upload exists or the image fails to load.
 */
export function CorporationLogo({
  logoUrl,
  name = "",
  size = "h-8 w-8",
  className = "",
  fill = false,
}: CorporationLogoProps) {
  const [errored, setErrored] = useState(false);
  const sizePx = SIZE_MAP[size] ?? 32;
  const showImage = Boolean(logoUrl) && !errored;

  if (!showImage) {
    return <FactoryFallback size={size} className={className} fill={fill} />;
  }

  if (fill) {
    return (
      <Image
        src={logoUrl!}
        alt={name}
        fill
        className={`object-cover ${className}`}
        sizes="64px"
        unoptimized={bypassNextImageOptimization(logoUrl!)}
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <Image
      src={logoUrl!}
      alt={name}
      width={sizePx}
      height={sizePx}
      className={`${size} object-cover shrink-0 ${className}`}
      sizes={`${sizePx}px`}
      unoptimized={bypassNextImageOptimization(logoUrl!)}
      onError={() => setErrored(true)}
    />
  );
}
