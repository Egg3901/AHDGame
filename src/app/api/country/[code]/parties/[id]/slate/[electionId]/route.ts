import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth, requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  ensureSlate,
  findSlateForElection,
  listSlateCandidates,
  listStateAssignedCandidateIds,
  materializeSlateAssignmentsFromTemplate,
} from "@/lib/db/recruitmentSlateLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Election, RecruitmentSlate } from "@/lib/db/types";
import { buildElectionPhaseStatusSummary } from "@/lib/elections/electionPhaseStatus";
import { resolveElection } from "@/lib/elections/resolveElection";
import { mapElectionResponseToDisplay } from "@/lib/elections/mapElectionResponseToDisplay";
import { getSlateAssignerRoleLabel, resolveSlateAuthority } from "@/lib/slateAuthority";

interface RouteParams {
  params: Promise<{ code: string; id: string; electionId: string }>;
}

// GET /api/country/[code]/parties/[id]/slate/[electionId] — Slate detail with candidate rows
// Auth: requireAuth
// Errors: 400, 401, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, electionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(electionId)) {
      return NextResponse.json({ error: "Invalid election id" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);
    const electionObjId = new ObjectId(electionId);
    const election = await db.collection<Election>("elections").findOne({ _id: electionObjId });
    if (!election || election.countryId !== countryId) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }
    const resolvedElection = await resolveElection(db, election, {
      view: "summary",
      userId: auth.user.userId?.toString?.() ?? null,
      isAdmin: auth.user.isAdmin,
      activeCharacterId: auth.user.character?._id?.toString?.() ?? null,
    });
    if (!resolvedElection) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }
    const electionDisplay = mapElectionResponseToDisplay(resolvedElection);

    const stateAssignedCandidateIds = await listStateAssignedCandidateIds(db, {
      countryId,
      partyId,
      state: election.state,
    });

    const slate =
      (await findSlateForElection(db, countryId, partyId, electionObjId)) ??
      (await materializeSlateAssignmentsFromTemplate({
        db,
        countryId,
        partyId,
        election,
        now: new Date(),
        partyAbbreviation: party.abbreviation ?? null,
      }));

    if (!slate) {
      // Slate hasn't been opened yet — return a stub so the UI can render an
      // empty pane and the chair can still issue invites (which will get-or-
      // create the slate row on POST).
      return NextResponse.json({
        slate: {
          id: null,
          electionId: electionId,
          electionType: election.electionType,
          state: election.state,
          priority: "none",
          notes: null,
          archivedAt: null,
        },
        candidates: [],
        election: {
          id: election._id.toString(),
          electionType: election.electionType,
          state: election.state,
          status: election.status,
          cycle: election.cycle,
          primaryEndTime: election.primaryEndTime?.toISOString() ?? null,
          phaseStatus: buildElectionPhaseStatusSummary(election),
        },
        electionDisplay,
        stateAssignedCandidateIds,
      });
    }

    const candidates = (await listSlateCandidates(db, slate._id)).filter(
      (candidate) => candidate.status !== "withdrawn"
    );
    return NextResponse.json({
      slate: {
        id: slate._id.toString(),
        electionId: slate.electionId.toString(),
        electionType: slate.electionType,
        state: slate.state,
        priority: slate.priority,
        notes: slate.notes ?? null,
        archivedAt: slate.archivedAt?.toISOString() ?? null,
        createdAt: slate.createdAt.toISOString(),
        updatedAt: slate.updatedAt.toISOString(),
      },
      candidates: candidates.map((c) => ({
        id: c._id.toString(),
        candidateType: c.candidateType,
        candidateId: c.candidateId.toString(),
        candidateName: c.candidateName,
        homeState: c.homeState,
        assignedByCharacterId: c.assignedByCharacterId?.toString() ?? null,
        assignedByCharacterName: c.assignedByCharacterName ?? null,
        assignedByRole: c.assignedByRole ?? null,
        assignedByRoleLabel: getSlateAssignerRoleLabel(c.assignedByRole),
        status: c.status,
        fitScore: c.fitScore,
        invitationNote: c.invitationNote ?? null,
        refusalReason: c.refusalReason,
        autoFilled: c.autoFilled,
        invitedAt: c.invitedAt.toISOString(),
        respondedAt: c.respondedAt?.toISOString() ?? null,
        filedAt: c.filedAt?.toISOString() ?? null,
      })),
      election: {
        id: election._id.toString(),
        electionType: election.electionType,
        state: election.state,
        status: election.status,
        cycle: election.cycle,
        primaryEndTime: election.primaryEndTime?.toISOString() ?? null,
        phaseStatus: buildElectionPhaseStatusSummary(election),
      },
      electionDisplay,
      stateAssignedCandidateIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const patchSchema = z.object({
  priority: z.enum(["high", "defend", "primary_threat", "none"]).optional(),
  notes: z.string().trim().max(500).optional(),
});

// PATCH /api/country/[code]/parties/[id]/slate/[electionId] — Party leadership edits priority/notes (creates the slate if missing)
// Auth: requireAuthWithCharacter (must be the national or state chair / vice chair for this race)
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request, { params }: RouteParams) {
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

    const parsed = await parseJsonBody(request, patchSchema);
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
            "Only the national or state party chair / vice chair for this race can edit slates.",
        },
        { status: 403 }
      );
    }

    const now = new Date();
    const slate = await ensureSlate(db, {
      countryId,
      partyId,
      election,
      createdBy: auth.user.character._id,
      now,
      priority: parsed.data.priority,
    });

    const setFields: Partial<RecruitmentSlate> = { updatedAt: now };
    if (parsed.data.priority !== undefined) setFields.priority = parsed.data.priority;
    if (parsed.data.notes !== undefined) setFields.notes = parsed.data.notes;

    await db
      .collection<RecruitmentSlate>("recruitmentSlates")
      .updateOne({ _id: slate._id }, { $set: setFields });

    return NextResponse.json({ success: true, id: slate._id.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
