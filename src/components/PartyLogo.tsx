"use client";

import { useState } from "react";
import Image from "next/image";
import type { CountryId } from "@/lib/constants/countries";
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

interface PartyLogoProps {
  partyId: string | null | undefined;
  partyColor: string;
  size?: string; // e.g. "h-4 w-4"
  className?: string;
  fallbackClassName?: string;
  /** Custom logo URL (takes precedence over route lookup) */
  logoUrl?: string | null;
  /** Country ID for proper party lookup (required for sequential ID system) */
  countryId?: CountryId | null;
  /** Accessible name when the logo is decorative (empty = decorative if name is shown beside it) */
  logoAlt?: string;
}

export function PartyLogo({
  partyId,
  partyColor,
  size = "h-4 w-4",
  className = "",
  fallbackClassName = "",
  logoUrl,
  countryId,
  logoAlt = "",
}: PartyLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const id = (partyId ?? "independent").toString().toLowerCase();

  const sizePx = SIZE_MAP[size] ?? 16;
  // Use custom logoUrl if provided, otherwise fetch from logo route with country param
  const countryParam = countryId ? `?country=${countryId.toLowerCase()}` : "";
  const src = logoUrl || `/api/logos/parties/${id}${countryParam}`;
  const hasError = failedSrc === src;

  // Skip image attempt for "independent" - just show colored circle
  if (id === "independent" || hasError) {
    return (
      <div
        className={`${size} rounded-full ${className} ${fallbackClassName}`}
        style={{ backgroundColor: partyColor }}
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
      sizes="64px"
      unoptimized={bypassNextImageOptimization(src)}
      onError={() => setFailedSrc(src)}
    />
  );
}
