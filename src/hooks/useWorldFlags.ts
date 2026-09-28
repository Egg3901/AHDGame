import type { EuroMonetaryUnion } from "@/lib/currency/euro/rules";
import { useSyncExternalStore } from "react";
import { useGameEvents } from "@/hooks/useGameEvents";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface WorldFlags {
  preset: string;
  eurozoneEnabled: boolean;
  euroMonetaryUnion?: EuroMonetaryUnion;
  euroMemberCurrencies?: CurrencyCode[];
  euroAdoptionEligibleCountries?: CountryId[];
  /** Era system master switch (era stamps, wire news, era-aware scoring); false until an admin enables it. */
  eraSystemEnabled: boolean;
  /** Live in-game year (null until the fetch resolves or on legacy rows). */
  currentYear: number | null;
  /** Decade era id ("2000s") stamped by the era-crossing phase; null before the first crossing. */
  currentEraId: string | null;
  /** World starting year (frozen) — anchors the medianIncome era band; null flag-off. */
  startingYear: number | null;
  /** Per-country realized-growth index for the medianIncome era band; null flag-off. */
  incomeBandIndexByCountry: Partial<Record<string, number>> | null;
  /** Live election results page master gate; gates "Live Results" links. */
  liveElectionResultsEnabled: boolean;
  /**
   * False until the fetch settles. Callers that pick era-specific assets should
   * wait on this — otherwise they render the 2019 default for a frame and then
   * swap. Set to true on failure too, so a dead endpoint degrades to defaults
   * instead of pinning consumers in a permanent loading state.
   */
  loaded: boolean;
}

const DEFAULT_FLAGS: WorldFlags = {
  preset: "2019-default",
  eurozoneEnabled: true,
  eraSystemEnabled: false,
  currentYear: null,
  currentEraId: null,
  startingYear: null,
  incomeBandIndexByCountry: null,
  liveElectionResultsEnabled: false,
  loaded: false,
};

// Module-level store: the flags are world-global, so one fetch serves every
// consumer (currency provider, every metric card, ...) instead of one request
// per mounted hook.
let currentFlags: WorldFlags = DEFAULT_FLAGS;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function refreshFlags(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/world/flags", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("World flags unavailable");
      return response.json();
    })
    .then((data: WorldFlags) => {
      currentFlags = { ...DEFAULT_FLAGS, ...data, loaded: true };
    })
    .catch((err) => {
      console.debug("world flags fetch failed", err);
      currentFlags = { ...currentFlags, loaded: true };
    })
    .finally(() => {
      inFlight = null;
      listeners.forEach((listener) => listener());
    });
  return inFlight;
}

function onFocus() {
  void refreshFlags();
}

function subscribe(listener: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    void refreshFlags();
    window.addEventListener("focus", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("focus", onFocus);
  };
}

function getSnapshot(): WorldFlags {
  return currentFlags;
}

function getServerSnapshot(): WorldFlags {
  return DEFAULT_FLAGS;
}

/** Shared world flags refresh after turns, enacted bills and window focus. */
export function useWorldFlags(): WorldFlags {
  useGameEvents(onFocus, ["turn_complete", "bill_enacted"]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
