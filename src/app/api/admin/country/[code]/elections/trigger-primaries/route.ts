/**
 * POST /api/admin/country/[code]/elections/trigger-primaries
 *
 * Ends the primary phase for all in-primary elections:
 *  1. Record a final primary snapshot.
 *  2. For each party, keep only the top scorer; mark all others "withdrawn".
 *     Also removes duplicate-party entries (same candidate in multiple parties).
 *  3. Set primaryEndTime = now.
 *  4. Initialize an ElectionVoteTally document for each election so the
 *     general-election vote engine can start accumulating.
 */

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { recordPrimarySnapshots } from "@/lib/turnSystem";
import { initElectionVoteTally, fetchEnrichedCandidates } from "@/lib/electionEngine";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";
import {
  calcPrimaryScore,
  calcPresidentPrimaryScore,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
} from "@/lib/primaryScore";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  State,
  StatePartyOrg,
} from "@/lib/db/types";
import {
  COUNTRY_CONFIGS,
  getPrimaryWinnersForElection,
  type CountryId,
} from "@/lib/constants/countries";
import { parseSeatId } from "@/lib/seats/seatId";
import { getGameTime } from "@/lib/time/gameTime";
import { primaryOpenFilter } from "@/lib/elections/electionDeadlineFilters";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();
    // Game turn drives the turn-first primary-phase filter + the close mutation
    // below; `now` stays wall-clock for audit timestamps (withdrawnAt, etc.).
    const { currentTurn } = await getGameTime();
    // Optional additional filters from query params
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state");

    // ── 1. Find every election currently in primary phase ────────────────────
    const query: Record<string, unknown> = {
      status: { $in: ["upcoming", "active"] },
      ...primaryOpenFilter(currentTurn, now),
      countryId,
    };
    if (state) query.state = state;

    const inPrimary = await db.collection<Election>("elections").find(query).toArray();

    if (inPrimary.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No elections are currently in primary phase.",
        advanced: 0,
      });
    }

    // ── 2. Record final primary snapshot ────────────────────────────────────
    const snapshotCount = await recordPrimarySnapshots(now, currentTurn);

    let totalEliminated = 0;
    const electionIds = inPrimary.map((e) => e._id);

    for (const election of inPrimary) {
      // Fetch all active candidates for this election
      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      if (candidates.length === 0) continue;

      // ── 3a. Remove duplicate-party candidates ─────────────────────────────
      // If a character appears under more than one party, withdraw all but their
      // earliest entry (keeps first-entered party, removes the duplicates).
      const seenCharacters = new Map<string, string>(); // characterId → candidateId kept
      const duplicateIds: string[] = [];

      for (const c of candidates) {
        const cid = c.characterId.toString();
        if (seenCharacters.has(cid)) {
          duplicateIds.push(c._id.toString());
        } else {
          seenCharacters.set(cid, c._id.toString());
        }
      }

      if (duplicateIds.length > 0) {
        await db
          .collection("electionCandidates")
          .updateMany(
            { _id: { $in: duplicateIds.map((id) => new ObjectId(id)) } },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
        totalEliminated += duplicateIds.length;
      }

      // Re-fetch active candidates after dedup
      const activeCandidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      // ── 3b. Keep the top `maxAdvancing` primary scorers per party ─────────
      const enriched = await fetchEnrichedCandidates(activeCandidates);
      // Filter parties by election's countryId to avoid cross-country collisions
      const electionCountryId = election.countryId ?? "US";
      const parties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: electionCountryId })
        .toArray();
      const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

      const isPresident = election.electionType === "president";

      // Resolve state lean for state-level alignment (skip president).
      let raceStateEconLean: number | null | undefined;
      let raceStateSocialLean: number | null | undefined;
      if (!isPresident && election.seatId) {
        const localRegionId = parseSeatId(election.seatId).localRegionId;
        if (localRegionId) {
          const stateDoc = await db
            .collection<State>("states")
            .findOne({ _id: localRegionId, countryId: electionCountryId });
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
        const characterIds = activeCandidates.filter((c) => !c.isNPP).map((c) => c.characterId);
        const nppIds = activeCandidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
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

      const partyCounts = new Map<string, number>();
      for (const c of activeCandidates)
        partyCounts.set(c.party, (partyCounts.get(c.party) ?? 0) + 1);

      // How many advance per party. This route used to hardcode 1, which
      // withdrew candidates the turn resolver would have advanced: 3 for
      // UK/JP/DE legislatures, 7 for one-party states. Mirror
      // `resolvePrimariesIfNeeded` exactly.
      const maxAdvancing = getPrimaryWinnersForElection(
        electionCountryId as CountryId,
        election.electionType
      );

      const loserIds: string[] = [];
      for (const [partyId, count] of partyCounts) {
        if (count <= maxAdvancing) continue;

        const partyCandidates = activeCandidates.filter((c) => c.party === partyId);
        const party = partyMap.get(partyId);
        const partyEP = party?.economicPosition ?? 0;
        const partySP = party?.socialPosition ?? 0;

        const scored = partyCandidates
          .map((c) => {
            const ec = enriched.find((e) => e.candidateId === c._id.toString())!;
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
        const { ObjectId } = await import("mongodb");
        await db
          .collection("electionCandidates")
          .updateMany(
            { _id: { $in: loserIds.map((id) => new ObjectId(id)) } },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
        totalEliminated += loserIds.length;
      }

      // ── 3c. Initialize vote tally for the general election ────────────────
      const generalCandidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      if (election.electionType === "president") {
        await initPresidentVoteTally(election._id, generalCandidates);
      } else {
        await initElectionVoteTally(election._id, generalCandidates, election.state);
      }
    }

    // ── 4. Advance primaries ─────────────────────────────────────────────────
    // Set primaryEndTurn = currentTurn so the turn-first resolver treats the
    // primary as closed this turn (primaryEndTime kept for display/fallback).
    await db.collection("elections").updateMany(
      { _id: { $in: electionIds } },
      {
        $set: {
          primaryEndTime: now,
          primaryEndTurn: currentTurn,
          status: "active",
          updatedAt: now,
        },
      }
    );

    console.log(
      `[Admin] Triggered primaries for ${inPrimary.length} election(s), ` +
        `${snapshotCount} snapshots recorded, ${totalEliminated} losers removed`
    );

    return NextResponse.json({
      success: true,
      message: `Advanced ${inPrimary.length} election(s) out of primary phase. ${totalEliminated} candidate(s) eliminated. ${snapshotCount} final snapshot(s) recorded.`,
      advanced: inPrimary.length,
      eliminated: totalEliminated,
      snapshotsRecorded: snapshotCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
