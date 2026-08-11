"use client";
import Image from "next/image";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";

interface CountryFlagProps {
  country: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  width?: number;
  height?: number;
  className?: string;
  title?: string;
}

const sizeMap = {
  sm: { width: 16, height: 11 },
  md: { width: 20, height: 14 },
  lg: { width: 24, height: 16 },
  xl: { width: 32, height: 21 },
  "2xl": { width: 48, height: 32 },
};

export function CountryFlag({
  country,
  size = "sm",
  width,
  height,
  className = "",
  title,
}: CountryFlagProps) {
  const preset = useActivePreset();
  const dims = sizeMap[size];
  const finalWidth = width ?? dims.width;
  const finalHeight = height ?? dims.height;
  // Pass the active preset so era-dependent flags (RU → Soviet flag in 1979)
  // resolve correctly; the preset is in the URL so the CDN cache stays per-era.
  const flagUrl = `/api/flags/country/${country}?era=${encodeURIComponent(preset)}`;

  return (
    <Image
      src={flagUrl}
      alt={`${country} flag`}
      width={finalWidth}
      height={finalHeight}
      className={`inline-block rounded-sm shrink-0 object-cover ${className}`}
      title={title || country}
      priority={false}
      unoptimized={bypassNextImageOptimization(flagUrl)}
    />
  );
}
