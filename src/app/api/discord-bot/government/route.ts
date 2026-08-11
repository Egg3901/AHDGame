import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import {
  getCountryConfig,
  isParliamentarySystem,
  isDirectElection,
} from "@/lib/constants/countries";
import { nationalOfficeTypes, officeLabel } from "@/lib/api/discordBotLabels";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type {
  ElectedOfficial,
  PoliticalParty,
  Character,
  CongressLeader,
  CabinetMember,
  LeadershipRole,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { LEADERSHIP_ROLE_LABEL } from "@/lib/congress/leadership/electionRoleMap";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveSeatName } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

const CABINET_POSITION_LABELS: Record<string, string> = {
  secretary_of_state: "Secretary of State",
  secretary_of_treasury: "Secretary of the Treasury",
  secretary_of_defense: "Secretary of Defense",
  attorney_general: "Attorney General",
  secretary_of_interior: "Secretary of the Interior",
  secretary_of_agriculture: "Secretary of Agriculture",
  secretary_of_commerce: "Secretary of Commerce",
  secretary_of_labor: "Secretary of Labor",
  secretary_of_hhs: "Secretary of Health and Human Services",
  secretary_of_hud: "Secretary of Housing and Urban Development",
  secretary_of_transportation: "Secretary of Transportation",
  secretary_of_energy: "Secretary of Energy",
  secretary_of_education: "Secretary of Education",
  secretary_of_veterans: "Secretary of Veterans Affairs",
  secretary_of_homeland: "Secretary of Homeland Security",
};

const COUNTRY_LABELS: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  JP: "Japan",
  IE: "Ireland",
  BR: "Brazil",
  CN: "China",
  NG: "Nigeria",
};

interface OfficialEntry {
  role: string;
  section: "executive" | "leadership" | "cabinet";
  characterId: string | null;
  characterName: string | null;
  party: string | null;
  partyColor: string;
  profileUrl: string | null;
  isNPP: boolean;
}

// GET /api/discord-bot/government — Returns the current executive officials, congressional leaders, and cabinet members for a country.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:government",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const country = (url.searchParams.get("country") ?? "US").toUpperCase() as CountryId;

    /*
     * National executive offices come from the country config rather than a
     * hand-maintained map (which omitted BR/NG/RU/DD and still listed the
     * dropped CA). An empty list means the id isn't a configured country.
     */
    const officeTypes = nationalOfficeTypes(country);
    if (officeTypes.length === 0) {
      return NextResponse.json({ error: `Unsupported country: ${country}` }, { status: 400 });
    }

    const db = await getDb();

    // Fetch national executives, congressional leaders, and cabinet in parallel
    const countryConfig = getCountryConfig(country);
    const directElection = isDirectElection(countryConfig);

    const [executives, leaders, cabinetMembers] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ countryId: country, officeType: { $in: officeTypes } })
        .toArray(),
      directElection
        ? db.collection<CongressLeader>("congressLeaders").find({}).toArray()
        : Promise.resolve([]),
      directElection
        ? db.collection<CabinetMember>("cabinetMembers").find({}).toArray()
        : Promise.resolve([]),
    ]);

    // Collect all character IDs for profile URL lookups
    const charIds = new Set<string>();
    for (const e of executives) {
      if (e.characterId) charIds.add(e.characterId.toString());
    }
    for (const l of leaders) {
      if (l.characterId) charIds.add(l.characterId.toString());
    }
    for (const c of cabinetMembers) {
      if (c.characterId) charIds.add(c.characterId.toString());
    }

    // Fetch characters for profile URLs and party info
    const { ObjectId } = await import("mongodb");
    const charObjectIds = [...charIds].map((id) => new ObjectId(id));

    const characters =
      charObjectIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: charObjectIds } })
            .project({ _id: 1, sequentialId: 1, party: 1, countryId: 1 })
            .toArray()
        : [];
    const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

    // Gather all party sequential IDs for bulk lookup
    const partyLookups: { countryId: CountryId; sequentialId: number }[] = [];
    const allPartyRefs = new Set<string>();

    for (const e of executives) {
      if (e.party && e.party !== "independent") allPartyRefs.add(e.party);
    }
    for (const l of leaders) {
      if (l.party && l.party !== "independent") allPartyRefs.add(l.party);
    }
    for (const c of cabinetMembers) {
      if (c.party && c.party !== "independent") allPartyRefs.add(c.party);
    }

    for (const ref of allPartyRefs) {
      const seqId = Number(ref);
      if (!isNaN(seqId)) {
        partyLookups.push({ countryId: country, sequentialId: seqId });
      }
    }

    const parties =
      partyLookups.length > 0
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({
              $or: partyLookups.map((l) => ({
                countryId: l.countryId,
                sequentialId: l.sequentialId,
              })),
            })
            .toArray()
        : [];
    const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));

    function resolveParty(partyRef: string | undefined): {
      name: string | null;
      color: string;
    } {
      if (!partyRef || partyRef === "independent") {
        return { name: partyRef === "independent" ? "Independent" : null, color: "#666666" };
      }
      const party = partyMap.get(`${country}:${partyRef}`);
      return {
        name: party?.name ?? "Independent",
        color: party?.color ?? "#666666",
      };
    }

    function buildProfileUrl(charId: string | null): string | null {
      if (!charId) return null;
      const char = charMap.get(charId);
      if (!char) return null;
      return `${BASE_URL}${buildCharacterHref(char as { sequentialId?: number; _id?: { toString(): string } })}`;
    }

    // Build the officials list
    const officials: OfficialEntry[] = [];

    // Executive officials
    for (const e of executives) {
      // Config-derived, so RU/DD (and any future country) label correctly
      // without extending a ternary chain. Local name avoids shadowing the
      // imported helper.
      const resolvedOfficeLabel = officeLabel(country, e.officeType);

      const { name: partyName, color: partyColor } = resolveParty(e.party);
      officials.push({
        role: resolvedOfficeLabel,
        section: "executive",
        characterId: e.characterId?.toString() ?? null,
        characterName: e.characterName ?? null,
        party: partyName,
        partyColor,
        profileUrl: buildProfileUrl(e.characterId?.toString() ?? null),
        isNPP: e.isNPP ?? false,
      });
    }

    // Congressional leadership
    for (const l of leaders) {
      const roleLabel = LEADERSHIP_ROLE_LABEL[l.role as LeadershipRole] ?? l.role;
      const { name: partyName, color: partyColor } = resolveParty(l.party);
      officials.push({
        role: roleLabel,
        section: "leadership",
        characterId: l.characterId?.toString() ?? null,
        characterName: l.characterName ?? null,
        party: partyName,
        partyColor,
        profileUrl: buildProfileUrl(l.characterId?.toString() ?? null),
        isNPP: false,
      });
    }

    // Cabinet members. Only filled seats reach here, so era gating is
    // inherent; the label still resolves through the roster so renamed
    // seats (e.g. HEW vs HHS) show their era-correct title.
    const liveYear = await getLiveGameYear(db);
    for (const c of cabinetMembers) {
      const positionDef = getCabinetPositions(country).find((p) => p.id === c.positionId);
      const posLabel = positionDef
        ? resolveSeatName(positionDef, liveYear)
        : (CABINET_POSITION_LABELS[c.positionId] ?? c.positionId);
      const { name: partyName, color: partyColor } = resolveParty(c.party);
      officials.push({
        role: posLabel,
        section: "cabinet",
        characterId: c.characterId?.toString() ?? null,
        characterName: c.characterName ?? null,
        party: partyName,
        partyColor,
        profileUrl: buildProfileUrl(c.characterId?.toString() ?? null),
        isNPP: false,
      });
    }

    // Fetch government formation status for parliamentary countries
    const countryConfigForFormation = getCountryConfig(country);
    let governmentFormation: {
      status: string;
      formationType: string | null;
      pmCharacterId: string | null;
      pmName: string | null;
      governingPartyId: string | null;
      governingPartyName: string | null;
      coalitionPartyIds: string[] | null;
      coalitionPartyNames: string[] | null;
      totalSeatsSupporting: number;
      majorityThreshold: number;
      seatsByParty: Record<string, number>;
      seatsByPartyNames: Record<string, number>;
      totalSeats: number;
      activeVoteId: string | null;
      pmVacancyDeadlineTurn: number | null;
    } | null = null;

    if (isParliamentarySystem(countryConfigForFormation)) {
      const gfDoc = await getGovernmentFormationsCollection(db).findOne({ _id: country });
      if (gfDoc) {
        // Resolve party names from seatsByParty keys
        const partySeqIds = Object.keys(gfDoc.seatsByParty ?? {})
          .map((k) => Number(k))
          .filter((n) => !isNaN(n));
        const gfParties =
          partySeqIds.length > 0
            ? await db
                .collection<PoliticalParty>("politicalParties")
                .find({ countryId: country, sequentialId: { $in: partySeqIds } })
                .toArray()
            : [];
        const gfPartyNameMap = new Map(gfParties.map((p) => [String(p.sequentialId), p.name]));

        const seatsByPartyNames: Record<string, number> = {};
        for (const [seqId, seats] of Object.entries(gfDoc.seatsByParty ?? {})) {
          const name = gfPartyNameMap.get(seqId) ?? `Party ${seqId}`;
          seatsByPartyNames[name] = seats;
        }

        // Resolve governing party name
        const govPartyName = gfDoc.governingPartyId
          ? (gfPartyNameMap.get(gfDoc.governingPartyId) ?? null)
          : null;

        // Resolve coalition party names
        const coalitionNames = gfDoc.coalitionPartyIds
          ? gfDoc.coalitionPartyIds.map(
              (id: string) => gfPartyNameMap.get(String(id)) ?? `Party ${id}`
            )
          : null;

        governmentFormation = {
          status: gfDoc.status,
          formationType: gfDoc.formationType,
          pmCharacterId: gfDoc.pmCharacterId?.toString() ?? null,
          pmName: gfDoc.pmName,
          governingPartyId: gfDoc.governingPartyId,
          governingPartyName: govPartyName,
          coalitionPartyIds: gfDoc.coalitionPartyIds,
          coalitionPartyNames: coalitionNames,
          totalSeatsSupporting: gfDoc.totalSeatsSupporting,
          majorityThreshold: gfDoc.majorityThreshold,
          seatsByParty: gfDoc.seatsByParty,
          seatsByPartyNames,
          totalSeats: gfDoc.totalSeats,
          activeVoteId: gfDoc.activeVoteId?.toString() ?? null,
          pmVacancyDeadlineTurn: gfDoc.pmVacancyDeadlineTurn ?? null,
        };
      }
    }

    return NextResponse.json({
      found: true,
      country,
      countryName: COUNTRY_LABELS[country] ?? country,
      officials,
      governmentFormation,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
