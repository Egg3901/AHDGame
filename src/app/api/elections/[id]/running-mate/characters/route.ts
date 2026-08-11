/**
 * GET /api/elections/[id]/running-mate/characters
 * List characters available as running mate (for presidential candidates).
 * Excludes current President. Requires caller to be a candidate in the election.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  User,
  PoliticalParty,
} from "@/lib/db/types";
import { isHexObjectIdString } from "@/lib/utils/objectIdHex";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { hasReachedExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Determines if the given ID is a seatId (e.g., "US-president") or an ObjectId.
 */
function isSeatId(id: string): boolean {
  if (isHexObjectIdString(id)) return false;
  const parts = id.split("-");
  if (parts.length < 2) return false;
  if (!/^[A-Z]{2}$/i.test(parts[0])) return false;
  return true;
}

// GET /api/elections/[id]/running-mate/characters — Returns characters eligible to be selected as a presidential running mate.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { user } = auth;
    const character = user.character;

    const { id: electionId } = await params;

    const db = await getDb();

    // Resolve election by seatId or ObjectId
    let election: Election | null = null;
    if (isSeatId(electionId)) {
      election = await db.collection<Election>("elections").findOne({
        seatId: electionId,
        status: { $in: ["active", "upcoming"] },
      });
    } else {
      let electionObjectId: ObjectId;
      try {
        electionObjectId = new ObjectId(electionId);
      } catch {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      election = await db.collection<Election>("elections").findOne({ _id: electionObjectId });
    }
    if (!election || election.electionType !== "president") {
      return NextResponse.json({ error: "Not a presidential election" }, { status: 400 });
    }

    const myCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      characterId: character._id,
      status: "active",
    });
    if (!myCandidate) {
      return NextResponse.json(
        { error: "You are not a candidate in this election" },
        { status: 403 }
      );
    }

    const electionCountry = (election.countryId ?? COUNTRY_CONFIGS.US.id) as CountryId;
    const countryConfig = getCountryConfig(electionCountry);
    const currentPresident = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      ...getExecutiveOfficialFilter(electionCountry, "president"),
      characterId: { $ne: null },
    });
    const presidentCharId = currentPresident?.characterId?.toString() ?? null;

    const characters = await db
      .collection<Character>("characters")
      .find({
        userId: { $exists: true },
        $or: [{ countryId: electionCountry }, { countryId: { $exists: false } }],
      })
      .project({
        _id: 1,
        userId: 1,
        name: 1,
        party: 1,
        homeState: 1,
        careerHistory: 1,
        countryId: 1,
        executiveTermsServed: 1,
      })
      .sort({ name: 1 })
      .toArray();

    const userIds = characters.map((c) => c.userId).filter(Boolean);
    const [users, parties, activeCandidates] = await Promise.all([
      userIds.length > 0
        ? db
            .collection<User>("users")
            .find({ _id: { $in: userIds } })
            .toArray()
        : [],
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: electionCountry })
        .toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        // Suspended candidates (who dropped out to endorse) remain eligible as a
        // running mate — only genuinely-active candidates in this race are excluded.
        .find({
          electionId: election._id,
          status: "active",
          campaignSuspended: { $ne: true },
          characterId: { $exists: true },
        })
        .project({ characterId: 1 })
        .toArray(),
    ]);
    const eligibleUserIds = new Set(users.filter((u) => !u.isBanned).map((u) => u._id.toString()));
    const activeCandidateCharacterIds = new Set(
      activeCandidates
        .map((candidate) => candidate.characterId?.toString())
        .filter((candidateId): candidateId is string => Boolean(candidateId))
    );
    const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}_${p.sequentialId}`, p]));

    const list = characters
      .filter((c) => {
        if (c._id.toString() === presidentCharId) return false;
        if (c._id.equals(character._id)) return false;
        if (!eligibleUserIds.has(c.userId?.toString() ?? "")) return false;
        if (activeCandidateCharacterIds.has(c._id.toString())) return false;
        // For non-US elections, exclude characters without countryId (legacy US characters)
        if (electionCountry !== COUNTRY_CONFIGS.US.id && !c.countryId) return false;
        if (
          countryConfig.executiveTermLimit?.blocksRunningMateSelection &&
          hasReachedExecutiveTermLimit(c, electionCountry)
        ) {
          return false;
        }
        return true;
      })
      .map((c) => {
        const charCountry = c.countryId ?? COUNTRY_CONFIGS.US.id;
        const partyKey = `${charCountry}_${c.party}`;
        const party = partyMap.get(partyKey);
        return {
          id: c._id.toString(),
          name: c.name,
          party: c.party,
          // Human-readable party name for display. `party` above stays the raw
          // key (sequential id) used for filtering + PartyLogo lookup; countries
          // store it as a numeric id (e.g. "6"), so the bare key isn't showable.
          partyName: party?.name ?? null,
          homeState: c.homeState,
          partyColor: party?.color ?? null,
          countryId: charCountry,
        };
      });

    return NextResponse.json({ characters: list });
  } catch (error) {
    return handleRouteError(error);
  }
}
