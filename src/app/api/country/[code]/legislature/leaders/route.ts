/**
 * GET /api/country/[code]/legislature/leaders — Legislature leadership by country.
 *
 * Consolidates the former per-country routes:
 *   /api/legislature/uk/leaders, /api/legislature/ca/leaders, /api/legislature/de/leaders
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type { Character, ParliamentaryGovernment, PoliticalParty } from "@/lib/db/types";
import {
  resolveGoverningPartyIdsFromDocuments,
  resolveOppositionLeader,
} from "@/lib/turn/parliamentaryGovernment";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const db = await getDb();

    // Determine the head-of-government office type from country config
    const executiveOffice = config.officeTypes.find((o) => o.isExecutive);
    const executiveKey = executiveOffice?.key ?? "primeMinister";

    // governmentFormations is canonical for parliamentary systems; parliamentaryGovernments
    // is legacy and is not refreshed after a Commons general election, so it can sit empty
    // while governmentFormations still has the correct PM/seatsByParty.
    const [govFormation, govDoc] = await Promise.all([
      getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
      db
        .collection<ParliamentaryGovernment>("parliamentaryGovernments")
        .findOne({ _id: countryId }),
    ]);

    // Find the head of government — check currentOffice first (works for US/presidential),
    // then fall back to canonical governmentFormations, then legacy parliamentaryGovernments.
    const hogFilter: Record<string, unknown> = {
      "currentOffice.type": executiveKey,
    };
    hogFilter.countryId = countryId;
    let hogChar = await db.collection<Character>("characters").findOne(hogFilter);

    if (!hogChar) {
      const pmCharacterId = govFormation?.pmCharacterId ?? govDoc?.pmCharacterId ?? null;
      if (pmCharacterId) {
        hogChar = await db.collection<Character>("characters").findOne({ _id: pmCharacterId });
      }
    }

    let primeMinister = null;
    if (hogChar) {
      // Resolve party sequentialId to display name
      const partySeqId = hogChar.party ? Number.parseInt(hogChar.party, 10) : Number.NaN;
      let partyLabel: string | null = hogChar.party || null;
      if (!Number.isNaN(partySeqId)) {
        const partyDoc = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ sequentialId: partySeqId, countryId });
        if (partyDoc) partyLabel = partyDoc.name;
      }

      primeMinister = {
        characterId: hogChar._id.toString(),
        sequentialId: hogChar.sequentialId ?? null,
        characterName: hogChar.name,
        party: partyLabel,
        since: hogChar.updatedAt?.toISOString() || null,
        avatarUrl: hogChar.avatarUrl ?? null,
      };
    }

    // Find Opposition Leader. Prefer governmentFormations.seatsByParty (canonical) over
    // parliamentaryGovernments (legacy), which is cleared after a general election.
    // Uses the shared helper to consider both single parties and opposition coalitions.
    let oppositionLeader = null;
    const seatsByParty = govFormation?.seatsByParty ?? govDoc?.seatsByParty ?? null;

    if (seatsByParty) {
      const govPartyIds = await resolveGoverningPartyIdsFromDocuments(
        db,
        countryId,
        govFormation,
        govDoc
      );

      const partySeqNums = Object.keys(seatsByParty)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => !Number.isNaN(n));
      const partyDocs = partySeqNums.length
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({ countryId, sequentialId: { $in: partySeqNums } })
            .toArray()
        : [];
      const partyBySeq = new Map(partyDocs.map((p) => [String(p.sequentialId), p]));

      const result = await resolveOppositionLeader(
        db,
        countryId,
        seatsByParty,
        govPartyIds,
        partyBySeq
      );

      if (result) {
        const oppositionChar = await db
          .collection<Character>("characters")
          .findOne({ _id: result.chairId });

        if (oppositionChar) {
          oppositionLeader = {
            characterId: oppositionChar._id.toString(),
            sequentialId: oppositionChar.sequentialId ?? null,
            characterName: oppositionChar.name,
            party: result.partyDoc?.name || oppositionChar.party || null,
            since: oppositionChar.updatedAt?.toISOString() || null,
            avatarUrl: oppositionChar.avatarUrl ?? null,
          };
        }
      }
    }

    // Speaker is not yet implemented
    const speaker = null;

    return NextResponse.json({
      primeMinister,
      oppositionLeader,
      speaker,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
