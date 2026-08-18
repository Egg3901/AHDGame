/**
 * POST /api/admin/elections/fill-npps
 *
 * Deterministically fills vacant/unopposed races with NPPs.
 * Unlike the turn-system probabilistic entry, this:
 *   - Includes general-phase elections (not just primary)
 *   - Bypasses probability, cooldowns, and per-turn limits
 *   - Only fills races that have fewer candidates than a minimum threshold
 *   - Does NOT modify normal NPP election behavior
 *
 * For each qualifying race, picks an idle NPP from the correct state+party
 * and inserts them as a candidate.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";

/** Minimum candidates per party per race. Races below this get filled. */
const MIN_CANDIDATES_PER_PARTY = 1;

// POST /api/admin/elections/fill-npps — Deterministically fills vacant race slots with idle NPPs, bypassing normal probability limits.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // All active elections (including general phase). Presidential races are
    // excluded — NPPs are barred from presidential elections by design, so even
    // this admin bypass must not create NPP presidential candidates.
    const elections = await db
      .collection<Election>("elections")
      .find({
        status: { $in: ["active", "upcoming"] },
        electionType: { $ne: "president" },
      })
      .toArray();

    if (elections.length === 0) {
      return NextResponse.json({ message: "No active elections.", filled: 0 });
    }

    const electionIds = elections.map((e) => e._id);

    // All active candidates grouped by election+party
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray();

    // Count candidates per election per party
    const countByElectionParty = new Map<string, number>();
    for (const c of candidates) {
      const key = `${c.electionId}_${c.party}`;
      countByElectionParty.set(key, (countByElectionParty.get(key) ?? 0) + 1);
    }

    // NPPs already running (by nppId)
    const runningNppIds = new Set(
      candidates.filter((c) => c.nppId).map((c) => c.nppId!.toString())
    );

    // All idle, non-retired NPPs
    const npps = await db.collection<NPP>("npps").find({ retiredAt: null }).toArray();

    // Index idle NPPs by state+party
    const nppsByStateParty = new Map<string, NPP[]>();
    for (const npp of npps) {
      if (runningNppIds.has(npp._id.toString())) continue;
      const key = `${npp.homeState}_${npp.party}`;
      if (!nppsByStateParty.has(key)) nppsByStateParty.set(key, []);
      nppsByStateParty.get(key)!.push(npp);
    }

    // Determine which parties should be in each election based on country config
    function getPartiesForElection(election: Election): string[] {
      const config = getCountryConfig(election.countryId || "US");
      return config.majorPartyIds;
    }

    // For national elections (president, PM), NPPs can come from any state in that country
    function isNationalElection(election: Election): boolean {
      if (!election.countryId) return false;
      const config = getCountryConfig(election.countryId);
      const officeConfig = config.officeTypes.find((o) => o.key === election.electionType);
      return !!officeConfig?.isExecutive && !officeConfig.isSubNational;
    }

    const toInsert: Omit<ElectionCandidate, "_id">[] = [];
    const usedNpps = new Set<string>();

    for (const election of elections) {
      const parties = getPartiesForElection(election);
      const isNational = isNationalElection(election);

      for (const partyId of parties) {
        const key = `${election._id}_${partyId}`;
        const count = countByElectionParty.get(key) ?? 0;
        if (count >= MIN_CANDIDATES_PER_PARTY) continue;

        // Need to fill this slot — find an idle NPP
        const needed = MIN_CANDIDATES_PER_PARTY - count;
        for (let i = 0; i < needed; i++) {
          let npp: NPP | undefined;

          if (isNational) {
            // For national elections, search all states in the country
            for (const [statePartyKey, pool] of nppsByStateParty) {
              if (!statePartyKey.endsWith(`_${partyId}`)) continue;
              npp = pool.find((n) => !usedNpps.has(n._id.toString()));
              if (npp) break;
            }
          } else {
            const pool = nppsByStateParty.get(`${election.state}_${partyId}`);
            if (pool) {
              npp = pool.find((n) => !usedNpps.has(n._id.toString()));
            }
          }

          if (!npp) continue;

          usedNpps.add(npp._id.toString());

          const candidateCountryId = (election.countryId ??
            npp.countryId ??
            "US") as ElectionCandidate["countryId"];

          toInsert.push({
            electionId: election._id,
            countryId: candidateCountryId,
            characterId: npp._id,
            characterName: npp.name,
            party: npp.party,
            status: "active",
            enteredAt: now,
            isNPP: true,
            nppId: npp._id,
          });
        }
      }
    }

    if (toInsert.length > 0) {
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .insertMany(toInsert as ElectionCandidate[]);
    }

    return NextResponse.json({
      message: `Filled ${toInsert.length} vacant race slot(s) with NPPs.`,
      filled: toInsert.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
