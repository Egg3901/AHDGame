/**
 * COST_INCOME_ANCHORS — history-scaled per-capita income anchors for the cost
 * engine (design spec §4.1). ≈0.7 × 1953 GDP-per-capita on the REGIONAL ROLLUP
 * basis (US $397.1B/151.3M · UK £19.8B/52.6M · RU ₽1,400B/189.5M).
 *
 * These are NOT the era catalog's display INCOME_ANCHORS (game-scaled; they keep
 * driving median-income scoring untouched). Using display anchors here would put
 * UK income-term costs ~10× out of proportion.
 */

import type { LawCountryId } from "./types";

export const COST_INCOME_ANCHORS: Record<LawCountryId, number> = {
  US: 1840,
  UK: 265,
  RU: 5170,
  // DDM per-capita income anchor ≈70% of the M 2,700 GDP-per-capita basis,
  // matching the RU anchor's share of its own basis (both NMP economies).
  DD: 1900,
  // Unified Germany inherits the DM anchor at reunification: its fiscal law
  // book contains 119 rescoped dd.* v2 laws that remain priced at the DD
  // anchor until the unified state's income dynamics produce a new band index.
  DE: 1900,
};
