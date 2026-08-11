"use client";

import { useState } from "react";
import Image from "next/image";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

const SIZE_MAP: Record<string, number> = {
  "h-1.5 w-1.5": 6,
  "h-2 w-2": 8,
  "h-2.5 w-2.5": 10,
  "h-3 w-3": 12,
  "h-3.5 w-3.5": 14,
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

interface CoalitionLogoProps {
  coalitionId: string | null | undefined;
  coalitionColor: string;
  size?: string;
  className?: string;
  fallbackClassName?: string;
  /** Custom logo URL (takes precedence over route lookup) */
  logoUrl?: string | null;
  /** Country ID for proper coalition lookup */
  countryId?: "US" | "UK" | "DE" | "JP" | null;
  /** Accessible name when the logo is decorative (empty = decorative if name is shown beside it) */
  logoAlt?: string;
}

export function CoalitionLogo({
  coalitionId,
  coalitionColor,
  size = "h-8 w-8",
  className = "",
  fallbackClassName = "",
  logoUrl,
  countryId,
  logoAlt = "",
}: CoalitionLogoProps) {
  const [hasError, setHasError] = useState(false);

  const sizePx = SIZE_MAP[size] ?? 32;
  const countryParam = countryId ? `?country=${countryId.toLowerCase()}` : "";
  const src = logoUrl || `/api/logos/coalitions/${coalitionId}${countryParam}`;

  if (!coalitionId || hasError || !logoUrl) {
    return (
      <div
        className={`${size} rounded-full ${className} ${fallbackClassName}`}
        style={{ backgroundColor: coalitionColor }}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={logoAlt}
      width={sizePx}
      height={sizePx}
      className={`${size} object-contain ${className}`}
      unoptimized={bypassNextImageOptimization(src)}
      onError={() => setHasError(true)}
    />
  );
}
