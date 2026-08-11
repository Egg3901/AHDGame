import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Campaign, Election, ElectionCandidate, Character } from "@/lib/db/types";
import { ObjectId } from "mongodb";

/**
 * GET /api/admin/heal/stale-campaigns
 *
 * Diagnose: finds Campaign documents that should have been deleted but weren't.
 * Three categories of stale campaigns:
 *   1. Election is completed/resolved/cancelled — campaigns should have been deleted at resolution
 *   2. Candidate is no longer active in the election (withdrawn/eliminated but campaign doc lingers)
 *   3. Character's countryId doesn't match the election's countryId (cross-country leakage)
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const allCampaigns = await db.collection<Campaign>("campaigns").find({}).toArray();

    if (allCampaigns.length === 0) {
      return NextResponse.json({ status: "ok", message: "No campaign documents found.", total: 0 });
    }

    // Gather all referenced election IDs
    const electionIds = [...new Set(allCampaigns.map((c) => c.electionId.toString()))];
    const elections = await db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));

    // Gather all active election candidates for the referenced elections
    const activeCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: { $in: electionIds.map((id) => new ObjectId(id)) },
        status: "active",
      })
      .toArray();
    // Key: `${electionId}:${characterId}`
    const activeCandidateKeys = new Set(
      activeCandidates
        .filter((c) => c.characterId)
        .map((c) => `${c.electionId.toString()}:${c.characterId!.toString()}`)
    );

    // Gather all referenced non-NPP candidate character IDs to check countryId
    const charIds = allCampaigns.filter((c) => !c.candidateIsNPP).map((c) => c.candidateId);
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .toArray();
    const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

    const staleByCompletedElection: string[] = [];
    const staleByInactiveCandidate: string[] = [];
    const staleByCrossCountry: string[] = [];

    for (const campaign of allCampaigns) {
      const elId = campaign.electionId.toString();
      const election = electionMap.get(elId);

      // Category 1: election is done
      if (!election || ["completed", "resolved", "cancelled"].includes(election.status)) {
        staleByCompletedElection.push(campaign._id.toString());
        continue;
      }

      // Category 2: candidate no longer active (only applies to player characters)
      if (!campaign.candidateIsNPP) {
        const key = `${elId}:${campaign.candidateId.toString()}`;
        if (!activeCandidateKeys.has(key)) {
          staleByInactiveCandidate.push(campaign._id.toString());
          continue;
        }
      }

      // Category 3: character's country doesn't match the election's country
      if (!campaign.candidateIsNPP && election.countryId) {
        const character = charMap.get(campaign.candidateId.toString());
        if (character && character.countryId !== election.countryId) {
          staleByCrossCountry.push(campaign._id.toString());
          continue;
        }
      }
    }

    const allStaleIds = [
      ...staleByCompletedElection,
      ...staleByInactiveCandidate,
      ...staleByCrossCountry,
    ];

    // Build per-campaign details for the diagnose report
    const staleCampaignDetails = allCampaigns
      .filter((c) => allStaleIds.includes(c._id.toString()))
      .map((c) => {
        const election = electionMap.get(c.electionId.toString());
        const character = !c.candidateIsNPP ? charMap.get(c.candidateId.toString()) : null;
        let reason: string;
        if (staleByCompletedElection.includes(c._id.toString())) {
          reason = election
            ? `election status is "${election.status}"`
            : "election not found (deleted)";
        } else if (staleByInactiveCandidate.includes(c._id.toString())) {
          reason = "candidate no longer active in election";
        } else {
          reason = `character countryId "${character?.countryId}" ≠ election countryId "${election?.countryId}"`;
        }
        return {
          campaignId: c._id.toString(),
          electionId: c.electionId.toString(),
          electionType: election?.electionType ?? "unknown",
          electionStatus: election?.status ?? "missing",
          candidateId: c.candidateId.toString(),
          candidateIsNPP: c.candidateIsNPP,
          candidateName: character?.name ?? "(NPP or unknown)",
          characterCountryId: character?.countryId ?? null,
          electionCountryId: election?.countryId ?? null,
          reason,
        };
      });

    const status =
      allStaleIds.length === 0
        ? "ok"
        : staleByCompletedElection.length > 0 || staleByCrossCountry.length > 0
          ? "needs_fix"
          : "needs_fix";

    return NextResponse.json({
      status,
      totalCampaigns: allCampaigns.length,
      staleCount: allStaleIds.length,
      breakdown: {
        completedElection: staleByCompletedElection.length,
        inactiveCandidate: staleByInactiveCandidate.length,
        crossCountry: staleByCrossCountry.length,
      },
      staleCampaigns: staleCampaignDetails,
      message:
        allStaleIds.length === 0
          ? "All campaign documents look healthy."
          : `Found ${allStaleIds.length} stale campaign document(s) that should be deleted.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/stale-campaigns
 *
 * Deletes all stale Campaign documents identified by the GET diagnose.
 * This fixes players who still see the campaign tab after leaving a race
 * or after the election has resolved.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const allCampaigns = await db.collection<Campaign>("campaigns").find({}).toArray();

    if (allCampaigns.length === 0) {
      return NextResponse.json({ healed: true, deleted: 0, message: "No campaigns to clean up." });
    }

    const electionIds = [...new Set(allCampaigns.map((c) => c.electionId.toString()))];
    const elections = await db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));

    const activeCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: { $in: electionIds.map((id) => new ObjectId(id)) },
        status: "active",
      })
      .toArray();
    const activeCandidateKeys = new Set(
      activeCandidates
        .filter((c) => c.characterId)
        .map((c) => `${c.electionId.toString()}:${c.characterId!.toString()}`)
    );

    const charIds = allCampaigns.filter((c) => !c.candidateIsNPP).map((c) => c.candidateId);
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .toArray();
    const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

    const staleIds: ObjectId[] = [];

    for (const campaign of allCampaigns) {
      const elId = campaign.electionId.toString();
      const election = electionMap.get(elId);

      if (!election || ["completed", "resolved", "cancelled"].includes(election.status)) {
        staleIds.push(campaign._id);
        continue;
      }

      if (!campaign.candidateIsNPP) {
        const key = `${elId}:${campaign.candidateId.toString()}`;
        if (!activeCandidateKeys.has(key)) {
          staleIds.push(campaign._id);
          continue;
        }
      }

      if (!campaign.candidateIsNPP && election.countryId) {
        const character = charMap.get(campaign.candidateId.toString());
        if (character && character.countryId !== election.countryId) {
          staleIds.push(campaign._id);
          continue;
        }
      }
    }

    if (staleIds.length === 0) {
      return NextResponse.json({
        healed: true,
        deleted: 0,
        message: "No stale campaign documents found — nothing to clean up.",
      });
    }

    const result = await db.collection("campaigns").deleteMany({ _id: { $in: staleIds } });

    await db.collection("adminLogs").insertOne({
      action: "heal_stale_campaigns",
      adminUsername: auth.admin.username,
      details: {
        deleted: result.deletedCount,
        campaignIds: staleIds.map((id) => id.toString()),
      },
      timestamp: new Date(),
    });

    return NextResponse.json({
      healed: true,
      deleted: result.deletedCount,
      message: `Deleted ${result.deletedCount} stale campaign document(s). Affected players will no longer see the campaign tab.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
