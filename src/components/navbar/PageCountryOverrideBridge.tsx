"use client";

import { usePageCountryOverride } from "@/hooks/useCountryContext";

interface PageCountryOverrideBridgeProps {
  countryId?: string | null;
}

export function PageCountryOverrideBridge({ countryId }: PageCountryOverrideBridgeProps) {
  usePageCountryOverride(countryId);
  return null;
}
