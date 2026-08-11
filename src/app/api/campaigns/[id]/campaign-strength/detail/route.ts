import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import {
  calculateCampaignStrengthLeaderPullbacks,
  CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN,
} from "@/lib/campaigns/campaignStrength";
import type { GameState } from "@/lib/db/types/gameState";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/campaigns/[id]/campaign-strength/detail — Contributors, decay, and change data for the CS tooltip on the Pres screen.
// Auth: requireBasicAuth
// Errors: 400, 401, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id: campaignId } = await params;
    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const db = await getDb();
    const oid = new ObjectId(campaignId);
    const campaign = await db.collection("campaigns").findOne({ _id: oid });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const currentCS = campaign.campaignStrength ?? 0;
    const electionId = campaign.electionId?.toString();

    // Compute current pullback for this campaign if we have an election context
    let pullbackPerTurn = 0;
    if (electionId) {
      const electionCampaigns = await db
        .collection("campaigns")
        .find({ electionId: campaign.electionId, status: { $ne: "archived" } })
        .project({ _id: 1, campaignStrength: 1, status: 1, electionId: 1 })
        .toArray();
      const pullbacks = calculateCampaignStrengthLeaderPullbacks(
        electionCampaigns.map((c) => ({
          id: c._id.toString(),
          electionId: c.electionId.toString(),
          campaignStrength: c.campaignStrength,
          status: c.status,
        }))
      );
      pullbackPerTurn = pullbacks.get(campaignId) ?? 0;
    }

    // Aggregate contributions from activityLog
    const contributions = await db
      .collection("activityLog")
      .aggregate<{
        _id: { characterId?: string; characterName?: string };
        totalAdded: number;
        totalCost: number;
        count: number;
        firstTurn: number;
        lastTurn: number;
      }>([
        { $match: { actionType: "campaign_strength", "details.campaignId": campaignId } },
        {
          $group: {
            _id: { characterId: "$characterId", characterName: "$characterName" },
            totalAdded: { $sum: { $ifNull: ["$details.strengthAdded", 0] } },
            totalCost: { $sum: { $ifNull: ["$details.costFunds", 0] } },
            count: { $sum: 1 },
            firstTurn: { $min: "$turn" },
            lastTurn: { $max: "$turn" },
          },
        },
        { $sort: { totalAdded: -1 } },
        { $limit: 5 },
      ])
      .toArray();

    // Enrich with party info and latest turn data
    const characterIds = contributions
      .map((c) => c._id.characterId)
      .filter((id): id is string => Boolean(id));
    const charDocs =
      characterIds.length > 0
        ? await db
            .collection("characters")
            .find({ _id: { $in: characterIds.map((id: string) => new ObjectId(id)) } })
            .project({ _id: 1, name: 1, party: 1 })
            .toArray()
        : [];
    const charPartyMap = new Map(charDocs.map((c) => [c._id.toString(), c.party ?? ""]));

    // Resolve party names/colors
    const allPartyIds = [...new Set([...charPartyMap.values()].filter(Boolean))];
    const parties =
      allPartyIds.length > 0
        ? await db
            .collection("politicalParties")
            .find({
              countryId: "US",
              sequentialId: { $in: allPartyIds.map((id: string) => Number(id)) },
            })
            .project<{
              sequentialId: number;
              name: string;
              abbreviation: string;
              color: string;
            }>({ sequentialId: 1, name: 1, abbreviation: 1, color: 1 })
            .toArray()
        : [];
    const partyInfoMap = new Map(
      parties.map(
        (p: { sequentialId: number; name: string; abbreviation: string; color: string }) => [
          String(p.sequentialId),
          { name: p.name, abbr: p.abbreviation, color: p.color },
        ]
      )
    );

    const topContributors = contributions.map(
      (c: {
        _id: { characterId?: string; characterName?: string };
        totalAdded: number;
        totalCost: number;
        count: number;
        firstTurn: number;
        lastTurn: number;
      }) => {
        const charId = c._id.characterId?.toString() ?? "";
        const partyId = charPartyMap.get(charId) ?? "";
        const partyInfo = partyInfoMap.get(partyId);
        return {
          characterName: c._id.characterName ?? "Unknown",
          characterId: charId,
          totalAdded: Math.round(c.totalAdded * 100) / 100,
          totalCost: Math.round(c.totalCost * 100) / 100,
          contributionCount: c.count,
          firstTurn: c.firstTurn,
          lastTurn: c.lastTurn,
          party: {
            id: partyId,
            name: partyInfo?.name ?? partyId,
            abbr: partyInfo?.abbr ?? partyId,
            color: partyInfo?.color ?? "#888",
          },
        };
      }
    );

    // Compute change vs last turn from activityLog
    const gameStateDoc =
      (await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" as GameState["_id"] })) ??
      (await db.collection<GameState>("gameState").findOne({ _id: "main" as GameState["_id"] }));
    const currentTurn = (gameStateDoc?.currentTurn as number) ?? 0;

    // Sum contributions this turn
    const thisTurnContribAgg = await db
      .collection("activityLog")
      .aggregate([
        {
          $match: {
            actionType: "campaign_strength",
            "details.campaignId": campaignId,
            turn: currentTurn,
          },
        },
        { $group: { _id: null, totalAdded: { $sum: { $ifNull: ["$details.strengthAdded", 0] } } } },
      ])
      .toArray();
    const contributionsThisTurn = thisTurnContribAgg[0]?.totalAdded ?? 0;
    const changeThisTurn = contributionsThisTurn - pullbackPerTurn;

    return NextResponse.json({
      currentCS,
      pullbackPerTurn: Math.round(pullbackPerTurn * 100) / 100,
      pullbackMaxPerTurn: CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN,
      contributionsThisTurn: Math.round(contributionsThisTurn * 100) / 100,
      changeThisTurn: Math.round(changeThisTurn * 100) / 100,
      topContributors,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
