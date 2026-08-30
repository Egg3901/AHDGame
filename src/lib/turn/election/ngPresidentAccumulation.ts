/**
 * Per-zone vote accumulation for NG presidential elections — the NG arm of the
 * presidential pipeline (the US electoral-college accumulation in
 * `presidentialElectionEngine` is untouched). Called each turn for an active NG
 * presidential race; writes per-geopolitical-zone candidate tallies into the
 * tally's `totalVotesByUnit` so `decideNGPresidentOutcome` can apply the
 * federal-character spread rule at resolution.
 *
 * Distribution model (v1): within each zone, the turn's vote pool is split among
 * candidates in proportion to their party's seeded `statePartyOrg` in that zone,
 * weighted by zone population. This yields the correct per-zone vote *shares* the
 * spread rule needs; it is intentionally simpler than the US swing-flow engine.
 * Campaign-strength influence (the player lever) and demographic swing are
 * deliberate future refinements — v1 is org-driven so the resolution pipeline can
 * be exercised first.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { State, StatePartyOrg, ElectionVoteTally } from "@/lib/db/types";
import { NG_ZONES } from "@/lib/nigeriaPresidentialElectionEngine";

/** Approximate NG presidential turnout (share of population voting). */
const NG_TURNOUT_RATE = 0.32;
/** Fraction of the turnout pool that accrues each campaign turn. */
const NG_PER_TURN_FRACTION = 0.1;
/** Floor org so a party with no seeded org in a zone still draws some vote. */
const MIN_ORG = 5;

export async function accumulateNGPresidentVoteTurn(
  db: Db,
  electionId: ObjectId,
  now: Date,
  /** Game turn being processed; guards a stalled turn's re-run (see below). */
  turnNumber?: number
): Promise<void> {
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const tally = await tallies.findOne({ electionId });
  if (!tally || tally.finalized) return;
  // Per-turn idempotency: this engine keeps no per-turn snapshot, so the tally
  // remembers the last turn it accrued. A re-run of a stalled turn (lock
  // cleared, same turn number) must not add a second 10% slice.
  if (typeof turnNumber === "number" && tally.lastAccruedTurn === turnNumber) return;

  const candidateParties = tally.candidateParties ?? {};
  const candidateIds = Object.keys(candidateParties);
  if (candidateIds.length === 0) return;

  const states = await db
    .collection<State>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, population: 1 } })
    .toArray();
  const popByZone = new Map(states.map((s) => [s._id as string, s.population ?? 0]));

  const orgRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId: "NG" })
    .toArray();
  // (zoneId → (partyId → organization))
  const orgByZoneParty = new Map<string, Map<string, number>>();
  for (const row of orgRows) {
    const m = orgByZoneParty.get(row.stateId) ?? new Map<string, number>();
    m.set(row.partyId, row.organization);
    orgByZoneParty.set(row.stateId, m);
  }

  const newByUnit: Record<string, Record<string, number>> = { ...tally.totalVotesByUnit };
  const newTotals: Record<string, number> = { ...tally.totalVotes };

  for (const zone of NG_ZONES) {
    const population = popByZone.get(zone);
    if (!population || population <= 0) continue;
    const pool = population * NG_TURNOUT_RATE * NG_PER_TURN_FRACTION;
    const zoneOrg = orgByZoneParty.get(zone);

    // Weight = the candidate's party org in this zone (floored).
    const weights = new Map<string, number>();
    let totalWeight = 0;
    for (const candidateId of candidateIds) {
      const party = candidateParties[candidateId];
      const org = Math.max(zoneOrg?.get(party) ?? 0, MIN_ORG);
      weights.set(candidateId, org);
      totalWeight += org;
    }
    if (totalWeight <= 0) continue;

    const zoneUnit = { ...(newByUnit[zone] ?? {}) };
    for (const candidateId of candidateIds) {
      const inc = Math.round((pool * (weights.get(candidateId) ?? 0)) / totalWeight);
      if (inc <= 0) continue;
      zoneUnit[candidateId] = (zoneUnit[candidateId] ?? 0) + inc;
      newTotals[candidateId] = (newTotals[candidateId] ?? 0) + inc;
    }
    newByUnit[zone] = zoneUnit;
  }

  await tallies.updateOne(
    { electionId, finalized: { $ne: true } },
    {
      $set: {
        totalVotesByUnit: newByUnit,
        totalVotes: newTotals,
        ...(typeof turnNumber === "number" ? { lastAccruedTurn: turnNumber } : {}),
        updatedAt: now,
      },
    }
  );
}
