// GET /api/pip/standard — Returns decay projections, income summary, and recent notifications for the Standard PiP view.
// Auth: requireAuth
// Errors: 401, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { calculateFullFundDistribution } from "@/lib/utils/fundGeneration";
import {
  projectInfluenceDecay,
  projectFavorabilityDecay,
  projectInfamyDecay,
} from "@/lib/utils/decayProjections";
import type { Character, Notification, PoliticalParty, State, StatePartyOrg } from "@/lib/db/types";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(auth.user.userId) });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const userId = new ObjectId(auth.user.userId);

    const [homeState, party, statePartyOrg, recentNotifications, unreadCount, unreadMailCount] =
      await Promise.all([
        character.homeState
          ? db
              .collection<State>("states")
              .findOne({ _id: character.homeState, countryId: character.countryId })
          : null,
        character.party && Number.isFinite(Number(character.party))
          ? db.collection<PoliticalParty>("politicalParties").findOne({
              sequentialId: Number(character.party),
              countryId: character.countryId,
            })
          : null,
        character.party
          ? db.collection<StatePartyOrg>("statePartyOrg").findOne({
              stateId: character.homeState,
              partyId: character.party,
            })
          : null,
        db
          .collection<Notification>("notifications")
          .find({ userId, read: false })
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray(),
        db.collection<Notification>("notifications").countDocuments({ userId, read: false }),
        db
          .collection("playerMail")
          .countDocuments({ toUserId: userId, read: false, deletedByRecipient: false }),
      ]);

    const pi = character.politicalInfluence ?? 0;
    const fav = character.favorability ?? 50;
    const infamy = character.infamy ?? 0;

    const fundDistribution = calculateFullFundDistribution(
      homeState?.population ?? 1_000_000,
      character.donorBaseLevel ?? 0,
      character.currentOffice,
      statePartyOrg?.stateTaxRate ?? 0,
      party?.nationalTaxRate ?? 0,
      homeState?.gdp,
      character.countryId
    );

    return NextResponse.json(
      {
        decay: {
          pi: projectInfluenceDecay(pi),
          fav: projectFavorabilityDecay(fav),
          infamy: projectInfamyDecay(infamy),
        },
        income: {
          netPerTurn: fundDistribution.characterReceives,
          base: fundDistribution.baseGeneration,
          donorBonus: fundDistribution.donorBaseBonus,
          officeBonus: fundDistribution.officeBonus,
          stateTax: fundDistribution.stateTaxAmount,
          nationalTax: fundDistribution.nationalTaxAmount,
        },
        notifications: {
          unreadCount,
          unreadMailCount,
          recent: recentNotifications.map((n) => ({
            id: n._id.toString(),
            message: n.message,
            type: n.type,
            createdAt:
              n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
          })),
        },
      },
      { headers: { "Cache-Control": "private, max-age=30, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
