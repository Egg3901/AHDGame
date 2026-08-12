import { useSyncExternalStore } from "react";

export interface WorldFlags {
  preset: string;
  eurozoneEnabled: boolean;
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
let fetchStarted = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!fetchStarted) {
    fetchStarted = true;
    fetch("/api/world/flags")
      .then((r) => r.json())
      .then((data: WorldFlags) => {
        currentFlags = { ...data, loaded: true };
        listeners.forEach((l) => l());
      })
      .catch((err) => {
        // Silent — falls back to 2019-default behavior; keep the error observable.
        console.debug("world flags fetch failed", err);
        currentFlags = { ...currentFlags, loaded: true };
        listeners.forEach((l) => l());
      });
  }
  return () => listeners.delete(listener);
}

function getSnapshot(): WorldFlags {
  return currentFlags;
}

function getServerSnapshot(): WorldFlags {
  return DEFAULT_FLAGS;
}

/** World era flags, fetched once per page load and shared by all consumers.
 *  Defaults to 2019-default behavior until the fetch resolves, so existing
 *  displays are unaffected on load and in 2019-default games. */
export function useWorldFlags(): WorldFlags {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
