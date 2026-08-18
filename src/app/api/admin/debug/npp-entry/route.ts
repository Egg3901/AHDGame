import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, ElectionCandidate, NPP, GameState } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { isNPPAvailable, RACE_PRIORITY } from "@/lib/turn/nppEntryLogic";
import { primaryOpenFilter } from "@/lib/elections/electionDeadlineFilters";

/**
 * Debug endpoint to diagnose why NPPs aren't entering primaries.
 * GET /api/admin/debug/npp-entry
 */
// GET /api/admin/debug/npp-entry — Diagnose why NPPs aren't entering primaries by simulating the entry logic.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get game time (same calculation as processTurn)
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const lastProcessed = gameState?.lastTurnProcessed
      ? new Date(gameState.lastTurnProcessed)
      : new Date();
    const gameNow = new Date(lastProcessed.getTime() + MS_PER_TURN);
    const realNow = new Date();
    const currentTurn = gameState?.currentTurn ?? 1;

    // 1. Open primaries query (same as nppBehavior.ts) — turn-first w/ Date fallback
    const openPrimaries = await db
      .collection<Election>("elections")
      .find({
        status: "active",
        ...primaryOpenFilter(currentTurn, gameNow),
      })
      .toArray();

    // 2. All active elections (for comparison)
    const allActiveElections = await db
      .collection<Election>("elections")
      .find({ status: "active" })
      .toArray();

    // 3. Non-retired NPPs
    const allNPPs = await db.collection<NPP>("npps").find({ retiredAt: null }).toArray();

    // 4. Load candidates for open primaries
    const primaryIds = openPrimaries.map((e) => e._id);
    const allCandidates =
      primaryIds.length > 0
        ? await db
            .collection<ElectionCandidate>("electionCandidates")
            .find({ electionId: { $in: primaryIds }, status: "active" })
            .toArray()
        : [];

    // Build NPP candidacies set
    const nppCandidacies = new Set<string>();
    for (const c of allCandidates) {
      if (c.isNPP && c.nppId) {
        nppCandidacies.add(c.nppId.toString());
      }
    }

    // Group primaries by state
    const primariesByState = new Map<string, Election[]>();
    for (const e of openPrimaries) {
      const state = e.state || e.countryId || "UNKNOWN";
      if (!primariesByState.has(state)) primariesByState.set(state, []);
      primariesByState.get(state)!.push(e);
    }

    // NPP homeStates
    const nppHomeStates = new Set(allNPPs.map((n) => n.homeState));

    // Check state matching
    const electionStates = [...primariesByState.keys()];
    const matchingStates = electionStates.filter((s) => nppHomeStates.has(s));

    // Sample analysis for first state with open primaries
    let sampleAnalysis = null;
    if (openPrimaries.length > 0) {
      const sampleState = openPrimaries[0].state;
      const statePrimaries = openPrimaries.filter((e) => e.state === sampleState);
      const stateNPPs = allNPPs.filter((n) => n.homeState === sampleState);
      const partyCounts = new Map<string, number>();
      for (const npp of stateNPPs) {
        partyCounts.set(npp.party, (partyCounts.get(npp.party) ?? 0) + 1);
      }

      // Check which parties already have candidates
      const primaryAnalysis = [];
      for (const primary of statePrimaries) {
        const candidates = allCandidates.filter(
          (c) => c.electionId.toString() === primary._id.toString()
        );
        const partiesWithCandidates = [...new Set(candidates.map((c) => c.party))];
        const partiesNeedingCandidates = [...partyCounts.keys()].filter(
          (p) => !partiesWithCandidates.includes(p)
        );

        primaryAnalysis.push({
          electionType: primary.electionType,
          totalCandidates: candidates.length,
          nppCandidates: candidates.filter((c) => c.isNPP).length,
          partiesWithCandidates,
          partiesNeedingCandidates,
          primaryEndTime: primary.primaryEndTime,
          endTime: primary.endTime,
        });
      }

      sampleAnalysis = {
        state: sampleState,
        nppsInState: stateNPPs.length,
        partyCounts: Object.fromEntries(partyCounts),
        primaries: primaryAnalysis,
      };
    }

    // Simulate processElectionEntry for the first party/state to trace issues
    let entrySimulation = null;
    if (openPrimaries.length > 0 && allNPPs.length > 0) {
      const parties = [...new Set(allNPPs.map((n) => n.party))];
      const firstParty = parties[0];
      const firstState = openPrimaries[0].state;
      const statePrimaries = openPrimaries.filter((e) => e.state === firstState);

      // Simulate the filter from processElectionEntry
      const availableNPPsRaw = allNPPs.filter((npp) => npp.party === firstParty);
      const availableInState = availableNPPsRaw.filter(
        (npp) =>
          npp.homeState === firstState ||
          statePrimaries.some((p) => p.electionType === "president" || p.electionType === "commons")
      );
      const notAssigned = availableInState; // No assignments yet in simulation
      const notInCandidacy = notAssigned.filter((npp) =>
        isNPPAvailable(npp, nppCandidacies, gameNow)
      );

      // Sort primaries by priority
      const sortedPrimaries = [...statePrimaries].sort((a, b) => {
        const aIdx = RACE_PRIORITY.indexOf(a.electionType as (typeof RACE_PRIORITY)[number]);
        const bIdx = RACE_PRIORITY.indexOf(b.electionType as (typeof RACE_PRIORITY)[number]);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });

      // Check first primary
      const firstPrimary = sortedPrimaries[0];
      const candidates = allCandidates.filter(
        (c) => c.electionId.toString() === firstPrimary?._id.toString()
      );
      const hasPartyCandidate = candidates.some(
        (c) => c.party === firstParty && c.status === "active"
      );

      // Find matching NPP
      const matchingNPP = notInCandidacy.find(
        (n) =>
          n.homeState === firstState ||
          firstPrimary?.electionType === "president" ||
          firstPrimary?.electionType === "commons"
      );

      // Check cooldown
      let cooldownBlocked = false;
      if (matchingNPP && firstPrimary) {
        const cooldownExpiry = matchingNPP.electionCooldowns?.[firstPrimary._id.toString()];
        if (cooldownExpiry && new Date(cooldownExpiry) > gameNow) {
          cooldownBlocked = true;
        }
      }

      entrySimulation = {
        party: firstParty,
        state: firstState,
        steps: {
          "1_totalNPPsForParty": availableNPPsRaw.length,
          "2_nppsInStateOrNational": availableInState.length,
          "3_nppsNotInCandidacy": notInCandidacy.length,
          "4_primariesInState": statePrimaries.length,
          "5_firstPrimaryType": firstPrimary?.electionType,
          "6_firstPrimaryId": firstPrimary?._id.toString(),
          "7_existingCandidatesInPrimary": candidates.length,
          "8_partyAlreadyHasCandidate": hasPartyCandidate,
          "9_matchingNPPFound": !!matchingNPP,
          "10_matchingNPPName": matchingNPP?.name ?? null,
          "11_matchingNPPHomeState": matchingNPP?.homeState ?? null,
          "12_cooldownBlocked": cooldownBlocked,
          "13_wouldEnter": !hasPartyCandidate && !!matchingNPP && !cooldownBlocked,
        },
        sampleNPPs: notInCandidacy.slice(0, 3).map((n) => ({
          id: n._id.toString(),
          name: n.name,
          party: n.party,
          homeState: n.homeState,
          retiredAt: n.retiredAt,
          hasCooldown: !!n.electionCooldowns?.[firstPrimary?._id.toString() ?? ""],
          cooldownValue: n.electionCooldowns?.[firstPrimary?._id.toString() ?? ""] ?? null,
          allCooldowns: n.electionCooldowns ?? {},
        })),
      };
    }

    return NextResponse.json({
      timestamps: {
        realNow: realNow.toISOString(),
        gameNow: gameNow.toISOString(),
        lastTurnProcessed: lastProcessed.toISOString(),
        currentTurn: gameState?.currentTurn,
        isActive: gameState?.isActive,
      },
      summary: {
        openPrimaries: openPrimaries.length,
        allActiveElections: allActiveElections.length,
        activeElectionsWithExpiredPrimary: allActiveElections.filter((e) =>
          typeof e.primaryEndTurn === "number"
            ? currentTurn >= e.primaryEndTurn
            : !e.primaryEndTime || new Date(e.primaryEndTime) <= gameNow
        ).length,
        totalNPPs: allNPPs.length,
        nppsAlreadyInCandidacies: nppCandidacies.size,
        electionStates: electionStates.slice(0, 20),
        nppHomeStates: [...nppHomeStates].slice(0, 20),
        matchingStates: matchingStates.length,
      },
      samplePrimaries: openPrimaries.slice(0, 5).map((e) => ({
        _id: e._id.toString(),
        electionType: e.electionType,
        state: e.state,
        primaryEndTime: e.primaryEndTime,
        endTime: e.endTime,
      })),
      sampleAnalysis,
      entrySimulation,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
