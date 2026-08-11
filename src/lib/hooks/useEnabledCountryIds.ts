"use client";

import { useEffect, useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Parse the `/api/game/countries` payload into a list of uppercase {@link CountryId}.
 *
 * The route returns `CountryCreationInfo[]` — objects shaped `{ id: <lowercase>, name, … }`.
 * Older callers assumed a bare `string[]`, which silently fed entire objects into UI that
 * expected country-id strings (e.g. the tariff origin-country selector), crashing the render.
 * This helper accepts both the current object shape and the legacy string shape, normalises
 * ids to uppercase, and drops anything that is not a recognised country.
 */
export function parseEnabledCountryIds(data: unknown): CountryId[] {
  const countries = (data as { countries?: unknown } | null | undefined)?.countries;
  if (!Array.isArray(countries)) return [];

  const ids: CountryId[] = [];
  for (const entry of countries) {
    const raw =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id
          : undefined;
    if (!raw) continue;
    const upper = raw.toUpperCase() as CountryId;
    if (COUNTRY_CONFIGS[upper]) ids.push(upper);
  }
  return ids;
}

/**
 * Fetch the runtime-enabled countries as uppercase {@link CountryId}s.
 *
 * Single source of truth for bill-proposal modals so the `/api/game/countries`
 * response shape is parsed in exactly one place.
 */
export function useEnabledCountryIds(): CountryId[] {
  const [ids, setIds] = useState<CountryId[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/game/countries")
      .then((r) => (r.ok ? r.json() : { countries: [] }))
      .then((data) => {
        if (!cancelled) setIds(parseEnabledCountryIds(data));
      })
      .catch((err) => {
        // Modal country list falls back to empty — keep the error observable.
        console.debug("enabled-country list fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ids;
}
