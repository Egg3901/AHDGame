import { getCnNpcSeats, getCnPeoplesCongressSeats } from "@/lib/constants";
import { ensureRegionalDelegateElections, ensureRegionalGovernorElections } from "../shared";

/**
 * Ensure every CN region has an active/upcoming NPC Delegate election.
 *
 * Simple canonical LARP scheduling — no snap elections, no staggered classes.
 * Each region gets one multi-seat election with all seats contested.
 * Uses `buildCanonicalSpawn` for cycle computation and timing.
 */
export async function ensureCNElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "CN",
      electionType: "npcDelegate",
      // Authoritative per-region NPC seat count (was `1`, which would collapse
      // the first cycle to one seat per region). Era-gated: a 1953 world seats
      // the 1,226-deputy 1st NPC, not the modern 2,980 (#3779).
      seatsForRegions: (_regions, preset) => getCnNpcSeats(preset),
      openPrimaryImmediately: true,
      label: "NPC Delegate",
    },
    now
  );
}

// ─── Brazil: Chamber of Deputies + Senate ───────────────────────────────────

/**
 * Ensure every CN macro-region has an active/upcoming Provincial People's
 * Congress election. Mirrors `ensureCNElections` for the sub-national
 * legislature: one multi-seat PR election per province on a 5-year cycle,
 * sized from `CN_PEOPLES_CONGRESS_SEATS`. Canonical cycle is anchored to
 * the NPC end turn so national and provincial elections fire on the same
 * turn (matches real-world quinquennial cadence).
 */
export async function ensureCNPeoplesCongressElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "CN",
      electionType: "peoplesCongress",
      seatsForRegions: (_regions, preset) => getCnPeoplesCongressSeats(preset),
      openPrimaryImmediately: true,
      label: "People's Congress",
    },
    now
  );
}

/**
 * Spawn perpetual governor elections for all 7 CN macro-regions on a
 * preset-anchored 5-year cycle.
 *
 * In-universe these aren't competitive races (CCP holds every regional
 * executive in the seeded reality), but the engine still spawns the
 * election so players can stage primary challenges, CDL / CNDCA token
 * candidacies, and so the regional governor seat has a normal succession
 * path (term expiry, retirement, scandal removal) rather than sitting
 * frozen on the seeded NPP forever.
 */
export async function ensureCNGovernorElections(now: Date): Promise<void> {
  await ensureRegionalGovernorElections("CN", now);
}
