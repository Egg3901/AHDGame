/**
 * POST /api/admin/elections/resolve-primaries
 *
 * Scans every active/upcoming election whose primaryEndTime has already
 * passed and eliminates all but the top-scoring candidates per party, keeping
 * the cap returned by `getPrimaryWinnersForCountry` (1 for presidential
 * systems, 3 for parliamentary, 7 for one-party states).
 * Also initialises an ElectionVoteTally for elections that don't have one yet.
 *
 * Safe to call multiple times — elections that are already resolved (no party
 * exceeds maxAdvancing candidates) are skipped automatically.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { fetchEnrichedCandidates, initElectionVoteTally } from "@/lib/electionEngine";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";
import {
  calcPrimaryScore,
  calcPresidentPrimaryScore,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
} from "@/lib/primaryScore";
import { getPrimaryWinnersForElection, type CountryId } from "@/lib/constants/countries";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  State,
  StatePartyOrg,
} from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { parseSeatId } from "@/lib/seats/seatId";
import { getGameTime } from "@/lib/time/gameTime";
import { primaryClosedFilter, electionOpenFilter } from "@/lib/elections/electionDeadlineFilters";

// POST /api/admin/elections/resolve-primaries — Eliminates primary losers and initializes vote tallies for elections whose primary phase has ended.
// Auth: requireAdmin
// Errors: 401, 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();
    // Turn-first phase filter; `now` stays wall-clock for audit timestamps.
    const { currentTurn, effectiveNow } = await getGameTime();

    // All elections whose primary window has closed but which are still running
    const pastPrimary = await db
      .collection<Election>("elections")
      .find({
        status: { $in: ["active", "upcoming"] },
        $and: [
          primaryClosedFilter(currentTurn, effectiveNow),
          electionOpenFilter(currentTurn, effectiveNow),
        ],
      })
      .toArray();

    if (pastPrimary.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No elections are past their primary phase.",
        scanned: 0,
        eliminated: 0,
        talliesCreated: 0,
      });
    }

    // Use composite keys to avoid cross-country sequential ID collisions
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find(
        {},
        {
          projection: {
            sequentialId: 1,
            countryId: 1,
            economicPosition: 1,
            socialPosition: 1,
            chairId: 1,
          },
        }
      )
      .toArray();
    const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));

    // Pre-batch: all active candidates for all elections at once
    const allPastPrimaryIds = pastPrimary.map((e) => e._id as ObjectId);
    const allActiveCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: allPastPrimaryIds }, status: "active" })
      .toArray();
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of allActiveCandidates) {
      const key = (c.electionId as ObjectId).toString();
      const arr = candidatesByElection.get(key) ?? [];
      arr.push(c);
      candidatesByElection.set(key, arr);
    }

    // Pre-batch: which elections already have a vote tally
    const existingTallyElectionIds = new Set(
      (
        await db
          .collection("electionVoteTallies")
          .find({ electionId: { $in: allPastPrimaryIds } }, { projection: { electionId: 1 } })
          .toArray()
      ).map((t) => (t.electionId as ObjectId).toString())
    );

    let totalEliminated = 0;
    let talliesCreated = 0;
    let scanned = 0;

    for (const election of pastPrimary) {
      scanned++;
      const electionId = election._id as ObjectId;

      const candidates = candidatesByElection.get(electionId.toString()) ?? [];

      if (candidates.length === 0) continue;

      // Check if any party has more than one active candidate
      const partyCounts = new Map<string, number>();
      for (const c of candidates) {
        partyCounts.set(c.party, (partyCounts.get(c.party) ?? 0) + 1);
      }
      // Primary-winners cap is driven by the country's `governmentType`
      // (presidential → 1, parliamentary → 3, onePartyState → 7), except
      // single-winner executive races (governor/president) always cap at 1.
      // Keep the top `maxAdvancing` scored candidates per party, prune the rest.
      const maxAdvancing = getPrimaryWinnersForElection(
        (election.countryId ?? "US") as CountryId,
        election.electionType
      );
      const hasContestedParty = [...partyCounts.values()].some((v) => v > maxAdvancing);

      if (hasContestedParty) {
        const enriched = await fetchEnrichedCandidates(candidates);
        const loserIds: string[] = [];
        const isPresident = election.electionType === "president";

        // Resolve state lean for state-level alignment (skip president).
        let raceStateEconLean: number | null | undefined;
        let raceStateSocialLean: number | null | undefined;
        if (!isPresident && election.seatId) {
          const localRegionId = parseSeatId(election.seatId).localRegionId;
          if (localRegionId) {
            const stateDoc = await db
              .collection<State>("states")
              .findOne({ _id: localRegionId, countryId: election.countryId ?? "US" });
            if (
              stateDoc &&
              typeof stateDoc.cachedEconomicLean === "number" &&
              typeof stateDoc.cachedSocialLean === "number"
            ) {
              raceStateEconLean = stateDoc.cachedEconomicLean;
              raceStateSocialLean = stateDoc.cachedSocialLean;
            }
          }
        }

        const partyOrgByStateParty = new Map<string, number>();
        let charMap = new Map<string, Character>();
        let _nppMap = new Map<string, NPP>();
        let partyChairMaps = buildPartyChairMaps(parties, []);
        if (isPresident) {
          const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
          const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
          const [chars, npps, statePartyOrgs] = await Promise.all([
            characterIds.length > 0
              ? db
                  .collection<Character>("characters")
                  .find({ _id: { $in: characterIds } })
                  .toArray()
              : [],
            nppIds.length > 0
              ? db
                  .collection<NPP>("npps")
                  .find({ _id: { $in: nppIds } })
                  .toArray()
              : [],
            db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
          ]);
          charMap = new Map(chars.map((c) => [c._id.toString(), c]));
          _nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
          partyChairMaps = buildPartyChairMaps(parties, statePartyOrgs);
          for (const po of statePartyOrgs) {
            partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
          }
        }

        for (const [partyId, count] of partyCounts) {
          if (count <= maxAdvancing) continue;

          const party = partyMap.get(`${election.countryId ?? "US"}:${partyId}`);
          const partyEP = party?.economicPosition ?? 0;
          const partySP = party?.socialPosition ?? 0;

          const scored = candidates
            .filter((c) => c.party === partyId)
            .map((c) => {
              const ec = enriched.find((e) => e.candidateId === c._id.toString());
              if (!ec) return { candidateId: c._id.toString(), score: 0 };
              let score: number;
              if (isPresident) {
                // Party influence (candidate's own party clout), NPPs have none. See #934.
                // National chairs get +25% on the value used for primary calcs.
                // State chairs get no boost on the national snapshot (geographic only).
                const rawPartyInfluence = c.isNPP
                  ? 0
                  : (charMap.get(c.characterId.toString())?.partyInfluence ?? 0);
                const role = c.isNPP
                  ? null
                  : resolvePartyChairPrimaryRole(c.characterId.toString(), partyChairMaps);
                const partyInfluence = effectivePartyInfluenceForPresidentialPrimary(
                  rawPartyInfluence,
                  role
                );
                const nationalOrPol = c.isNPP
                  ? ec.politicalInfluence
                  : (charMap.get(c.characterId.toString())?.nationalInfluence ??
                    ec.politicalInfluence);
                score = calcPresidentPrimaryScore(
                  ec.charEP,
                  ec.charSP,
                  partyEP,
                  partySP,
                  ec.favorability,
                  nationalOrPol,
                  partyInfluence,
                  ec.infamy
                );
              } else {
                score = calcPrimaryScore(
                  ec.charEP,
                  ec.charSP,
                  partyEP,
                  partySP,
                  ec.favorability,
                  ec.politicalInfluence,
                  ec.infamy,
                  raceStateEconLean,
                  raceStateSocialLean
                );
              }
              return { candidateId: c._id.toString(), score };
            })
            .sort((a, b) => b.score - a.score);

          for (const s of scored.slice(maxAdvancing)) loserIds.push(s.candidateId);
        }

        if (loserIds.length > 0) {
          await db
            .collection("electionCandidates")
            .updateMany(
              { _id: { $in: loserIds.map((id) => new ObjectId(id)) } },
              { $set: { status: "withdrawn", withdrawnAt: now } }
            );
          totalEliminated += loserIds.length;

          // Archive (not delete) campaign documents for eliminated primary
          // candidates so they survive until the election resolves. Mirrors the
          // turn-based primaryResolution path.
          const loserCharIds = candidates
            .filter((c) => loserIds.includes(c._id.toString()) && c.characterId && !c.isNPP)
            .map((c) => c.characterId!);
          if (loserCharIds.length > 0) {
            await db.collection("campaigns").updateMany(
              { electionId, candidateId: { $in: loserCharIds }, status: { $ne: "archived" } },
              {
                $set: {
                  status: "archived",
                  archivedAt: now,
                  archivedReason: "primary_loss",
                  updatedAt: now,
                },
              }
            );
          }
        }
      }

      // Ensure vote tally exists
      if (!existingTallyElectionIds.has(electionId.toString())) {
        const generalCandidates = await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId, status: "active" })
          .toArray();
        if (election.electionType === "president") {
          await initPresidentVoteTally(electionId, generalCandidates);
        } else {
          await initElectionVoteTally(electionId, generalCandidates, election.state as string);
        }
        talliesCreated++;
      }
    }

    const msg = [
      `Scanned ${scanned} election(s).`,
      totalEliminated > 0
        ? `${totalEliminated} primary loser(s) eliminated.`
        : "No losers to eliminate.",
      talliesCreated > 0 ? `${talliesCreated} vote tally document(s) created.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    console.log(`[Admin] resolve-primaries: ${msg}`);

    return NextResponse.json({
      success: true,
      message: msg,
      scanned,
      eliminated: totalEliminated,
      talliesCreated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
