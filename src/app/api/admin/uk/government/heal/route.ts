import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import {
  getGovernmentFormationsCollection,
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { Character, ElectedOfficial } from "@/lib/db/types";

const healActionSchema = z.object({
  action: z.enum(["retrigger_formation", "appoint_pm"]),
  characterId: z.string().optional(),
});

/**
 * GET /api/admin/uk/government/heal
 * Returns a diagnostic snapshot of the UK government state.
 */
export async function GET(_request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: "UK" });

    // Resolve active votes from the new system
    const [activeAppointmentVotes, activeNoConfidenceVote] = await Promise.all([
      getPMAppointmentVotesCollection(db).find({ countryId: "UK", status: "active" }).toArray(),
      getNoConfidenceVotesCollection(db).findOne({ countryId: "UK", status: "active" }),
    ]);

    // Tally seats
    const lowerChamberKey = COUNTRY_CONFIGS.UK.legislature.lowerChamber.key;
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: lowerChamberKey, countryId: "UK" })
      .toArray();
    const seatsByParty: Record<string, number> = {};
    for (const o of officials) {
      if (!o.party) continue;
      seatsByParty[o.party] = (seatsByParty[o.party] ?? 0) + (o.seatsHeld ?? 1);
    }

    // Current PM
    let currentPM: { name: string; party: string; type: "character" | "npp" } | null = null;
    if (govFormation?.pmCharacterId) {
      const pmChar = await db
        .collection<Character>("characters")
        .findOne({ _id: govFormation.pmCharacterId }, { projection: { name: 1, party: 1 } });
      if (pmChar) currentPM = { name: pmChar.name, party: pmChar.party ?? "", type: "character" };
    }

    // Candidates for appoint_pm (Commons player-character MPs)
    const candidates = (
      await Promise.all(
        officials
          .filter((o) => o.characterId)
          .map(async (o) => {
            const c = await db
              .collection<Character>("characters")
              .findOne(
                { _id: o.characterId!, userId: { $exists: true } },
                { projection: { name: 1, party: 1 } }
              );
            return c ? { id: c._id.toString(), name: c.name, party: c.party ?? "" } : null;
          })
      )
    ).filter((c): c is { id: string; name: string; party: string } => c !== null);

    return NextResponse.json({
      govFormation: govFormation
        ? {
            status: govFormation.status,
            formationType: govFormation.formationType,
            pmName: govFormation.pmName ?? null,
            pmCharacterId: govFormation.pmCharacterId?.toString() ?? null,
            governingPartyId: govFormation.governingPartyId,
            totalSeatsSupporting: govFormation.totalSeatsSupporting,
            majorityThreshold: govFormation.majorityThreshold,
            activeVoteId: govFormation.activeVoteId?.toString() ?? null,
            cycle: govFormation.cycle,
          }
        : null,
      activeAppointmentVotes: activeAppointmentVotes.map((v) => ({
        _id: v._id.toString(),
        nomineeName: v.nomineeName,
        formationType: v.formationType,
        votesFor: v.votesFor,
        votesAgainst: v.votesAgainst,
        status: v.status,
        closesAt: v.closesAt.toISOString(),
      })),
      activeNoConfidenceVote: activeNoConfidenceVote
        ? {
            _id: activeNoConfidenceVote._id.toString(),
            targetPmName: activeNoConfidenceVote.targetPmName,
            votesFor: activeNoConfidenceVote.votesFor,
            votesAgainst: activeNoConfidenceVote.votesAgainst,
            status: activeNoConfidenceVote.status,
            closesAt: activeNoConfidenceVote.closesAt.toISOString(),
          }
        : null,
      seatsByParty,
      totalSeats: Object.values(seatsByParty).reduce((s, n) => s + n, 0),
      currentPM,
      candidates,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/uk/government/heal
 * Body: { action: "retrigger_formation" | "appoint_pm", characterId?: string }
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, healActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { action, characterId } = parsed.data;
    const now = new Date();

    if (action === "retrigger_formation") {
      const { updateGovernmentSeats } = await import("@/lib/turn/ukGovernmentFormation");
      await updateGovernmentSeats();
      return NextResponse.json({ success: true, action: "retrigger_formation" });
    }

    if (action === "appoint_pm") {
      if (!characterId || !ObjectId.isValid(characterId)) {
        return NextResponse.json(
          { error: "characterId is required and must be a valid ObjectId." },
          { status: 400 }
        );
      }
      const db = await getDb();
      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: new ObjectId(characterId) });
      if (!character) {
        return NextResponse.json({ error: "Character not found." }, { status: 404 });
      }

      const { appointUKPrimeMinister } = await import("@/lib/turn/ukGovernment");
      await appointUKPrimeMinister(character._id, null, character.name, now);

      // Also update governmentFormations to reflect the appointment
      await getGovernmentFormationsCollection(db).updateOne(
        { _id: "UK" },
        {
          $set: {
            status: "formed",
            pmCharacterId: character._id,
            pmName: character.name,
            activeVoteId: null,
            formedAt: now,
            updatedAt: now,
          },
        }
      );

      return NextResponse.json({
        success: true,
        action: "appoint_pm",
        appointedName: character.name,
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
