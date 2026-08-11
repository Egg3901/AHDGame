import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId, getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, State, StatePartyOrg } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

const stateCampaignerSchema = z.object({
  // null / empty string clears the slot.
  campaignerId: z.string().min(1).nullable(),
});

/**
 * POST /api/country/[code]/region/[id]/party/[partyId]/campaigners —
 * chair-only set the state-party's campaigner (single slot, or null to
 * clear).
 *
 * Picker filter (enforced server-side): the character must be a member
 * of this party AND have `homeState === stateId` — campaigners must be
 * in-state per the chair's spec.
 *
 * Vice-chair cannot reassign; chair (state OR national) / admin only.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, stateCampaignerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });
    if (!stateParty) {
      return NextResponse.json({ error: "Party has no presence in this state" }, { status: 404 });
    }

    // Chair-only auth: state chair OR national chair OR admin.
    const isAdmin = authUser.isAdmin;
    const isStateChair = stateParty.chairId?.equals(authUser.character._id);
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    if (!isAdmin && !isStateChair && !isNationalChair) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, national chair, or an admin can assign the state campaigner",
        },
        { status: 403 }
      );
    }

    let campaignerObjectId: ObjectId | null = null;
    if (parsed.data.campaignerId) {
      try {
        campaignerObjectId = new ObjectId(parsed.data.campaignerId);
      } catch {
        return NextResponse.json({ error: "Malformed campaigner id" }, { status: 400 });
      }

      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: campaignerObjectId });
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 400 });
      }
      if (character.party !== String(party.sequentialId) || character.countryId !== countryId) {
        return NextResponse.json(
          { error: `${character.name} is not a current member of this party` },
          { status: 400 }
        );
      }
      if (character.homeState !== stateId) {
        return NextResponse.json(
          {
            error: `${character.name} is not based in ${state.name} — state campaigners must be in-state`,
          },
          { status: 400 }
        );
      }

      // Relocation-residency gate, mirroring the state-leadership appointment
      // rule (#949). Without it the leadership fix was trivially bypassed:
      // move a character into a fresh state and appoint them state campaigner
      // the same turn, which grants the same state-level campaign powers
      // (ticket #974). Admins keep the Admin Panel escape hatch.
      if (!isAdmin) {
        const { currentTurn } = await getGameTime();
        const relocTenure = getPartyTenure(
          character.lastRelocatedTurn,
          currentTurn,
          STATE_LEADERSHIP_RELOCATION_DELAY_TURNS
        );
        if (!relocTenure.eligible) {
          return NextResponse.json(
            {
              error: `${character.name} relocated recently and can't be made state campaigner for ${relocTenure.turnsRemaining} more turn${relocTenure.turnsRemaining === 1 ? "" : "s"}.`,
              turnsRemaining: relocTenure.turnsRemaining,
            },
            { status: 403 }
          );
        }
      }
    }

    const now = new Date();
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: statePartyKey },
        { $set: { campaignerId: campaignerObjectId, updatedAt: now } }
      );

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "state_campaigner_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: campaignerObjectId
        ? `State campaigner for ${state.name} ${party.name} set.`
        : `State campaigner for ${state.name} ${party.name} cleared.`,
      createdAt: now,
    });

    return NextResponse.json({
      ok: true,
      message: campaignerObjectId ? "Campaigner assigned" : "Campaigner cleared",
      campaignerId: campaignerObjectId?.toString() ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
