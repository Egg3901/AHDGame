/**
 * POST /api/admin/elections/[id]/start-general
 * Admin: End primary and start general phase for a presidential election.
 * Sets primaryEndTime to now, resolves primaries (eliminates losers), initializes vote tally.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { fetchEnrichedCandidates } from "@/lib/electionEngine";
import {
  calcPresidentPrimaryScore,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
} from "@/lib/primaryScore";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";
import type {
  Character,
  Election,
  ElectionCandidate,
  NPP,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import { createInitialCampaign } from "@/lib/campaigns/createInitialCampaign";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/elections/[id]/start-general — Ends the primary phase, eliminates primary losers, initializes the vote tally, and creates campaign documents for general candidates.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: electionId } = await params;
    let electionObjectId: ObjectId;
    try {
      electionObjectId = new ObjectId(electionId);
    } catch {
      return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();
    // Game turn drives the turn-first primary-close mutation below.
    const { currentTurn } = await getGameTime();

    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Start general is only for presidential elections" },
        { status: 400 }
      );
    }

    if (election.status === "completed" || election.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot start general for completed or cancelled election" },
        { status: 400 }
      );
    }

    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: electionObjectId, status: "active" })
      .toArray();

    // Filter parties by election's countryId to avoid cross-country collisions
    const electionCountryId = election.countryId ?? "US";
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: electionCountryId })
      .toArray();
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    let eliminated = 0;

    if (candidates.length > 0) {
      const enriched = await fetchEnrichedCandidates(candidates);

      // Presidential primary scoring needs candidate home-state party-org and
      // national influence. Load chars/NPPs/statePartyOrgs to mirror the
      // canonical calcPresidentPrimaryScore inputs used by primaryResolution.ts.
      const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
      const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
      const [chars, electionNpps, statePartyOrgs] = await Promise.all([
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
      const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
      // Dead leftover: presidential NPP scoring reads from `enriched`, not this map. Cleanup tracked.
      const _nppMap = new Map(electionNpps.map((n) => [n._id.toString(), n]));
      const partyOrgByStateParty = new Map<string, number>();
      for (const po of statePartyOrgs) {
        partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
      }
      const partyChairMaps = buildPartyChairMaps(parties, statePartyOrgs);

      const partyCounts = new Map<string, number>();
      for (const c of candidates) {
        partyCounts.set(c.party, (partyCounts.get(c.party) ?? 0) + 1);
      }

      const loserIds: string[] = [];
      for (const [partyId, count] of partyCounts) {
        if (count <= 1) continue;

        const party = partyMap.get(partyId);
        const partyEP = party?.economicPosition ?? 0;
        const partySP = party?.socialPosition ?? 0;

        const scored = candidates
          .filter((c) => c.party === partyId)
          .map((c) => {
            const ec = enriched.find((e) => e.candidateId === c._id.toString());
            if (!ec) return { candidateId: c._id.toString(), score: 0 };
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
              : (charMap.get(c.characterId.toString())?.nationalInfluence ?? ec.politicalInfluence);
            const score = calcPresidentPrimaryScore(
              ec.charEP,
              ec.charSP,
              partyEP,
              partySP,
              ec.favorability,
              nationalOrPol,
              partyInfluence,
              ec.infamy
            );
            return { candidateId: c._id.toString(), score };
          })
          .sort((a, b) => b.score - a.score);

        for (const s of scored.slice(1)) loserIds.push(s.candidateId);
      }

      if (loserIds.length > 0) {
        await db
          .collection("electionCandidates")
          .updateMany(
            { _id: { $in: loserIds.map((id) => new ObjectId(id)) } },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
        eliminated = loserIds.length;

        // Archive (not delete) campaign documents for eliminated primary
        // candidates. They're hidden from active surfaces but retained until the
        // general resolves, so a re-entry can reactivate them. Mirrors primaryResolution.
        const loserCharIds = candidates
          .filter((c) => loserIds.includes(c._id.toString()) && c.characterId && !c.isNPP)
          .map((c) => c.characterId!);
        if (loserCharIds.length > 0) {
          await db.collection("campaigns").updateMany(
            {
              electionId: electionObjectId,
              candidateId: { $in: loserCharIds },
              status: { $ne: "archived" },
            },
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

    const generalCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: electionObjectId, status: "active" })
      .toArray();

    const existingTally = await db
      .collection("electionVoteTallies")
      .findOne({ electionId: electionObjectId });

    if (!existingTally && generalCandidates.length > 0) {
      await initPresidentVoteTally(electionObjectId, generalCandidates);
    }

    await db.collection<Election>("elections").updateOne(
      { _id: electionObjectId },
      {
        // primaryEndTurn = currentTurn so the turn-first resolver treats the
        // primary as closed now (primaryEndTime kept for display/fallback).
        $set: {
          primaryEndTime: now,
          primaryEndTurn: currentTurn,
          status: "active",
          updatedAt: now,
        },
      }
    );

    // Ensure every general-phase candidate has a campaign doc. Normally this
    // was already created at entry, but races entered before that change (or
    // via legacy paths) may be missing one. createInitialCampaign is idempotent.
    // Gate on eligibility so future non-direct-election "president" races
    // (e.g. parliament-appointed) do not spawn a Campaign Manager pool.
    if (isCampaignEligibleElection(election)) {
      for (const candidate of generalCandidates) {
        await createInitialCampaign({
          db,
          electionId: electionObjectId,
          candidateId: candidate.characterId,
          candidateIsNPP: candidate.isNPP ?? false,
          party: candidate.party,
          now,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message:
        `General phase started. ${eliminated > 0 ? `${eliminated} primary loser(s) eliminated.` : ""}`.trim(),
      eliminated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
