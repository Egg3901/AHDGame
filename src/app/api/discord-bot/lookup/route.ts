import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { getOfficeLabel } from "@/lib/utils/politics";
import { findOfficeLabel } from "@/lib/api/discordBotLabels";
import { getDiscordAvatarUrl, toAbsoluteUploadUrl } from "@/lib/discord";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { partyUrl } from "@/lib/urls";
import type {
  Character,
  User,
  PoliticalParty,
  State,
  ElectionCandidate,
  Election,
  Corporation,
  InvestorRankingSnapshot,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/lookup — Returns full character profile data looked up by name or Discord ID.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:lookup",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const discordId = url.searchParams.get("discordId");

    if (!name && !discordId) {
      return NextResponse.json({ error: "Must provide name or discordId" }, { status: 400 });
    }

    const db = await getDb();

    let characters: Character[] = [];

    if (discordId) {
      // Find user by Discord ID, then their character
      const user = await db.collection<User>("users").findOne({ discordId });
      if (user) {
        const char = await db.collection<Character>("characters").findOne({ userId: user._id });
        if (char) characters = [char];
      }
    } else if (name) {
      // Search by character name (case-insensitive, partial match)
      characters = await db
        .collection<Character>("characters")
        .find({
          name: { $regex: escapeRegex(name), $options: "i" },
        })
        .limit(5)
        .toArray();
    }

    if (characters.length === 0) {
      return NextResponse.json({ found: false, characters: [] });
    }

    // Fetch related data
    const stateIds = [...new Set(characters.map((c) => c.homeState))];
    const userIds = characters.map((c) => c.userId);

    const characterIds = characters.map((c) => c._id);

    type UserProjection = Pick<
      User,
      "_id" | "discordId" | "discordUsername" | "discordAvatar" | "isBanned"
    >;

    // Build unique party lookups by countryId + sequentialId
    const partyLookups: { countryId: CountryId; sequentialId: number }[] = [];
    for (const char of characters) {
      if (char.party && char.party !== "independent") {
        const seqId = Number(char.party);
        if (!isNaN(seqId)) {
          partyLookups.push({
            countryId: (char.countryId ?? "US") as CountryId,
            sequentialId: seqId,
          });
        }
      }
    }

    const [parties, states, userDocs, activeCandidacies] = await Promise.all([
      partyLookups.length > 0
        ? db
            .collection<PoliticalParty>("politicalParties")
            .find({
              $or: partyLookups.map((l) => ({
                countryId: l.countryId,
                sequentialId: l.sequentialId,
              })),
            })
            .toArray()
        : Promise.resolve([]),
      db
        .collection<State>("states")
        .find({ _id: { $in: stateIds } })
        .toArray(),
      db
        .collection<UserProjection>("users")
        .find({ _id: { $in: userIds } })
        .project<UserProjection>({
          _id: 1,
          discordId: 1,
          discordUsername: 1,
          discordAvatar: 1,
          isBanned: 1,
        })
        .toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ characterId: { $in: characterIds }, status: "active" })
        .toArray(),
    ]);

    // Look up the elections for active candidacies to get election type
    const activeElectionIds = (activeCandidacies as ElectionCandidate[]).map((c) => c.electionId);
    const activeElections =
      activeElectionIds.length > 0
        ? await db
            .collection<Pick<Election, "_id" | "electionType" | "state">>("elections")
            .find(
              { _id: { $in: activeElectionIds } },
              { projection: { electionType: 1, state: 1 } }
            )
            .toArray()
        : [];
    type ElectionProjection = { _id: unknown; electionType: string; state: string };
    const electionMap = new Map(
      (activeElections as ElectionProjection[]).map((e) => [String(e._id), e])
    );

    // Key by countryId:sequentialId to handle same sequentialId in different countries
    const partyMap = new Map(
      (parties as PoliticalParty[]).map((p) => [`${p.countryId}:${p.sequentialId}`, p])
    );
    const stateMap = new Map((states as State[]).map((s) => [s._id, s]));
    const userMap = new Map((userDocs as UserProjection[]).map((u) => [u._id!.toString(), u]));
    const candidacyMap = new Map(
      (activeCandidacies as ElectionCandidate[]).map((c) => [c.characterId.toString(), c])
    );

    // CEO lookup - only query corps where these characters are CEO
    // This avoids scanning all corporations for a single profile lookup
    const corporations =
      characterIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ ceoId: { $in: characterIds }, ceoVacant: { $ne: true } })
            .project<{
              _id: import("mongodb").ObjectId;
              name: string;
              ceoId: import("mongodb").ObjectId;
            }>({ _id: 1, name: 1, ceoId: 1 })
            .toArray()
        : [];

    // Build CEO map (characterId -> corp name)
    const ceoCorpMap = new Map<string, string>();
    for (const corp of corporations) {
      if (corp.ceoId) ceoCorpMap.set(corp.ceoId.toString(), corp.name);
    }

    // Get portfolio values and investor rankings from pre-computed snapshot
    // This is generated once per turn and avoids scanning all corporations
    const investorSnapshot = await db
      .collection<InvestorRankingSnapshot>("investorRankingSnapshots")
      .findOne({ _id: "global" });

    const portfolioValues = new Map<string, number>();
    const investorRankMap = new Map<string, number>();

    if (investorSnapshot) {
      // Look up portfolio values for requested characters
      for (const charId of characterIds) {
        const charIdStr = charId.toString();
        const value = investorSnapshot.portfolioValues[charIdStr];
        if (value != null && value > 0) {
          portfolioValues.set(charIdStr, value);
        }
      }

      // Look up rankings for requested characters
      for (const ranking of investorSnapshot.rankings) {
        if (characterIds.some((id) => id.toString() === ranking.characterId)) {
          investorRankMap.set(ranking.characterId, ranking.rank);
        }
      }
    }

    const results = characters
      .filter((char) => {
        const user = userMap.get(char.userId.toString());
        return !user?.isBanned;
      })
      .map((char) => {
        const charCountryId = char.countryId ?? "US";
        const party = partyMap.get(`${charCountryId}:${char.party}`);
        const state = stateMap.get(char.homeState);
        const user = userMap.get(char.userId.toString());

        const candidacy = candidacyMap.get(char._id.toString());
        return {
          id: char._id.toString(),
          name: char.name,
          bio: char.bio ?? null,
          countryId: char.countryId ?? null,
          // Fallback to "Independent" if party not found (avoid numeric party names)
          party: party?.name ?? "Independent",
          partyId: char.party,
          partyColor: party?.color ?? "#666666",
          partyUrl:
            char.party !== "independent"
              ? `${BASE_URL}${partyUrl(char.countryId ?? "US", char.party)}`
              : null,
          state: state?.name ?? char.homeState,
          stateCode: char.homeState,
          stateUrl: `${BASE_URL}/state/${char.homeState}`,
          countryUrl: char.countryId ? `${BASE_URL}/country/${char.countryId}` : null,
          position: getOfficeLabel(char.currentOffice),
          officeType: char.currentOffice?.type ?? null,
          politicalInfluence: char.politicalInfluence ?? 0,
          nationalInfluence: char.nationalInfluence ?? 0,
          favorability: char.favorability ?? 50,
          infamy: char.infamy ?? 0,
          // LOCAL home-currency balance (canonical source of truth).
          funds: char.currencyBalances?.campaign ?? char.funds ?? 0,
          actions: char.actions ?? 0,
          donorBaseLevel: char.donorBaseLevel ?? 0,
          policies: char.policies ?? { economic: 0, social: 0 },
          // Absolutise relative upload paths so Discord embeds can fetch them
          // (locally-stored avatars are persisted as `/api/uploads/avatars/…`).
          avatarUrl: toAbsoluteUploadUrl(char.avatarUrl, BASE_URL),
          discordAvatarUrl:
            user?.discordId && user?.discordAvatar
              ? getDiscordAvatarUrl(user.discordId, user.discordAvatar)
              : null,
          discordUsername: user?.discordUsername ?? null,
          profileUrl: `${BASE_URL}${buildCharacterHref(char)}`,
          createdAt: char.createdAt?.toISOString() ?? null,
          activeElection:
            candidacy && electionMap.has(candidacy.electionId.toString())
              ? {
                  electionId: candidacy.electionId.toString(),
                  electionType: electionMap.get(candidacy.electionId.toString())!.electionType,
                  /*
                   * Office-flavoured label (the bot renders this field with
                   * formatOfficeType, not formatElectionType). Undefined when
                   * the type has no config entry — snap races have none — so
                   * the bot's own fallback map still wins for those.
                   */
                  electionLabel: findOfficeLabel(
                    charCountryId as CountryId,
                    electionMap.get(candidacy.electionId.toString())!.electionType
                  ),
                  electionState: electionMap.get(candidacy.electionId.toString())!.state,
                  enteredAt: candidacy.enteredAt?.toISOString() ?? null,
                }
              : null,
          // Corporation & investment roles
          isCeo: ceoCorpMap.has(char._id.toString()),
          ceoOf: ceoCorpMap.get(char._id.toString()) ?? null,
          isInvestor: portfolioValues.has(char._id.toString()),
          portfolioValue: portfolioValues.get(char._id.toString()) ?? 0,
          investorRank: investorRankMap.get(char._id.toString()) ?? null,
        };
      });

    return NextResponse.json({ found: true, characters: results });
  } catch (error) {
    return handleRouteError(error);
  }
}
