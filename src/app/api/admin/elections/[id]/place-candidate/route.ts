/**
 * POST /api/admin/elections/[id]/place-candidate
 * Admin: add a character or NPP as a candidate in a presidential election.
 * Body: { characterId?: string, nppId?: string, party: string }
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  ElectionVoteTally,
  Campaign,
} from "@/lib/db/types";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";

const placeCandidateSchema = z
  .object({
    characterId: z.string().optional(),
    nppId: z.string().optional(),
    party: z.string().min(1),
  })
  .refine((d) => d.characterId || d.nppId, {
    message: "Either characterId or nppId is required",
  });

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/elections/[id]/place-candidate — Places a character or NPP as a candidate in a presidential election, transferring votes from withdrawn same-party candidates.
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

    const parsed = await parseJsonBody(request, placeCandidateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, nppId, party } = parsed.data;

    const db = await getDb();
    const now = new Date();

    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Place candidate is only for presidential elections" },
        { status: 400 }
      );
    }

    if (election.status !== "upcoming" && election.status !== "active") {
      return NextResponse.json({ error: "Election is not open for entry" }, { status: 400 });
    }

    let characterName: string;
    let charId: ObjectId | undefined;
    let nppIdObj: ObjectId | undefined;
    let isNPP = false;

    if (characterId) {
      const charIdObj = new ObjectId(characterId);
      const char = await db.collection<Character>("characters").findOne({ _id: charIdObj });
      if (!char) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      characterName = char.name;
      charId = charIdObj;
    } else if (nppId) {
      const nppIdObjParsed = new ObjectId(nppId);
      const npp = await db.collection<NPP>("npps").findOne({ _id: nppIdObjParsed });
      if (!npp) {
        return NextResponse.json({ error: "NPP not found" }, { status: 404 });
      }
      characterName = npp.name;
      nppIdObj = nppIdObjParsed;
      isNPP = true;
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const existing = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: electionObjectId,
      status: "active",
      ...(charId ? { characterId: charId } : { nppId: nppIdObj }),
    });

    if (existing) {
      return NextResponse.json(
        { error: `${characterName} is already in this race` },
        { status: 400 }
      );
    }

    const partyAlreadyHasCandidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({
        electionId: electionObjectId,
        status: "active",
        party,
      });

    if (partyAlreadyHasCandidate) {
      return NextResponse.json(
        {
          error: `The ${party} party already has a candidate in this race. Remove the existing candidate first to replace them.`,
        },
        { status: 400 }
      );
    }

    const candidateDoc: ElectionCandidate = {
      _id: new ObjectId(),
      electionId: electionObjectId,
      countryId: (election.countryId ?? "US") as ElectionCandidate["countryId"],
      characterId: charId ?? nppIdObj!,
      characterName,
      party,
      status: "active",
      support: DEFAULT_CANDIDATE_SUPPORT,
      enteredAt: now,
      isNPP: isNPP || undefined,
      nppId: nppIdObj,
    };

    await db.collection<ElectionCandidate>("electionCandidates").insertOne(candidateDoc);

    const candidateId = candidateDoc._id.toString();

    // Create a campaign document so the candidate has an active campaign panel.
    // Mirrors start-general behavior. Gated on eligibility so future non-direct-
    // election "president" races do not spawn a Campaign Manager pool.
    if (isCampaignEligibleElection(election)) {
      const fogOfWar = {
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        lastUpdated: now,
      };
      const campaignDoc: Campaign = {
        _id: new ObjectId(),
        electionId: electionObjectId,
        candidateId: charId ?? nppIdObj!,
        candidateIsNPP: isNPP,
        party,
        managerId: null,
        managerCharacterId: null,
        funds: 0,
        actions: 0,
        fundraisingLevel: 0,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        // Strategic Operations v2 — start with un-unlocked branch trees.
        fundraisingTree: { starter: false, a: 0, b: 0, c: 0 },
        oppositionResearchTree: { starter: false, a: 0, b: 0, c: 0 },
        groundGameTree: { starter: false, a: 0, b: 0, c: 0 },
        mediaSpendingTree: { starter: false, a: 0, b: 0, c: 0 },
        oppositionTargetId: null,
        oppositionTargetName: null,
        oppositionResearchCooldownUntil: null,
        oppositionResearchCooldownUntilTurn: null,
        donationLog: [],
        publicFogOfWar: fogOfWar,
        partyFogOfWar: fogOfWar,
        activityHistory: [],
        totalFundsGenerated: 0,
        totalFundsSpent: 0,
        totalActionsGenerated: 0,
        totalActionsSpent: 0,
        campaignStrength: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection<Campaign>("campaigns").insertOne(campaignDoc);
    }

    // Find any withdrawn candidates from the same party to transfer votes from
    const withdrawnSameParty = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: electionObjectId,
        party,
        status: "withdrawn",
      })
      .toArray();

    // Get current vote tally
    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: electionObjectId });

    if (tally && withdrawnSameParty.length > 0) {
      // Transfer votes from withdrawn candidates to new candidate
      let transferredVotes = 0;
      const unsetFields: Record<string, "" | 1 | true> = {};
      const unsetTotalVotesByUnit: Record<string, "" | 1 | true> = {};

      for (const withdrawn of withdrawnSameParty) {
        const withdrawnId = withdrawn._id.toString();
        const votes = tally.totalVotes?.[withdrawnId] || 0;
        transferredVotes += votes;

        // Mark fields for removal
        unsetFields[`candidateNames.${withdrawnId}`] = "";
        unsetFields[`candidateParties.${withdrawnId}`] = "";
        unsetFields[`totalVotes.${withdrawnId}`] = "";

        // Transfer unit votes for presidential elections
        if (election.electionType === "president" && tally.totalVotesByUnit) {
          for (const unitId in tally.totalVotesByUnit) {
            const unitVotes = tally.totalVotesByUnit[unitId][withdrawnId] || 0;
            if (unitVotes > 0) {
              await db
                .collection<ElectionVoteTally>("electionVoteTallies")
                .updateOne(
                  { electionId: electionObjectId },
                  { $inc: { [`totalVotesByUnit.${unitId}.${candidateId}`]: unitVotes } }
                );
            }
            unsetTotalVotesByUnit[`totalVotesByUnit.${unitId}.${withdrawnId}`] = "";
          }
        }
      }

      // Update tally with new candidate and transferred votes
      await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
        { electionId: electionObjectId },
        {
          $set: {
            [`candidateNames.${candidateId}`]: characterName,
            [`candidateParties.${candidateId}`]: party,
            [`totalVotes.${candidateId}`]: transferredVotes,
          },
          $unset: { ...unsetFields, ...unsetTotalVotesByUnit },
        }
      );
    } else {
      // No votes to transfer, just add new candidate
      await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
        { electionId: electionObjectId },
        {
          $set: {
            [`candidateNames.${candidateId}`]: characterName,
            [`candidateParties.${candidateId}`]: party,
            [`totalVotes.${candidateId}`]: 0,
          },
        }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${characterName} has been placed in the presidential race.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
