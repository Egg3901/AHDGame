import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { isSameCountry } from "@/lib/api/sameCountry";
import { createProposalSchema } from "@/lib/api/schemas/parties";
import {
  getEligibleVoterSet,
  isPositionShiftLocked,
  isProposalTypeLocked,
} from "@/lib/parties/proposals";
import type { CommitteeProposal, PoliticalParty, Character } from "@/lib/db/types";
import type {
  ProposalView,
  ProposalVoteSummary,
  ProposalsResponse,
} from "@/lib/parties/dto/partyView";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

function buildVoteSummary(
  votes: CommitteeProposal["proposingVotes"],
  committeeSize: number
): ProposalVoteSummary {
  const yes = votes.filter((v) => v.vote === "yes").length;
  const no = votes.filter((v) => v.vote === "no").length;
  return { yes, no, notVoted: Math.max(0, committeeSize - yes - no) };
}

async function toProposalView(
  db: Db,
  proposal: CommitteeProposal,
  proposingCommitteeSize: number,
  targetCommitteeSize: number | undefined,
  myCharacterId: ObjectId
): Promise<ProposalView> {
  const proposer = await db
    .collection<Character>("characters")
    .findOne({ _id: proposal.proposedBy }, { projection: { name: 1 } });

  let mergeField: ProposalView["merge"] | undefined;
  if (proposal.type === "merge" && proposal.merge) {
    const targetParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ _id: proposal.merge.targetPartyId }, { projection: { name: 1 } });
    mergeField = {
      targetPartyId: proposal.merge.targetPartyId.toString(),
      targetPartyName: targetParty?.name ?? "Unknown",
    };
  }

  let campaignerAppointmentField: ProposalView["campaignerAppointment"] | undefined;
  if (proposal.type === "campaignerAppointment" && proposal.campaignerAppointment) {
    const targetCharacter = await db
      .collection<Character>("characters")
      .findOne(
        { _id: proposal.campaignerAppointment.targetCharacterId },
        { projection: { name: 1 } }
      );
    campaignerAppointmentField = {
      targetCharacterId: proposal.campaignerAppointment.targetCharacterId.toString(),
      targetCharacterName: targetCharacter?.name ?? "Unknown",
    };
  }

  let removeOfficeHolderField: ProposalView["removeOfficeHolder"] | undefined;
  if (proposal.type === "removeOfficeHolder" && proposal.removeOfficeHolder) {
    const targetCharacter = await db
      .collection<Character>("characters")
      .findOne({ _id: proposal.removeOfficeHolder.targetCharacterId }, { projection: { name: 1 } });
    removeOfficeHolderField = {
      role: proposal.removeOfficeHolder.role,
      targetCharacterId: proposal.removeOfficeHolder.targetCharacterId.toString(),
      targetCharacterName: targetCharacter?.name ?? "Unknown",
    };
  }

  const myStr = myCharacterId.toString();
  const myProposingVote = proposal.proposingVotes.find((v) => v.voterId.toString() === myStr)?.vote;
  const myTargetVote =
    proposal.type === "merge"
      ? (proposal.targetVotes ?? []).find((v) => v.voterId.toString() === myStr)?.vote
      : undefined;

  return {
    id: proposal._id.toString(),
    type: proposal.type,
    status: proposal.status,
    proposedBy: proposal.proposedBy.toString(),
    proposedByName: proposer?.name ?? "Unknown",
    createdAtTurn: proposal.createdAtTurn,
    expiresAtTurn: proposal.expiresAtTurn,
    resolvedAtTurn: proposal.resolvedAtTurn,
    rename: proposal.rename,
    positionShift: proposal.positionShift,
    merge: mergeField,
    electionMethod: proposal.electionMethod,
    electionDuration: proposal.electionDuration,
    removeOfficeHolder: removeOfficeHolderField,
    campaignerAppointment: campaignerAppointmentField,
    transactionApprovalMode: proposal.transactionApprovalMode,
    proposingVoteSummary: buildVoteSummary(proposal.proposingVotes, proposingCommitteeSize),
    targetVoteSummary:
      proposal.type === "merge" && targetCommitteeSize !== undefined
        ? buildVoteSummary(proposal.targetVotes ?? [], targetCommitteeSize)
        : undefined,
    myProposingVote,
    myTargetVote,
  };
}

async function getTargetEligibleSize(db: Db, proposal: CommitteeProposal): Promise<number> {
  if (proposal.type !== "merge" || !proposal.merge) return 0;
  const target = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { _id: proposal.merge.targetPartyId },
      { projection: { committeeIds: 1, chairId: 1, viceChairId: 1, treasurerId: 1 } }
    );
  if (!target) return 0;
  return getEligibleVoterSet(target).size;
}

// GET /api/country/[code]/parties/[id]/committee/proposals
// Auth: requireAuthWithCharacter
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const myCharacterId = authResult.user.character._id;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const eligibleVoterSet = getEligibleVoterSet(party);
    const eligibleSize = eligibleVoterSet.size;
    const myCharStr = myCharacterId.toString();
    const isEligibleVoter = eligibleVoterSet.has(myCharStr);
    const isChair = party.chairId?.toString() === myCharStr;
    const isViceChair = party.viceChairId?.toString() === myCharStr;
    const isCommitteeMember = party.committeeIds.some((id) => id.toString() === myCharStr);
    // Proposer eligibility (per 2026-05-22 redesign clarification): chair,
    // vice-chair, or any National Committee member. Treasurer excluded
    // from proposing but included in the voter set.
    const canProposeAny = isChair || isViceChair || isCommitteeMember;

    const [rawOpen, rawPast, rawIncoming] = await Promise.all([
      db
        .collection<CommitteeProposal>("committeeProposals")
        .find({ partyId: party._id, status: "open" })
        .sort({ createdAt: -1 })
        .toArray(),
      db
        .collection<CommitteeProposal>("committeeProposals")
        .find({ partyId: party._id, status: { $in: ["passed", "rejected", "expired"] } })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray(),
      db
        .collection<CommitteeProposal>("committeeProposals")
        .find({ "merge.targetPartyId": party._id, status: "open" })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);

    // Fetch proposing party eligible voter sizes for incoming merge proposals
    const incomingProposingIds = [...new Set(rawIncoming.map((p) => p.partyId.toString()))];
    const proposingPartiesForIncoming =
      incomingProposingIds.length > 0
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({ _id: { $in: rawIncoming.map((p) => p.partyId) } })
            .project<{
              _id: ObjectId;
              committeeIds: ObjectId[];
              chairId: ObjectId | null;
              viceChairId: ObjectId | null;
              treasurerId: ObjectId | null;
            }>({ committeeIds: 1, chairId: 1, viceChairId: 1, treasurerId: 1 })
            .toArray()
        : [];
    const proposingSizeMap = new Map(
      proposingPartiesForIncoming.map((p) => [
        p._id.toString(),
        getEligibleVoterSet(p as PoliticalParty).size,
      ])
    );

    const [openProposals, incomingMergeProposals, pastProposals] = await Promise.all([
      Promise.all(
        rawOpen.map(async (p) => {
          const targetSize = p.type === "merge" ? await getTargetEligibleSize(db, p) : undefined;
          return toProposalView(db, p, eligibleSize, targetSize, myCharacterId);
        })
      ),
      Promise.all(
        rawIncoming.map((p) =>
          toProposalView(
            db,
            p,
            proposingSizeMap.get(p.partyId.toString()) ?? 0,
            eligibleSize,
            myCharacterId
          )
        )
      ),
      Promise.all(
        rawPast.map((p) => toProposalView(db, p, eligibleSize, undefined, myCharacterId))
      ),
    ]);

    const response: ProposalsResponse = {
      openProposals,
      incomingMergeProposals,
      pastProposals,
      // 2026-05-22 redesign: chair / vice-chair / committee can propose
      // any type. Treasurer is included in the voter set but cannot
      // propose. `canProposeMerge` retained for backward-compat with
      // existing UI; condition is now identical to `canPropose`.
      canPropose: canProposeAny && !party.isDefunct,
      canProposeMerge: canProposeAny && !party.isDefunct,
      canVote: isEligibleVoter && !party.isDefunct,
      // 2026-05-22 treasury-two-person-approval: surface the current
      // mode so the modal can grey out the active option (no-op
      // proposals are server-side rejected anyway).
      currentTransactionApprovalMode: party.transactionApprovalMode ?? "double",
    };

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/parties/[id]/committee/proposals
// Auth: requireAuthWithCharacter; must be committee member (merge = chair only)
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });
    if (party.isDefunct) {
      return NextResponse.json({ error: "This party has been dissolved" }, { status: 400 });
    }
    if (!isSameCountry(user.character, party)) {
      return NextResponse.json({ error: "Country mismatch" }, { status: 403 });
    }

    const characterId = user.character._id;
    // 2026-05-22 redesign (user clarification): proposer eligibility is
    // chair OR vice-chair OR any National Committee member. Treasurer
    // can vote but not propose. The voting body at resolution still
    // includes treasurer via `getEligibleVoterSet`.
    const characterIdStr = characterId.toString();
    const isChair = party.chairId?.toString() === characterIdStr;
    const isViceChair = party.viceChairId?.toString() === characterIdStr;
    const isCommittee = party.committeeIds.some((id) => id.toString() === characterIdStr);
    const canPropose = isChair || isViceChair || isCommittee;
    if (!canPropose) {
      return NextResponse.json(
        {
          error:
            "Only the chair, vice-chair, or a national committee member may propose committee actions",
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, createProposalSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    // Campaigner nominations originate from the Chair Office roster
    // editor, which owns the cap and residency checks. Refuse hand-rolled
    // ones here so those checks can't be side-stepped.
    if (body.type === "campaignerAppointment") {
      return NextResponse.json(
        {
          error:
            "Nominate campaigners from the Chair Office Party Campaigners card, not the proposal form.",
        },
        { status: 400 }
      );
    }

    // Cooldown gate: reject if the relevant per-axis (positionShift) or
    // per-type (everything else) lock is still active. `getGameTime` runs
    // later for the turn used in the proposal doc — read it here too.
    const { currentTurn: nowTurn } = await getGameTime();
    if (body.type === "positionShift") {
      if (isPositionShiftLocked(party, body.axis, nowTurn)) {
        const lock = party.positionShiftCooldowns?.[body.axis];
        return NextResponse.json(
          {
            error: `Position shift on '${body.axis}' is locked until turn ${lock?.lockedUntilTurn}`,
            lockedUntilTurn: lock?.lockedUntilTurn,
          },
          { status: 409 }
        );
      }
    } else if (
      body.type === "rename" ||
      body.type === "merge" ||
      body.type === "electionMethod" ||
      body.type === "electionDuration" ||
      body.type === "removeOfficeHolder" ||
      body.type === "transactionApprovalMode"
    ) {
      if (isProposalTypeLocked(party, body.type, nowTurn)) {
        const lock = party.proposalCooldowns?.[body.type];
        return NextResponse.json(
          {
            error: `Proposal type '${body.type}' is locked until turn ${lock?.lockedUntilTurn}`,
            lockedUntilTurn: lock?.lockedUntilTurn,
          },
          { status: 409 }
        );
      }
    }

    // Duplicate-open guard: don't allow a second open proposal of the same
    // type/axis on the same party while the first is still pending. Prevents
    // racing the cooldown via two concurrent proposals.
    const duplicateOpen = await db.collection<CommitteeProposal>("committeeProposals").findOne({
      partyId: party._id,
      status: "open",
      type: body.type,
      ...(body.type === "positionShift" ? { "positionShift.axis": body.axis } : {}),
    });
    if (duplicateOpen) {
      return NextResponse.json(
        {
          error:
            body.type === "positionShift"
              ? `An open positionShift proposal on '${body.axis}' already exists`
              : `An open '${body.type}' proposal already exists`,
          existingProposalId: duplicateOpen._id.toString(),
        },
        { status: 409 }
      );
    }

    if (body.type === "merge") {
      const targetPartyObjId = new ObjectId(body.targetPartyId);
      if (targetPartyObjId.toString() === party._id.toString()) {
        return NextResponse.json({ error: "Cannot merge a party with itself" }, { status: 400 });
      }
      const targetParty = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: targetPartyObjId }, { projection: { countryId: 1, isDefunct: 1 } });
      if (!targetParty) {
        return NextResponse.json({ error: "Target party not found" }, { status: 404 });
      }
      if (targetParty.isDefunct) {
        return NextResponse.json({ error: "Target party has been dissolved" }, { status: 400 });
      }
      if (targetParty.countryId !== party.countryId) {
        return NextResponse.json(
          { error: "Cannot merge parties across countries" },
          { status: 400 }
        );
      }
    }

    if (body.type === "transactionApprovalMode") {
      // Reject no-op proposals — the modal should grey out the currently
      // active mode but a hand-rolled request could still try. Absent
      // value (legacy rows) is treated as "double" so a proposal to
      // switch to "double" on a legacy row is also a no-op.
      const currentMode = party.transactionApprovalMode ?? "double";
      if (body.mode === currentMode) {
        return NextResponse.json(
          { error: `Party is already in '${currentMode}' transaction approval mode.` },
          { status: 400 }
        );
      }
    }

    if (body.type === "removeOfficeHolder") {
      const targetOid = new ObjectId(body.targetCharacterId);
      // Self-target forbidden: proposing your own removal is invalid.
      if (targetOid.equals(characterId)) {
        return NextResponse.json({ error: "You cannot propose your own removal" }, { status: 400 });
      }
      // Target must currently hold the named role; reject if the role is
      // vacant or the named character isn't in that role.
      let inRole = false;
      if (body.role === "chair") {
        inRole = !!party.chairId && party.chairId.equals(targetOid);
      } else if (body.role === "viceChair") {
        inRole = !!party.viceChairId && party.viceChairId.equals(targetOid);
      } else if (body.role === "campaigner") {
        inRole = (party.campaignerIds ?? []).some((id) => id.equals(targetOid));
      } else {
        // committeeMember
        inRole = party.committeeIds.some((id) => id.equals(targetOid));
      }
      if (!inRole) {
        return NextResponse.json(
          { error: `Target character is not currently the ${body.role}` },
          { status: 400 }
        );
      }
    }

    const now = new Date();

    const proposalDoc: Omit<CommitteeProposal, "_id"> = {
      type: body.type,
      status: "open",
      partyId: party._id,
      countryId: party.countryId,
      proposedBy: characterId,
      createdAtTurn: nowTurn,
      expiresAtTurn: nowTurn + 24,
      createdAt: now,
      updatedAt: now,
      proposingVotes: [],
      targetVotes: body.type === "merge" ? [] : undefined,
      rename:
        body.type === "rename"
          ? { newName: body.newName, newAbbreviation: body.newAbbreviation }
          : undefined,
      positionShift:
        body.type === "positionShift" ? { axis: body.axis, direction: body.direction } : undefined,
      merge:
        body.type === "merge" ? { targetPartyId: new ObjectId(body.targetPartyId) } : undefined,
      electionMethod: body.type === "electionMethod" ? { method: body.method } : undefined,
      electionDuration:
        body.type === "electionDuration" ? { durationTurns: body.durationTurns } : undefined,
      removeOfficeHolder:
        body.type === "removeOfficeHolder"
          ? {
              role: body.role,
              targetCharacterId: new ObjectId(body.targetCharacterId),
            }
          : undefined,
      transactionApprovalMode:
        body.type === "transactionApprovalMode" ? { mode: body.mode } : undefined,
    };

    const result = await db
      .collection<CommitteeProposal>("committeeProposals")
      .insertOne(proposalDoc as CommitteeProposal);

    return NextResponse.json({ success: true, proposalId: result.insertedId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
