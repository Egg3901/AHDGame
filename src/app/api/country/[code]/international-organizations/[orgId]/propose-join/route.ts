// POST /api/country/[code]/international-organizations/[orgId]/propose-join
// Foreign minister of `code` proposes to join international organization `orgId`.
// Auth: requireAuthWithCharacter + requireForeignMinister
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { ALIGNMENT_POLES } from "@/lib/constants/alignmentEras";
import { JOIN_SHARE, standingFor } from "@/lib/alignment/membershipEligibility";
import { isIntOrgAlignmentEnabled } from "@/lib/alignment/featureFlag";
import { getCountryAlignmentsCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import { ORG_PROPOSAL_VOTING_TURNS } from "@/lib/constants/internationalOrganizations";
import { getOrganizationProposalsCollection } from "@/lib/db/collections";
import {
  hasOpenMembershipProposal,
  isMember,
  loadOrganizationDef,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { votingMembers } from "@/lib/internationalOrganizations/orgMembership";
import { isOrganizationFoundedLive } from "@/lib/internationalOrganizations/founding";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isPendingOrganizationMembershipProposalDuplicateKey } from "@/lib/elections/duplicateKey";
import {
  getDiplomaticActionsRemaining,
  spendDiplomaticAction,
} from "@/lib/internationalOrganizations/diplomaticActions";
import { buildMembershipBill } from "@/lib/internationalOrganizations/commands/buildMembershipBill";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; orgId: string }> }
) {
  try {
    const { code, orgId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-propose:${ip}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const orgDef = await loadOrganizationDef(db, orgId);
    if (!orgDef) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 400 });
    }
    // Founding-year gate: an org that has not yet been founded in this game's
    // timeline is hidden from the world list and cannot be applied to.
    if (!(await isOrganizationFoundedLive(db, orgDef))) {
      return NextResponse.json(badRequest("This organization has not yet been founded.").toJson(), {
        status: 400,
      });
    }
    const fm = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!fm.ok) return fm.response;

    if (await isMember(db, orgId, countryId)) {
      return NextResponse.json(
        badRequest(`${countryId} is already a member of ${orgId}.`).toJson(),
        { status: 400 }
      );
    }
    if (await hasOpenMembershipProposal(db, orgId, countryId)) {
      return NextResponse.json(
        badRequest(`${countryId} already has an open membership proposal for ${orgId}.`).toJson(),
        { status: 400 }
      );
    }

    // Alignment precondition. Only applies to orgs that HAVE a channel this era
    // — the UN, custom orgs and the pre-1991 EU have no pole, so alignment has
    // nothing to say about them and `standingFor` returns null. Checked BEFORE
    // the diplomatic action below, so a refused application costs nothing.
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, intOrgAlignmentEnabled: 1 } }
      );
    if (await isIntOrgAlignmentEnabled(gs ?? {})) {
      const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
      const alignments = await getCountryAlignmentsCollection(db);
      const row = await alignments.findOne({ entityId: countryId });
      const standing = row
        ? standingFor({
            shares: { shares: row.shares, nonAligned: row.nonAligned },
            year,
            organizationId: orgDef.id,
          })
        : null;
      if (standing?.governsMembership && !standing.eligible) {
        // A null pole is the Non-Aligned Movement: its standing is the share no
        // bloc has persuaded, not a share of any bloc.
        const label = standing.poleId ? ALIGNMENT_POLES[standing.poleId].label : "non-alignment";
        return NextResponse.json(
          badRequest(
            `${countryId} holds only ${standing.share} of ${label}, short of the ${JOIN_SHARE} needed to join ${orgDef.name ?? orgId}.`
          ).toJson(),
          { status: 400 }
        );
      }
    }

    const currentTurn = await getCurrentTurn(db);
    if ((await getDiplomaticActionsRemaining(db, countryId, currentTurn)) < 1) {
      return NextResponse.json(badRequest("No diplomatic actions remaining this turn.").toJson(), {
        status: 400,
      });
    }
    // First-member accession: applying to an org with nobody to vote waives the
    // unanimous member vote, which would otherwise auto-fail. Decided at
    // APPLICATION time: every country that applies while the org has no voters
    // gets the waiver (founding wave); each is admitted when its own legislature
    // ratifies the Join bill.
    //
    // This must read the VOTING roll, not the full one — the resolver's
    // unanimity runs over voters, so an org holding only tribute members has
    // nobody to vote yet a non-empty roll. Reading `getMembers` here would deny
    // the waiver and then fail unanimity for want of voters, locking such an org
    // shut permanently.
    const orgVoteExempt = (await votingMembers(db, orgId)).length === 0;

    const proposalsCol = await getOrganizationProposalsCollection(db);
    const proposalId = new ObjectId();
    try {
      await proposalsCol.insertOne({
        _id: proposalId,
        organizationId: orgId,
        proposingCountryId: countryId,
        proposedByCharacterId: fm.auth.characterId,
        proposedByCharacterName: fm.auth.characterName,
        status: "pending",
        votes: [],
        proposedAt: new Date(),
        proposedOnTurn: currentTurn,
        closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
        ...(orgVoteExempt ? { orgVoteExempt: true, orgApproved: true } : {}),
      });
    } catch (error) {
      if (isPendingOrganizationMembershipProposalDuplicateKey(error)) {
        return NextResponse.json(
          badRequest(`${countryId} already has an open membership proposal for ${orgId}.`).toJson(),
          { status: 400 }
        );
      }
      throw error;
    }

    await spendDiplomaticAction(db, countryId, currentTurn);

    // Parallel domestic gate: raise a Join bill in the applicant's legislature.
    // Membership is granted only if BOTH this bill (simple majority) and the org
    // member vote (unanimous) pass; the arbiter cancels the counterpart on either
    // failure. Cross-link the two so the arbiter can poll the bill's status.
    const countryName = COUNTRY_CONFIGS[countryId].name;
    const organizationName = orgDef.name ?? orgId;
    const billId = await buildMembershipBill({
      db,
      countryId,
      sponsor: {
        characterId: fm.auth.characterId,
        characterName: fm.auth.characterName,
        party: auth.user.character.party,
      },
      title: `Resolution to Join ${organizationName}`,
      summary: `${countryName} would join ${organizationName} if the legislature approves and the organization's members admit it.`,
      fullText: `${countryName} shall accede to ${organizationName} upon enactment of this resolution, contingent on admission by the organization's existing members.`,
      provisions: [
        {
          type: "international_organization",
          subType: "join",
          organizationId: orgId,
          organizationName,
          membershipProposalId: proposalId,
        },
      ],
    });
    await proposalsCol.updateOne({ _id: proposalId }, { $set: { domesticBillId: billId } });

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      orgVoteExempt
        ? `${countryName} filed a founding application to join ${orgId} — admission requires only domestic ratification.`
        : `${countryName} formally applied to join ${orgId} and raised a domestic ratification bill.`,
      { organizationId: orgId, proposalId: proposalId.toString(), billId: billId.toString() }
    );

    return NextResponse.json({ ok: true, proposalId: proposalId.toString() });
  } catch (err) {
    return handleRouteError(err);
  }
}
