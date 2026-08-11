// POST /api/country/[code]/international-organizations/[orgId]/leadership/nominate
// Foreign minister of `code` nominates a candidate for the org's leadership office
// (Secretary-General / President). Candidate must be a sitting head of government
// or foreign minister of a current member country.
import { ObjectId } from "mongodb";
import { z } from "zod";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  ORG_PROPOSAL_VOTING_TURNS,
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
} from "@/lib/constants/internationalOrganizations";
import {
  getOrganizationLeadershipCollection,
  getOrganizationLeadershipElectionsCollection,
} from "@/lib/db/collections";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  loadOrganizationDef,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { isVotingMember, votingMembers } from "@/lib/internationalOrganizations/orgMembership";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import {
  getDiplomaticActionsRemaining,
  spendDiplomaticAction,
} from "@/lib/internationalOrganizations/diplomaticActions";
import type { Character } from "@/lib/db/types";
import { isPendingOrganizationLeadershipElectionDuplicateKey } from "@/lib/elections/duplicateKey";

const nominateSchema = z.object({
  candidateCharacterId: z
    .string()
    .refine((s: string) => ObjectId.isValid(s), "Invalid character id"),
});

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
    const body = await parseJsonBody(request, nominateSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-nominate:${ip}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const orgDef = await loadOrganizationDef(db, orgId);
    if (!orgDef) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 400 });
    }
    // Permanent-leadership orgs (Commonwealth, Warsaw Pact) never hold
    // elections — the office is derived from the leader country's head of
    // government at read time.
    if (orgDef.permanentLeadership) {
      return NextResponse.json(
        badRequest("This organization's leadership is permanent.").toJson(),
        { status: 400 }
      );
    }
    const fm = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!fm.ok) return fm.response;

    if (!(await isVotingMember(db, orgId, countryId))) {
      return NextResponse.json(badRequest(`${countryId} has no vote in ${orgId}.`).toJson(), {
        status: 400,
      });
    }

    // Reject if there's already a pending election for this org.
    const electionsCol = await getOrganizationLeadershipElectionsCollection(db);
    const existing = await electionsCol.findOne({ organizationId: orgId, status: "pending" });
    if (existing) {
      return NextResponse.json(
        badRequest("A leadership election is already underway for this organization.").toJson(),
        { status: 400 }
      );
    }

    // Reject if the seat is currently filled and the term hasn't ended.
    const leadershipCol = await getOrganizationLeadershipCollection(db);
    const leadership = await leadershipCol.findOne({ organizationId: orgId });
    const currentTurn = await getCurrentTurn(db);
    if (
      leadership?.holderCharacterId &&
      leadership.termEndsOnTurn != null &&
      leadership.termEndsOnTurn > currentTurn
    ) {
      return NextResponse.json(
        badRequest(
          `The current term does not end until turn ${leadership.termEndsOnTurn}. Wait for it to expire.`
        ).toJson(),
        { status: 400 }
      );
    }

    // Validate candidate: must be a sitting head of government OR foreign minister
    // of a member country.
    const candidateId = new ObjectId(body.data.candidateCharacterId);
    const candidate = await db.collection<Character>("characters").findOne({ _id: candidateId });
    if (!candidate) {
      return NextResponse.json(badRequest("Candidate character not found.").toJson(), {
        status: 400,
      });
    }

    // A chair is an office a player holds, so the candidate pool is the voting
    // roll — the same set `loadOrganizationLeadershipCandidates` offers in the
    // UI. Reading the full roll here would accept a posted nomination the
    // dropdown never showed.
    const memberCountries = (await votingMembers(db, orgId)).filter(
      (id): id is CountryId => id in COUNTRY_CONFIGS
    );
    const memberSet = new Set(memberCountries);

    let eligible = false;
    let candidateCountryId: CountryId | null = null;

    for (const memberCountry of memberCountries) {
      const fmPositionId = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[memberCountry];
      if (fmPositionId) {
        const cabinetCol = await getCabinetMembersCollection(db);
        const fmMember = await cabinetCol.findOne({
          countryId: memberCountry,
          positionId: fmPositionId,
        });
        if (fmMember && fmMember.characterId?.toString() === candidateId.toString()) {
          eligible = true;
          candidateCountryId = memberCountry;
          break;
        }
      }
      // Parliamentary PMs live in governmentFormations, not officials, so we
      // delegate to the shared head-of-government lookup.
      const hogCharId = await getHeadOfGovernmentCharacterId(db, memberCountry);
      if (hogCharId && hogCharId.toString() === candidateId.toString()) {
        eligible = true;
        candidateCountryId = memberCountry;
        break;
      }
    }

    if (!eligible || !candidateCountryId || !memberSet.has(candidateCountryId)) {
      return NextResponse.json(
        badRequest(
          "Candidate must be a sitting head of government or foreign minister of a member country."
        ).toJson(),
        { status: 400 }
      );
    }

    if ((await getDiplomaticActionsRemaining(db, countryId, currentTurn)) < 1) {
      return NextResponse.json(badRequest("No diplomatic actions remaining this turn.").toJson(), {
        status: 400,
      });
    }

    const electionId = new ObjectId();
    try {
      await electionsCol.insertOne({
        _id: electionId,
        organizationId: orgId,
        candidateCharacterId: candidateId,
        candidateCharacterName: candidate.name,
        candidateCountryId,
        nominatedByCharacterId: fm.auth.characterId,
        nominatedByCharacterName: fm.auth.characterName,
        nominatedByCountryId: countryId,
        status: "pending",
        votes: [],
        proposedAt: new Date(),
        proposedOnTurn: currentTurn,
        closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
      });
    } catch (error) {
      if (isPendingOrganizationLeadershipElectionDuplicateKey(error)) {
        return NextResponse.json(
          badRequest("A leadership election is already underway for this organization.").toJson(),
          { status: 400 }
        );
      }
      throw error;
    }

    await spendDiplomaticAction(db, countryId, currentTurn);

    await recordOrgHistoryEvent(
      db,
      countryId,
      currentTurn,
      `${COUNTRY_CONFIGS[countryId].name} nominated ${candidate.name} for ${orgId} leadership.`,
      { organizationId: orgId, electionId: electionId.toString() }
    );

    return NextResponse.json({ ok: true, electionId: electionId.toString() });
  } catch (err) {
    return handleRouteError(err);
  }
}
