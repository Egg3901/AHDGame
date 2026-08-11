/**
 * POST /api/admin/parties/[partyId]/delete?country=XX
 *   — Delete a party and all associated state parties
 *
 * partyId is the party's sequentialId (e.g. "3"). country query param scopes
 * the lookup — sequentialId is only unique within a country.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type {
  PoliticalParty,
  StatePartyOrg,
  PartyBudget,
  NationalPartyElection,
  StatePartyElection,
  NPP,
  Election,
  ElectionCandidate,
  ElectedOfficial,
} from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";

export async function POST(request: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { partyId } = await params;

    const url = new URL(request.url);
    const countryRaw = url.searchParams.get("country")?.toUpperCase();
    if (!countryRaw || !COUNTRY_CONFIGS[countryRaw as CountryId]) {
      return NextResponse.json(
        { error: "country query param is required (US, UK, CA, DE, JP)" },
        { status: 400 }
      );
    }
    const countryId = countryRaw as CountryId;

    const partySeqId = Number(partyId);
    if (!Number.isFinite(partySeqId)) {
      return NextResponse.json({ error: "Invalid party id" }, { status: 400 });
    }

    const db = await getDb();

    // Resolve party by (sequentialId, countryId) — the canonical unique key.
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: partySeqId, countryId });
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Don't allow deleting default/major parties
    if (party.isDefault) {
      return NextResponse.json({ error: "Cannot delete a default (major) party" }, { status: 400 });
    }

    const partySeqIdStr = String(party.sequentialId);
    const partyCountryId = party.countryId ?? "US";

    // Cascade-clean the party's NPPs: pull them out of any active/upcoming
    // candidacies and held seats, then retire them. Without this, deleting a
    // party leaves orphaned NPPs holding chamber seats and running in elections
    // for a party that no longer exists.
    const partyNpps = await db
      .collection<NPP>("npps")
      .find({ countryId: partyCountryId, party: partySeqIdStr, retiredAt: null })
      .project<{ _id: NPP["_id"] }>({ _id: 1 })
      .toArray();
    const partyNppIds = partyNpps.map((n) => n._id);

    let nppCandidateRowsDeleted = 0;
    let nppOfficialRowsDeleted = 0;
    let nppsRetired = 0;

    if (partyNppIds.length > 0) {
      // Pull from active/upcoming election candidate lists (matches the pattern
      // in src/app/api/admin/npps/lib/remove.ts — completed elections are left
      // alone for historical accuracy).
      const liveElections = await db
        .collection<Election>("elections")
        .find({ countryId: partyCountryId, status: { $in: ["upcoming", "active"] } })
        .project<{ _id: Election["_id"] }>({ _id: 1 })
        .toArray();
      const liveElectionIds = liveElections.map((e) => e._id);

      if (liveElectionIds.length > 0) {
        const candRes = await db
          .collection<ElectionCandidate>("electionCandidates")
          .deleteMany({ electionId: { $in: liveElectionIds }, nppId: { $in: partyNppIds } });
        nppCandidateRowsDeleted = candRes.deletedCount;
      }

      // Vacate held seats. House/stateSenate vacancies are derived from totals,
      // not stored as rows (see src/app/api/admin/officials/cleanup/route.ts),
      // so deletion — not nulling — is the correct cleanup for every officeType.
      // Read rows first so we can fire senate-vacancy notifications to governors,
      // matching the convention in /api/officials/[id]/resign.
      const heldOfficials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ nppId: { $in: partyNppIds } })
        .toArray();

      if (heldOfficials.length > 0) {
        const offRes = await db
          .collection<ElectedOfficial>("electedOfficials")
          .deleteMany({ _id: { $in: heldOfficials.map((o) => o._id) } });
        nppOfficialRowsDeleted = offRes.deletedCount;

        for (const o of heldOfficials) {
          if (o.officeType === "senate") {
            await notifyGovernorOfSenateVacancy(db, o.state, o.senateClass);
          }
        }
      }

      // Retire the NPPs themselves.
      const now = new Date();
      const retireRes = await db
        .collection<NPP>("npps")
        .updateMany(
          { _id: { $in: partyNppIds } },
          { $set: { retiredAt: now, currentOffice: null, updatedAt: now } }
        );
      nppsRetired = retireRes.modifiedCount;
    }

    // Delete all associated state party organizations (must match both partyId AND countryId)
    const statePartyResult = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .deleteMany({ partyId: partySeqIdStr, countryId: partyCountryId });

    // Delete all party budgets (must match both partyId AND countryId)
    const budgetResult = await db
      .collection<PartyBudget>("partyBudget")
      .deleteMany({ partyId: partySeqIdStr, countryId: partyCountryId });

    // Delete all party leadership elections (both national and state)
    // National elections have countryId
    const nationalElectionResult = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .deleteMany({ partyId: partySeqIdStr, countryId: partyCountryId });

    // StatePartyElection doesn't have countryId — resolve via states collection
    const countryStates = await db
      .collection("states")
      .find({ countryId: partyCountryId })
      .project({ _id: 1 })
      .toArray();
    const countryStateIds = countryStates.map((s) => s._id as string);
    const stateElectionResult = await db
      .collection<StatePartyElection>("statePartyElections")
      .deleteMany({ partyId: partySeqIdStr, stateId: { $in: countryStateIds } });

    // Delete the national party by its ObjectId _id — the canonical primary key.
    await db.collection<PoliticalParty>("politicalParties").deleteOne({ _id: party._id });

    return NextResponse.json({
      success: true,
      message:
        `Deleted party "${party.name}" and ${statePartyResult.deletedCount} state party organizations` +
        (nppsRetired > 0
          ? ` (retired ${nppsRetired} NPPs, freed ${nppOfficialRowsDeleted} held seats, withdrew ${nppCandidateRowsDeleted} candidacies)`
          : ""),
      details: {
        statePartiesDeleted: statePartyResult.deletedCount,
        budgetsDeleted: budgetResult.deletedCount,
        nationalElectionsDeleted: nationalElectionResult.deletedCount,
        stateElectionsDeleted: stateElectionResult.deletedCount,
        nppsRetired,
        nppCandidateRowsDeleted,
        nppOfficialRowsDeleted,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
