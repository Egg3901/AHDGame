/**
 * Phase 11b — civil-unrest event chain.
 *
 * Post-resolution, randomly select 1-3 unrest event templates (by path
 * severity), emit each as a system news article, and apply a small
 * publicTrust hit to each state in the country.
 *
 * Severity by path:
 *   - Repudiate: 3 events
 *   - Monetize: 2 events
 *   - Restructure: 1 event
 *   - Bailout: 1 event
 *
 * Each event applies -0.02 publicTrust per state. Cumulative hit across
 * 3 events = -0.06 (small enough to avoid double-counting with existing
 * cross-country trust hits in the resolution orchestrators).
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";
import { createSystemNewsPost } from "@/lib/news";
import { applyLegacyTrustDelta } from "@/lib/sovereignDefault/sideEffects/trustHit";

const PER_EVENT_TRUST_HIT = 2;

const EVENT_COUNT_BY_PATH: Record<SovereignResolutionChoice, number> = {
  repudiate: 3,
  monetize: 2,
  restructure: 1,
  bailout: 1,
};

const EVENT_TEMPLATES: string[] = [
  "Pots-and-pans protests grip the capital; thousands demand the government's resignation.",
  "General strike paralyzes the country; transport halted and businesses shuttered.",
  "Riots erupt in major cities as protestors clash with police.",
  "Emergency curfew declared in multiple cities amid austerity protests.",
  "Opposition leaders arrested in pre-dawn raid following street violence.",
  "Bank runs reported as depositors line up overnight to withdraw savings.",
  "Mass demonstrations in front of the legislature demand new elections.",
];

export interface CivilUnrestResult {
  eventsEmitted: number;
}

export async function emitCivilUnrestEvents(
  db: Db,
  countryCode: CountryId,
  resolutionPath: SovereignResolutionChoice,
  rng: () => number = Math.random
): Promise<CivilUnrestResult> {
  const eventCount = EVENT_COUNT_BY_PATH[resolutionPath];
  if (eventCount <= 0) return { eventsEmitted: 0 };

  // Select unique templates without replacement.
  const indices = Array.from({ length: EVENT_TEMPLATES.length }, (_, i) => i);
  // Fisher-Yates shuffle using injected rng (deterministic for tests).
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const chosen = indices.slice(0, eventCount);

  for (const idx of chosen) {
    const template = EVENT_TEMPLATES[idx];
    const content = `Civil Unrest — ${countryCode}: ${template}`;
    await createSystemNewsPost(content, "sovereign");
  }

  // Aggregated publicTrust hit for all events this turn, applied to every
  // region of the country through the political board's events channel. The
  // legacy $inc this replaced targeted a store no country has any more, so the
  // unrest penalty had silently stopped applying.
  const totalHit = eventCount * PER_EVENT_TRUST_HIT;
  await applyLegacyTrustDelta(db, countryCode as CountryId, -totalHit);

  return { eventsEmitted: eventCount };
}
