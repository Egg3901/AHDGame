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
import type { Character, CommitteeProposal, PoliticalParty } from "@/lib/db/types";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Db } from "mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

/**
 * Membership + relocation-residency checks for the ids the chair is
 * adding. Returns an error response when a candidate fails, or null when
 * every candidate is clean.
 *
 * The relocation gate mirrors the state-leadership rule (#949) so the
 * national chair can't re-grant, via a campaigner seat, the powers a
 * fresh relocation is meant to withhold (ticket #974). Admins skip it.
 */
async function validateCandidates(
  db: Db,
  party: PoliticalParty,
  countryId: CountryId,
  candidateIds: ObjectId[],
  currentTurn: number,
  options: { skipRelocationGate: boolean }
): Promise<NextResponse | null> {
  if (candidateIds.length === 0) return null;

  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: candidateIds } })
    .toArray();
  if (characters.length !== candidateIds.length) {
    return NextResponse.json(
      { error: "One or more campaigners are not valid characters" },
      { status: 400 }
    );
  }

  const partySeqStr = String(party.sequentialId);
  const nonMember = characters.find((c) => c.party !== partySeqStr || c.countryId !== countryId);
  if (nonMember) {
    return NextResponse.json(
      { error: `${nonMember.name} is not a current member of this party` },
      { status: 400 }
    );
  }

  if (options.skipRelocationGate) return null;

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

  return null;
}

async function logCampaignerChange(
  db: Db,
  party: PoliticalParty,
  authUser: AuthUserWithCharacter,
  isAdmin: boolean,
  detail: string
): Promise<void> {
  await db.collection("adminLogs").insertOne({
    category: "system",
    action: "national_campaigners_changed",
    username: authUser.username,
    characterName: authUser.character?.name,
    adminUsername: isAdmin ? authUser.username : undefined,
    details: `National campaigners for ${party.name}: ${detail}.`,
    createdAt: new Date(),
  });
}

const campaignersSchema = z.object({
  campaignerIds: z
    .array(z.string().min(1))
    .max(MAX_NATIONAL_CAMPAIGNERS, `At most ${MAX_NATIONAL_CAMPAIGNERS} campaigners`),
});

/**
 * POST /api/country/[code]/parties/[id]/campaigners — chair submits the
 * desired campaigner roster (up to MAX_NATIONAL_CAMPAIGNERS).
 *
 * Per suggestion #269, the seat is no longer purely chair-appointed:
 *
 *  - Names DROPPED from the roster are removed immediately. The chair
 *    fires at will, so a campaigner who goes rogue loses the seat on the
 *    spot.
 *  - Names ADDED become `campaignerAppointment` proposals before the
 *    National Committee. They take the seat only when the committee
 *    confirms. Nothing about the roster changes until then.
 *
 * Campaigners carry NPP Management on top of Build Org, which is why the
 * appointment is confirmed rather than granted. The National Committee
 * can also strip a seated campaigner via a `removeOfficeHolder` proposal
 * with role `campaigner`.
 *
 * Validation on additions:
 *  - Each id must resolve to a Character
 *  - Each character must currently be a member of this party
 *  - No duplicate ids, no double nomination, no over-cap once pending
 *    nominations are counted
 *
 * Vice-chair cannot reassign; only chair (or acting VC) / admin. Admins
 * still seat the roster directly, bypassing the committee.
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

    let requestedIds: ObjectId[];
    try {
      requestedIds = uniqueIds.map((id) => new ObjectId(id));
    } catch {
      return NextResponse.json({ error: "Malformed campaigner id" }, { status: 400 });
    }

    // Split the submitted roster against the seated one. Removals land
    // immediately (the chair can fire at will — suggestion #269); additions
    // become National Committee nominations and only seat on a passing vote.
    const seated = party.campaignerIds ?? [];
    const keptIds = seated.filter((id) => requestedIds.some((r) => r.equals(id)));
    const removedIds = seated.filter((id) => !requestedIds.some((r) => r.equals(id)));
    const addedIds = requestedIds.filter((id) => !seated.some((s) => s.equals(id)));

    const { currentTurn } = await getGameTime();
    const now = new Date();

    // Admins bypass the committee — they seat the roster directly, as before.
    if (isAdmin) {
      const validation = await validateCandidates(db, party, countryId, addedIds, currentTurn, {
        skipRelocationGate: true,
      });
      if (validation) return validation;
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { campaignerIds: requestedIds, updatedAt: now } });
      await logCampaignerChange(db, party, authUser, true, `set to ${requestedIds.length}`);
      return NextResponse.json({
        ok: true,
        message: "Campaigners updated",
        campaignerIds: requestedIds.map((id) => id.toString()),
        pendingNominations: [],
      });
    }

    if (addedIds.length > 0) {
      const validation = await validateCandidates(db, party, countryId, addedIds, currentTurn, {
        skipRelocationGate: false,
      });
      if (validation) return validation;
    }

    // Cap check counts seats that will remain, plus nominations already in
    // flight, plus the new ones — otherwise a chair could queue five
    // nominations against three slots and let the resolver pick winners.
    const openNominations = await db
      .collection<CommitteeProposal>("committeeProposals")
      .find({ partyId: party._id, status: "open", type: "campaignerAppointment" })
      .toArray();
    const openTargets = openNominations
      .map((p) => p.campaignerAppointment?.targetCharacterId)
      .filter((id): id is ObjectId => !!id);

    const alreadyNominated = addedIds.filter((id) => openTargets.some((t) => t.equals(id)));
    if (alreadyNominated.length > 0) {
      return NextResponse.json(
        { error: "A nomination for that member is already before the National Committee" },
        { status: 409 }
      );
    }

    const projected = keptIds.length + openTargets.length + addedIds.length;
    if (projected > MAX_NATIONAL_CAMPAIGNERS) {
      return NextResponse.json(
        {
          error: `That would put the party over ${MAX_NATIONAL_CAMPAIGNERS} campaigners once pending nominations are counted (${keptIds.length} seated, ${openTargets.length} awaiting confirmation).`,
        },
        { status: 400 }
      );
    }

    if (removedIds.length > 0) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { campaignerIds: keptIds, updatedAt: now } });
    }

    const createdNominations: string[] = [];
    for (const targetId of addedIds) {
      const doc: Omit<CommitteeProposal, "_id"> = {
        type: "campaignerAppointment",
        status: "open",
        partyId: party._id,
        countryId: party.countryId,
        proposedBy: authUser.character._id,
        createdAtTurn: currentTurn,
        expiresAtTurn: currentTurn + 24,
        createdAt: now,
        updatedAt: now,
        proposingVotes: [],
        campaignerAppointment: { targetCharacterId: targetId },
      };
      const inserted = await db
        .collection<CommitteeProposal>("committeeProposals")
        .insertOne(doc as CommitteeProposal);
      createdNominations.push(inserted.insertedId.toString());
    }

    await logCampaignerChange(
      db,
      party,
      authUser,
      false,
      `${removedIds.length} removed, ${addedIds.length} nominated for committee confirmation`
    );

    return NextResponse.json({
      ok: true,
      message:
        addedIds.length > 0
          ? `Nominated ${addedIds.length} campaigner${addedIds.length === 1 ? "" : "s"} — the National Committee must confirm before they take the seat.`
          : "Campaigners updated",
      campaignerIds: keptIds.map((id) => id.toString()),
      pendingNominations: createdNominations,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
