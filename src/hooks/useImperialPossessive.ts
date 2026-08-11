"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

/**
 * Fetches the gender-aware possessive for a country's imperial character
 * (e.g., "His Majesty's", "Her Majesty's"). Returns the possessive string
 * or the provided fallback while loading / if no imperial character exists.
 *
 * Results are cached in-memory so subsequent calls for the same country
 * don't trigger additional fetches.
 */
export function useImperialPossessive(
  countryId: string,
  fallback: string = "His Majesty's"
): string {
  // Initialize from cache synchronously to avoid unnecessary renders
  const cached = cache.get(countryId);
  const [possessive, setPossessive] = useState<string>(cached ?? fallback);

  useEffect(() => {
    // Already cached — initial state handles it
    if (cache.has(countryId)) return;

    let cancelled = false;
    fetch(`/api/imperial-characters?countryId=${countryId}`)
      .then((r) => r.json())
      .then((json) => {
        const value = json.imperial?.possessive ?? fallback;
        cache.set(countryId, value);
        if (!cancelled) setPossessive(value);
      })
      .catch(() => {
        cache.set(countryId, fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [countryId, fallback]);

  return possessive;
}
