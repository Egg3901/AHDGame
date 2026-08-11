import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { MAX_NATIONAL_CAMPAIGNERS } from "@/lib/parties/access";
import { canActAsChair } from "@/lib/parties/actingChair";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const campaignersSchema = z.object({
  campaignerIds: z
    .array(z.string().min(1))
    .max(MAX_NATIONAL_CAMPAIGNERS, `At most ${MAX_NATIONAL_CAMPAIGNERS} campaigners`),
});

/**
 * POST /api/country/[code]/parties/[id]/campaigners — chair-only set the
 * national party's campaigner roster (up to MAX_NATIONAL_CAMPAIGNERS).
 *
 * Validation:
 *  - Each id must resolve to a Character
 *  - Each character must currently be a member of this party
 *    (`character.party === party.sequentialId AND countryId matches`)
 *  - No duplicate ids
 *
 * Vice-chair cannot reassign; only chair / admin.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, campaignersSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    // Chair authority — VC excluded while chair is seated, but acts as
    // chair when the chair slot is vacant (per the 2026-05-22 redesign).
    const isAdmin = authUser.isAdmin;
    if (!isAdmin && !canActAsChair(party, authUser.character._id)) {
      return NextResponse.json(
        {
          error:
            "Only the party chair (or acting vice-chair when the chair seat is vacant) or an admin can assign campaigners",
        },
        { status: 403 }
      );
    }

    // Deduplicate input ids.
    const uniqueIds = Array.from(new Set(parsed.data.campaignerIds));
    if (uniqueIds.length !== parsed.data.campaignerIds.length) {
      return NextResponse.json({ error: "Duplicate campaigner ids" }, { status: 400 });
    }

    if (uniqueIds.length > 0) {
      // Validate each id is a Character of this party.
      let candidateObjectIds: ObjectId[];
      try {
        candidateObjectIds = uniqueIds.map((id) => new ObjectId(id));
      } catch {
        return NextResponse.json({ error: "Malformed campaigner id" }, { status: 400 });
      }

      const characters = await db
        .collection<Character>("characters")
        .find({ _id: { $in: candidateObjectIds } })
        .toArray();
      if (characters.length !== candidateObjectIds.length) {
        return NextResponse.json(
          { error: "One or more campaigners are not valid characters" },
          { status: 400 }
        );
      }

      const partySeqStr = String(party.sequentialId);
      const nonMember = characters.find(
        (c) => c.party !== partySeqStr || c.countryId !== countryId
      );
      if (nonMember) {
        return NextResponse.json(
          {
            error: `${nonMember.name} is not a current member of this party`,
          },
          { status: 400 }
        );
      }

      // Relocation-residency gate, mirroring the state-leadership rule (#949)
      // and the state-campaigner gate. National campaigners act on state
      // campaign sites, so without this the national chair could re-grant the
      // powers a fresh relocation is supposed to withhold (ticket #974).
      if (!isAdmin) {
        const { currentTurn } = await getGameTime();
        const blocked = characters
          .map((c) => ({
            character: c,
            tenure: getPartyTenure(
              c.lastRelocatedTurn,
              currentTurn,
              STATE_LEADERSHIP_RELOCATION_DELAY_TURNS
            ),
          }))
          .find((entry) => !entry.tenure.eligible);
        if (blocked) {
          return NextResponse.json(
            {
              error: `${blocked.character.name} relocated recently and can't be made a campaigner for ${blocked.tenure.turnsRemaining} more turn${blocked.tenure.turnsRemaining === 1 ? "" : "s"}.`,
              turnsRemaining: blocked.tenure.turnsRemaining,
            },
            { status: 403 }
          );
        }
      }
    }

    const now = new Date();
    const updateIds = uniqueIds.map((id) => new ObjectId(id));
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id }, { $set: { campaignerIds: updateIds, updatedAt: now } });

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "national_campaigners_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `National campaigners for ${party.name} set to ${uniqueIds.length} character(s).`,
      createdAt: now,
    });

    return NextResponse.json({
      ok: true,
      message: "Campaigners updated",
      campaignerIds: uniqueIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
