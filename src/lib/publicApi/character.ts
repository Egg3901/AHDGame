import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Character,
  User,
  PoliticalParty,
  State,
  ElectionCandidate,
  Election,
  Corporation,
  InvestorRankingSnapshot,
  CharacterAchievement,
  Achievement,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getOfficeLabel } from "@/lib/utils/politics";
import { getDiscordAvatarUrl } from "@/lib/discord";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { buildCharacterHref, parseCharacterId } from "@/lib/utils/profileUrls";
import { partyUrl } from "@/lib/urls";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export interface PublicCharacter {
  id: string;
  name: string;
  bio: string | null;
  countryId: string | null;
  party: string;
  partyId: string | null;
  partyColor: string;
  partyUrl: string | null;
  state: string;
  stateCode: string;
  stateUrl: string;
  countryUrl: string | null;
  position: string;
  officeType: string | null;
  politicalInfluence: number;
  nationalInfluence: number;
  favorability: number;
  infamy: number;
  campaignFunds: number;
  cashOnHand: number;
  netWorth: number;
  portfolioValue: number;
  actions: number;
  donorBaseLevel: number;
  policies: { economic: number; social: number };
  avatarUrl: string | null;
  discordAvatarUrl: string | null;
  discordUsername: string | null;
  profileUrl: string;
  createdAt: string | null;
  activeElection: {
    electionId: string;
    electionType: string;
    electionState: string;
    enteredAt: string | null;
  } | null;
  isCeo: boolean;
  ceoOf: string | null;
  isInvestor: boolean;
  investorRank: number | null;
  /** v3 Phase 8: leads a player-run union. See `GET /api/unions/leaderboard` for union-level stats (treasury, membershipPressure). */
  isUnionLeader: boolean;
  unionLeaderOf: string | null;
}

async function enrichPublicCharacters(db: Db, characters: Character[]): Promise<PublicCharacter[]> {
  if (characters.length === 0) return [];

  const stateIds = [...new Set(characters.map((c) => c.homeState))];
  const userIds = characters.map((c) => c.userId);
  const characterIds = characters.map((c) => c._id);

  type UserProjection = Pick<
    User,
    "_id" | "discordId" | "discordUsername" | "discordAvatar" | "isBanned"
  >;

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

  const activeElectionIds = (activeCandidacies as ElectionCandidate[]).map((c) => c.electionId);
  const activeElections =
    activeElectionIds.length > 0
      ? await db
          .collection<Pick<Election, "_id" | "electionType" | "state">>("elections")
          .find({ _id: { $in: activeElectionIds } }, { projection: { electionType: 1, state: 1 } })
          .toArray()
      : [];

  type ElectionProjection = { _id: unknown; electionType: string; state: string };
  const electionMap = new Map(
    (activeElections as ElectionProjection[]).map((e) => [String(e._id), e])
  );
  const partyMap = new Map(
    (parties as PoliticalParty[]).map((p) => [`${p.countryId}:${p.sequentialId}`, p])
  );
  const stateMap = new Map((states as State[]).map((s) => [s._id, s]));
  const userMap = new Map((userDocs as UserProjection[]).map((u) => [u._id!.toString(), u]));
  const candidacyMap = new Map(
    (activeCandidacies as ElectionCandidate[]).map((c) => [c.characterId.toString(), c])
  );

  const corporations =
    characterIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ ceoId: { $in: characterIds }, ceoVacant: { $ne: true } })
          .project<{ _id: ObjectId; name: string; ceoId: ObjectId }>({ _id: 1, name: 1, ceoId: 1 })
          .toArray()
      : [];

  const ceoCorpMap = new Map<string, string>();
  for (const corp of corporations) {
    if (corp.ceoId) ceoCorpMap.set(corp.ceoId.toString(), corp.name);
  }

  const investorSnapshot = (await db
    .collection<{ _id: string }>("investorRankingSnapshots")
    .findOne({ _id: "global" })) as unknown as InvestorRankingSnapshot | null;

  const portfolioValues = new Map<string, number>();
  const investorRankMap = new Map<string, number>();
  if (investorSnapshot) {
    for (const charId of characterIds) {
      const value = investorSnapshot.portfolioValues[charId.toString()];
      if (value != null && value > 0) portfolioValues.set(charId.toString(), value);
    }
    for (const ranking of investorSnapshot.rankings) {
      if (characterIds.some((id) => id.toString() === ranking.characterId)) {
        investorRankMap.set(ranking.characterId, ranking.rank);
      }
    }
  }

  return characters
    .filter((char) => !userMap.get(char.userId.toString())?.isBanned)
    .map((char): PublicCharacter => {
      const charCountryId = char.countryId ?? "US";
      const party = partyMap.get(`${charCountryId}:${char.party}`);
      const state = stateMap.get(char.homeState);
      const user = userMap.get(char.userId.toString());
      const candidacy = candidacyMap.get(char._id.toString());
      // LOCAL home-currency balance (canonical source of truth).
      const campaignFunds = char.currencyBalances?.campaign ?? char.funds ?? 0;
      const cashOnHand = char.cashOnHand ?? 0;
      const portfolioValue = portfolioValues.get(char._id.toString()) ?? 0;

      return {
        id: char._id.toString(),
        name: char.name,
        bio: char.bio ?? null,
        countryId: char.countryId ?? null,
        party: party?.name ?? "Independent",
        partyId: party?._id?.toString() ?? null,
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
        campaignFunds,
        cashOnHand,
        netWorth: campaignFunds + cashOnHand + portfolioValue,
        portfolioValue,
        actions: char.actions ?? 0,
        donorBaseLevel: char.donorBaseLevel ?? 0,
        policies: char.policies ?? { economic: 0, social: 0 },
        avatarUrl: char.avatarUrl ?? null,
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
                electionState: electionMap.get(candidacy.electionId.toString())!.state,
                enteredAt: candidacy.enteredAt?.toISOString() ?? null,
              }
            : null,
        isCeo: ceoCorpMap.has(char._id.toString()),
        ceoOf: ceoCorpMap.get(char._id.toString()) ?? null,
        isInvestor: portfolioValues.has(char._id.toString()),
        investorRank: investorRankMap.get(char._id.toString()) ?? null,
        isUnionLeader: char.unionLeaderOf != null,
        unionLeaderOf: char.unionLeaderOf?.toString() ?? null,
      };
    });
}

export async function queryCharacters(
  db: Db,
  params: { name?: string; discordId?: string }
): Promise<{ found: boolean; characters: PublicCharacter[] }> {
  const { name, discordId } = params;
  let characters: Character[] = [];

  if (discordId) {
    const user = await db.collection<User>("users").findOne({ discordId });
    if (user) {
      const char = await db.collection<Character>("characters").findOne({ userId: user._id });
      if (char) characters = [char];
    }
  } else if (name) {
    characters = await db
      .collection<Character>("characters")
      .find({ name: { $regex: escapeRegex(name), $options: "i" } })
      .limit(5)
      .toArray();
  }

  const results = await enrichPublicCharacters(db, characters);
  return { found: results.length > 0, characters: results };
}

/**
 * Look up one character by public sequentialId or Mongo ObjectId.
 * Shape matches the api-guide `GET /character/[id]` contract.
 */
export async function queryCharacterById(
  db: Db,
  characterId: string
): Promise<{ found: boolean; character: PublicCharacter } | null> {
  const parsed = parseCharacterId(characterId);
  if (!parsed) return null;

  const filter =
    parsed.type === "sequential"
      ? { sequentialId: parsed.value }
      : { _id: new ObjectId(parsed.value) };

  const char = await db.collection<Character>("characters").findOne(filter);
  if (!char) return null;

  const results = await enrichPublicCharacters(db, [char]);
  if (results.length === 0) return null;
  return { found: true, character: results[0] };
}

export async function queryCharacterCareer(
  db: Db,
  characterId: string
): Promise<{
  characterId: string;
  characterName: string;
  career: Array<{
    type: string;
    office: unknown;
    officeLabel: string;
    party: string | null;
    electionId: string | null;
    fromState: string | null;
    toState: string | null;
  }>;
} | null> {
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(characterId) });
  if (!char) return null;

  const career = [...(char.careerHistory ?? [])].reverse().map((event) => ({
    type: event.type as string,
    office: event.office ?? null,
    officeLabel: event.officeLabel,
    party: event.party ?? null,
    electionId: event.electionId ?? null,
    fromState: event.fromState ?? null,
    toState: event.toState ?? null,
  }));

  return { characterId: char._id.toString(), characterName: char.name, career };
}

export async function queryCharacterAchievements(
  db: Db,
  characterId: string
): Promise<{
  characterId: string;
  characterName: string;
  achievements: Array<{
    id: string;
    name: string | null;
    description: string | null;
    icon: string | null;
    category: string | null;
    isHidden: boolean;
    isHighlighted: boolean;
    earnedAt: string | null;
  }>;
} | null> {
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(characterId) });
  if (!char) return null;

  const highlightedIds = new Set<string>((char.highlightedAchievementIds ?? []).map(String));

  const earned = await db
    .collection<CharacterAchievement>("characterAchievements")
    .find({ characterId: char._id })
    .toArray();

  if (earned.length === 0) {
    return { characterId: char._id.toString(), characterName: char.name, achievements: [] };
  }

  const achievementIds = earned.map((e) => e.achievementId);
  const defs = await db
    .collection<Achievement>("achievements")
    .find({ _id: { $in: achievementIds } })
    .toArray();

  const defMap = new Map(defs.map((d) => [d._id.toString(), d]));

  const achievements = earned.map((e) => {
    const def = defMap.get(e.achievementId.toString());
    return {
      id: e.achievementId.toString(),
      name: def?.name ?? null,
      description: def?.description ?? null,
      icon: def?.icon ?? null,
      category: def?.category ?? null,
      isHidden: def?.isHidden ?? false,
      isHighlighted: highlightedIds.has(e.achievementId.toString()),
      earnedAt: e.earnedAt?.toISOString() ?? null,
    };
  });

  return { characterId: char._id.toString(), characterName: char.name, achievements };
}

/**
 * Bulk lookup by public sequential ids (comma-separated, e.g. "1,7,42").
 * Caps at 100 ids per call so a dashboard can hydrate a full view in one
 * request instead of one quota-consuming call per character. Unknown and
 * invalid ids are skipped, not errors: callers match on what came back.
 */
export async function queryCharactersBulk(
  db: Db,
  idsParam: string
): Promise<{ found: boolean; characters: PublicCharacter[]; requested: number; returned: number }> {
  const tokens = idsParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 100);
  const sequentialIds = new Set<number>();
  const objectIds: ObjectId[] = [];
  for (const token of tokens) {
    const parsed = parseCharacterId(token);
    if (parsed?.type === "sequential") sequentialIds.add(parsed.value);
    else if (parsed?.type === "objectId") objectIds.push(new ObjectId(parsed.value));
  }

  const filters = [];
  if (sequentialIds.size > 0) filters.push({ sequentialId: { $in: [...sequentialIds] } });
  if (objectIds.length > 0) filters.push({ _id: { $in: objectIds } });
  const characters =
    filters.length > 0
      ? await db
          .collection<Character>("characters")
          .find(filters.length === 1 ? filters[0] : { $or: filters })
          .limit(100)
          .toArray()
      : [];

  const results = await enrichPublicCharacters(db, characters);
  return {
    found: results.length > 0,
    characters: results,
    requested: tokens.length,
    returned: results.length,
  };
}
