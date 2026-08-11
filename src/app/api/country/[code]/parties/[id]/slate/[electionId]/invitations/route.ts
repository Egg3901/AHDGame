import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { ensureSlate } from "@/lib/db/recruitmentSlateLookup";
import { createNotification } from "@/lib/notifications";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { computeSlateAssignmentScore, isNppSlateCompliant } from "@/lib/slateAssignments";
import type { Character, Election, NPP, SlateCandidate } from "@/lib/db/types";
import { getSlateAcceptanceStatBonus, resolveSlateAuthority } from "@/lib/slateAuthority";
import { getPartyNppControlStatus } from "@/lib/parties/antiAbuseGuards";
import { findBlockingActiveCandidacy } from "@/lib/elections/activeCandidacy";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isPrimaryClosed } from "@/lib/elections/electionDeadlineFilters";

interface RouteParams {
  params: Promise<{ code: string; id: string; electionId: string }>;
}

type BuiltSlateCandidate =
  | {
      candidateType: "npp" | "character";
      row: SlateCandidate;
      userId: ObjectId | null;
    }
  | {
      error: string;
      status: number;
    };

const assignSchema = z.object({
  candidateType: z.enum(["npp", "character"]),
  candidateId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid candidate id"),
  invitationNote: z.string().trim().max(280).optional(),
});

// POST /api/country/[code]/parties/[id]/slate/[electionId]/invitations — Party leadership assigns a player/NPP onto the slate
// Auth: requireAuthWithCharacter (must be the national or state chair / vice chair for this race)
// Errors: 400, 401, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, electionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(electionId)) {
      return NextResponse.json({ error: "Invalid election id" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, assignSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const partyId = String(party.sequentialId);
    const electionObjId = new ObjectId(electionId);
    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: electionObjId, countryId });
    if (!election) return NextResponse.json({ error: "Election not found" }, { status: 404 });
    const authority = await resolveSlateAuthority({
      db,
      party,
      stateId: election.state,
      actorId: auth.user.character._id,
      isAdmin: !!auth.user.isAdmin,
    });
    if (!authority.canManage) {
      return NextResponse.json(
        {
          error:
            "Only the national or state party chair / vice chair for this race can assign slate candidates.",
        },
        { status: 403 }
      );
    }

    if (election.electionType === "president") {
      return NextResponse.json(
        { error: "Presidential races do not use the slate assignment board." },
        { status: 400 }
      );
    }
    if (election.status !== "upcoming" && election.status !== "active") {
      return NextResponse.json(
        { error: "Slate is locked: this race is no longer accepting candidates." },
        { status: 409 }
      );
    }
    // A race keeps `status: "active"` through its general phase, so the status
    // check above does not catch a race whose primary has already closed.
    // Assigning a candidate now would file them straight into the general
    // election (bypassing the primary) on the next turn, so block it here.
    const currentTurn = await getCurrentTurn(db);
    if (isPrimaryClosed(election, currentTurn, new Date())) {
      return NextResponse.json(
        {
          error:
            "Slate is locked: the primary has ended for this race, so it can no longer accept new candidates.",
        },
        { status: 409 }
      );
    }
    if (parsed.data.candidateType === "npp") {
      const nppControl = await getPartyNppControlStatus({
        db,
        countryId,
        party,
        actor: auth.user.character,
        isAdmin: auth.user.isAdmin,
        now: new Date(),
      });
      if (!nppControl.ok) {
        return NextResponse.json({ error: nppControl.error }, { status: 403 });
      }
    }

    const candidateObjId = new ObjectId(parsed.data.candidateId);
    const now = new Date();
    const slate = await ensureSlate(db, {
      countryId,
      partyId,
      election,
      createdBy: auth.user.character._id,
      now,
    });
    if (slate.archivedAt) {
      return NextResponse.json(
        { error: "Slate has been archived for this race." },
        { status: 409 }
      );
    }

    const existingRow = await db.collection<SlateCandidate>("slateCandidates").findOne({
      slateId: slate._id,
      candidateId: candidateObjId,
    });
    if (existingRow && existingRow.status === "filed") {
      return NextResponse.json(
        { error: "This candidate has already filed from the slate." },
        { status: 409 }
      );
    }
    if (existingRow && existingRow.status !== "withdrawn" && existingRow.status !== "declined") {
      return NextResponse.json(
        { error: "This candidate is already on the slate." },
        { status: 409 }
      );
    }

    const candidate =
      parsed.data.candidateType === "npp"
        ? await buildNppSlateCandidate({
            db,
            countryId,
            partyId,
            election,
            candidateObjId,
            slateId: slate._id,
            note: parsed.data.invitationNote,
            now,
            assignedById: auth.user.character._id,
            assignedByName: auth.user.character.name,
            assignedByRole: authority.assignerRole,
            getsStateAcceptanceBuff: authority.getsStateAcceptanceBuff,
          })
        : await buildCharacterSlateCandidate({
            db,
            countryId,
            partyId,
            election,
            candidateObjId,
            slateId: slate._id,
            note: parsed.data.invitationNote,
            now,
            assignedById: auth.user.character._id,
            assignedByName: auth.user.character.name,
            assignedByRole: authority.assignerRole,
            electionId,
          });

    if ("error" in candidate) {
      return NextResponse.json({ error: candidate.error }, { status: candidate.status });
    }

    const sameStateSlateIds = (
      await db
        .collection<Election>("elections")
        .find({ countryId, state: election.state, status: { $in: ["upcoming", "active"] } })
        .project<Pick<Election, "_id">>({ _id: 1 })
        .toArray()
    ).map((stateElection) => stateElection._id);

    if (existingRow) {
      await db.collection<SlateCandidate>("slateCandidates").updateOne(
        { _id: existingRow._id },
        {
          $set: {
            candidateName: candidate.row.candidateName,
            homeState: candidate.row.homeState,
            assignedByCharacterId: candidate.row.assignedByCharacterId ?? null,
            assignedByCharacterName: candidate.row.assignedByCharacterName ?? null,
            assignedByRole: candidate.row.assignedByRole ?? null,
            status: candidate.row.status,
            fitScore: candidate.row.fitScore,
            invitationNote: candidate.row.invitationNote,
            refusalReason: candidate.row.refusalReason,
            autoFilled: false,
            invitedAt: now,
            respondedAt: candidate.row.respondedAt,
            filedAt: null,
            updatedAt: now,
          },
        }
      );
      if (sameStateSlateIds.length > 0) {
        // #906: tombstone the NPP's other same-state slate rows as `withdrawn`
        // rather than hard-deleting them. A hard delete leaves the old race's
        // slate empty, so the per-turn syncPersistentSlateAssignments re-hydrates
        // the NPP back onto it from the prior-cycle template and the move reverts.
        // A withdrawn tombstone keeps the slate non-empty (blocking re-hydration)
        // and is skipped by the template carry-forward and file/override passes.
        await db.collection<SlateCandidate>("slateCandidates").updateMany(
          {
            candidateId: candidateObjId,
            countryId,
            electionId: { $in: sameStateSlateIds, $ne: election._id },
          },
          { $set: { status: "withdrawn", updatedAt: now } }
        );
      }
      if (candidate.candidateType === "character" && candidate.userId) {
        await notifyAssignedPlayer({
          userId: candidate.userId,
          assignerName: auth.user.character.name,
          assignerRole: authority.assignerRoleLabel,
          election,
          electionId,
          partyId,
          countryId,
        });
      }
      return NextResponse.json({ success: true, id: existingRow._id.toString(), reassigned: true });
    }

    await db.collection<SlateCandidate>("slateCandidates").insertOne(candidate.row);
    if (sameStateSlateIds.length > 0) {
      // #906: tombstone (not delete) the NPP's other same-state slate rows so the
      // old race's slate stays non-empty and syncPersistentSlateAssignments does
      // not re-hydrate the NPP back onto it next turn. See matching branch above.
      await db.collection<SlateCandidate>("slateCandidates").updateMany(
        {
          candidateId: candidateObjId,
          countryId,
          electionId: { $in: sameStateSlateIds, $ne: election._id },
        },
        { $set: { status: "withdrawn", updatedAt: now } }
      );
    }
    if (candidate.candidateType === "character" && candidate.userId) {
      await notifyAssignedPlayer({
        userId: candidate.userId,
        assignerName: auth.user.character.name,
        assignerRole: authority.assignerRoleLabel,
        election,
        electionId,
        partyId,
        countryId,
      });
    }
    return NextResponse.json({ success: true, id: candidate.row._id.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function buildNppSlateCandidate(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  countryId: CountryId;
  partyId: string;
  election: Election;
  candidateObjId: ObjectId;
  slateId: ObjectId;
  note?: string;
  now: Date;
  assignedById: ObjectId;
  assignedByName: string;
  assignedByRole: SlateCandidate["assignedByRole"];
  getsStateAcceptanceBuff: boolean;
}): Promise<BuiltSlateCandidate> {
  const npp = await args.db.collection<NPP>("npps").findOne({ _id: args.candidateObjId });
  if (!npp) return { error: "NPP not found", status: 404 };

  if ((npp.countryId ?? "US") !== args.countryId) {
    return { error: "NPP belongs to a different country.", status: 400 };
  }
  if (npp.party !== args.partyId) {
    return { error: "NPP belongs to a different party.", status: 400 };
  }
  if (npp.retiredAt) {
    return { error: "NPP has retired.", status: 400 };
  }
  if (args.election.state && npp.homeState !== args.election.state) {
    return { error: "NPP does not live in the race's state.", status: 400 };
  }

  const compliant = isNppSlateCompliant(
    npp,
    args.getsStateAcceptanceBuff
      ? getSlateAcceptanceStatBonus(args.assignedByRole ?? null)
      : undefined
  );
  return {
    candidateType: "npp",
    userId: null,
    row: {
      _id: new ObjectId(),
      slateId: args.slateId,
      electionId: args.election._id,
      partyId: args.partyId,
      countryId: args.countryId,
      candidateType: "npp",
      candidateId: args.candidateObjId,
      candidateName: npp.name,
      homeState: npp.homeState,
      assignedByCharacterId: args.assignedById,
      assignedByCharacterName: args.assignedByName,
      assignedByRole: args.assignedByRole ?? null,
      status: "invited",
      fitScore: computeSlateAssignmentScore(npp),
      invitationNote: args.note,
      refusalReason: compliant ? null : "low_compliance",
      autoFilled: false,
      invitedAt: args.now,
      respondedAt: null,
      filedAt: null,
      createdAt: args.now,
      updatedAt: args.now,
    },
  };
}

async function buildCharacterSlateCandidate(args: {
  db: Awaited<ReturnType<typeof getDb>>;
  countryId: CountryId;
  partyId: string;
  election: Election;
  candidateObjId: ObjectId;
  slateId: ObjectId;
  note?: string;
  now: Date;
  assignedById: ObjectId;
  assignedByName: string;
  assignedByRole: SlateCandidate["assignedByRole"];
  electionId: string;
}): Promise<BuiltSlateCandidate> {
  const character = await args.db
    .collection<Character>("characters")
    .findOne({ _id: args.candidateObjId });
  if (!character) return { error: "Character not found", status: 404 };

  if ((character.countryId ?? "US") !== args.countryId) {
    return { error: "Character belongs to a different country.", status: 400 };
  }
  if (character.party !== args.partyId) {
    return { error: "Character belongs to a different party.", status: 400 };
  }
  if (args.election.state && character.homeState !== args.election.state) {
    return { error: "Character does not live in the race's state.", status: 400 };
  }

  // Only block if the candidate has an active candidacy in a still-open election
  // (upcoming / active / completed). Cancelled or resolved races leave behind
  // `status: "active"` rows that should not stop fresh slating — bug #0550.
  const blocking = await findBlockingActiveCandidacy(
    args.db,
    args.candidateObjId,
    args.election._id
  );
  if (blocking) {
    return { error: "Character is already filed in another race this cycle.", status: 409 };
  }

  return {
    candidateType: "character",
    userId: character.userId ?? null,
    row: {
      _id: new ObjectId(),
      slateId: args.slateId,
      electionId: args.election._id,
      partyId: args.partyId,
      countryId: args.countryId,
      candidateType: "character",
      candidateId: args.candidateObjId,
      candidateName: character.name,
      homeState: character.homeState,
      assignedByCharacterId: args.assignedById,
      assignedByCharacterName: args.assignedByName,
      assignedByRole: args.assignedByRole ?? null,
      status: "accepted",
      fitScore: 100,
      invitationNote: args.note,
      refusalReason: null,
      autoFilled: false,
      invitedAt: args.now,
      respondedAt: args.now,
      filedAt: null,
      createdAt: args.now,
      updatedAt: args.now,
    },
  };
}

async function notifyAssignedPlayer(args: {
  userId: ObjectId;
  assignerName: string;
  assignerRole: string | null;
  election: Pick<Election, "electionType" | "state">;
  electionId: string;
  partyId: string;
  countryId: CountryId;
}): Promise<void> {
  const assignerLabel = args.assignerRole
    ? `${args.assignerName} (${args.assignerRole})`
    : args.assignerName;
  const raceLabel = formatElectionTypeLabel(args.election.electionType, args.countryId);
  await createNotification({
    userId: args.userId,
    type: "system",
    title: "Party slate assignment",
    message: `${assignerLabel} assigned you to the ${raceLabel} race in ${args.election.state}.`,
    metadata: {
      electionId: args.electionId,
      partyId: args.partyId,
      countryId: args.countryId,
    },
  });
}
