import { getDb } from "@/lib/mongodb";
import type {
  State,
  StateDemographics,
  DemographicCategory,
  StatePartyOrg,
  PoliticalParty,
  ElectedOfficial,
  Character,
  User,
  NPP,
  PartyBudget,
} from "@/lib/db/types";
import { type CountryId } from "@/lib/constants/countries";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { buildRegionTurnoutResponse } from "@/lib/demographics/regionTurnout";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { getRegionalApprovalData } from "@/lib/states/approval/getRegionalApprovalData";

/**
 * Coerce a Mongo timestamp field to an ISO string for client serialization.
 *
 * Documents seeded under the 1991 preset pass through a
 * `JSON.parse(JSON.stringify())` deep-clone (see `applyEra1991DemographicAdjustments`)
 * which turns `Date` fields into ISO strings before they're persisted. Calling
 * `.toISOString()` on those values throws ("not a function") and crashes the
 * region page. Handle both real `Date`s and already-stringified values so the
 * page renders regardless of which preset seeded the world.
 */
export function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

// ── Shared data-fetching helpers ──

export async function getRegionState(stateId: string, countryId: CountryId): Promise<State | null> {
  try {
    const db = await getDb();
    return db.collection<State>("states").findOne({ _id: stateId, countryId });
  } catch (error) {
    console.error("Error fetching region state:", error);
    return null;
  }
}

export async function getUserData() {
  const authData = await getAuthUserWithCharacter();
  if (!authData) return null;

  let homeStateName: string | undefined;
  if (authData.character?.homeState && authData.character.countryId) {
    const db = await getDb();
    const homeState = await db.collection<State>("states").findOne({
      _id: authData.character.homeState,
      countryId: authData.character.countryId,
    });
    homeStateName = homeState?.name;
  }

  return {
    ...authData,
    homeStateName,
    isAdmin: authData.isAdmin ?? false,
  };
}

export async function getCurrentPartyNav(
  character:
    | {
        party?: string | null;
        countryId?: CountryId | null;
      }
    | null
    | undefined
) {
  if (!character?.party || !character.countryId || !Number.isFinite(Number(character.party))) {
    return null;
  }

  const db = await getDb();
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { sequentialId: Number(character.party), countryId: character.countryId },
      { projection: { name: 1, countryId: 1 } }
    );
  if (!party) return null;

  return {
    id: character.party,
    name: party.name,
    countryId: party.countryId,
  };
}

export async function getRegionDemographics(stateId: string, countryId: CountryId) {
  try {
    const db = await getDb();
    // Each country has its own demographic category IDs
    const COUNTRY_CATEGORY_IDS: Partial<Record<CountryId, string[]>> = {
      UK: ["uk_voterGroups"],
      JP: ["jp_voterGroups"],
      DE: ["de_voterGroups"],
      IE: ["ie_voterGroups"],
      CN: ["cn_voterGroups"],
      BR: ["br_voterGroups"],
      // Seceded nations share the UK archetype profile (uk_archetypes), so their
      // sub-region demographics are keyed by the uk_voterGroups category. Without
      // this they fall through to find({}) and pick the wrong voterGroups doc.
      SCO: ["uk_voterGroups"],
      WAL: ["uk_voterGroups"],
    };
    const categoryFilter = COUNTRY_CATEGORY_IDS[countryId];

    const [demographics, categories] = await Promise.all([
      db
        .collection<StateDemographics>("stateDemographics")
        .findOne({ _id: stateId, countryId: countryId }),
      categoryFilter
        ? db
            .collection<DemographicCategory>("demographicCategories")
            .find({ _id: { $in: categoryFilter } })
            .toArray()
        : db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
    ]);
    return { demographics, categories };
  } catch (error) {
    console.error("Error fetching demographics:", error);
    return { demographics: null, categories: [] };
  }
}

export async function getRegionTurnout(stateId: string, countryId: CountryId) {
  try {
    // SSOT shared with GET /api/country/[code]/region/[id]/turnout. Queries by
    // `_id` only (legacy US docs predate the countryId field) and falls back to
    // baselines when a region has no document, so the turnout tab always fills.
    return await buildRegionTurnoutResponse(stateId, countryId);
  } catch (error) {
    console.error("Error fetching turnout:", error);
    return null;
  }
}

export async function getStatePartyBudgets(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId,
  stateId: string
) {
  // Phase 2: surface the state-scope GOTV / Suppression / OrgBuilding
  // percentages each party has set in this state, indexed by partyId.
  // Mutation lives canonically on the State Party page; the Politics
  // tab only displays + deep-links.
  try {
    const rows = await db
      .collection<PartyBudget>("partyBudget")
      .find({ countryId, scope: "state", stateId })
      .toArray();
    const out: Record<
      string,
      {
        gotvBudgetPercent: number;
        gotvTargetCategory?: string;
        gotvTargetGroup?: string;
        suppressionBudgetPercent: number;
        suppressionTargetCategory?: string;
        suppressionTargetGroup?: string;
        orgBuildingPercent: number;
      }
    > = {};
    for (const r of rows) {
      const partyId = String(r.partyId ?? "");
      if (!partyId) continue;
      out[partyId] = {
        gotvBudgetPercent: Number(r.gotvBudgetPercent ?? 0),
        gotvTargetCategory: r.gotvTargetCategory,
        gotvTargetGroup: r.gotvTargetGroup,
        suppressionBudgetPercent: Number(r.suppressionBudgetPercent ?? 0),
        suppressionTargetCategory: r.suppressionTargetCategory,
        suppressionTargetGroup: r.suppressionTargetGroup,
        orgBuildingPercent: Number(r.orgBuildingPercent ?? 0),
      };
    }
    return out;
  } catch (error) {
    console.error("Error fetching state party budgets:", error);
    return {};
  }
}

export async function getRegionPartyOrg(stateId: string, countryId: CountryId) {
  try {
    const db = await getDb();
    const partyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ stateId })
      .toArray();

    const partyIds = [...new Set(partyOrg.map((po) => po.partyId))];
    const partySeqIds = partyIds.map(Number).filter(Boolean);
    const parties = partySeqIds.length
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({ sequentialId: { $in: partySeqIds }, countryId })
          .toArray()
      : [];
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    // Batch-fetch chair characters so each state-party card can surface its
    // chair's name without an N+1 query per party.
    const chairIds = partyOrg
      .map((po) => po.chairId)
      .filter((id): id is NonNullable<typeof id> => id != null);
    const chairs = chairIds.length
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: chairIds } })
          .project<{ _id: (typeof chairIds)[number]; name: string; sequentialId?: number }>({
            _id: 1,
            name: 1,
            sequentialId: 1,
          })
          .toArray()
      : [];
    const chairById = new Map(
      chairs.map((c) => [c._id.toString(), { name: c.name, seqId: c.sequentialId }] as const)
    );

    return partyOrg
      .filter((po) => partyMap.has(po.partyId))
      .map((po) => {
        const party = partyMap.get(po.partyId);
        const chairIdStr = po.chairId?.toString();
        const chair = chairIdStr ? chairById.get(chairIdStr) : undefined;
        return {
          ...po,
          countryId,
          partyName: party?.name || po.partyId,
          partyAbbreviation: party?.abbreviation || "???",
          partyColor: party?.color || "#888888",
          isDefault: party?.isDefault ?? false,
          chairName: chair?.name,
          chairCharacterId: chair?.seqId ? String(chair.seqId) : chairIdStr,
        };
      });
  } catch (error) {
    console.error("Error fetching region party org:", error);
    return [];
  }
}

export interface RegionApprovalData {
  approval: number;
  baseApproval: number;
  modifiers: ActiveModifier[];
}

export async function getRegionGovernmentApproval(
  stateId: string,
  countryId: CountryId
): Promise<RegionApprovalData | null> {
  try {
    const db = await getDb();
    return getRegionalApprovalData(db, countryId, stateId);
  } catch {
    return null;
  }
}

export async function getRegionPlayers(stateId: string) {
  try {
    const db = await getDb();
    const players = await db
      .collection<Character>("characters")
      .find({ homeState: stateId })
      .sort({ name: 1 })
      .toArray();

    const userIds = players.map((p) => p.userId);
    const users = await db
      .collection<User>("users")
      .find({ _id: { $in: userIds } })
      .project<
        Pick<
          User,
          "_id" | "isBanned" | "patreonProfileBorder" | "patreonHighlightColor" | "role" | "isAdmin"
        >
      >({
        _id: 1,
        isBanned: 1,
        patreonProfileBorder: 1,
        patreonHighlightColor: 1,
        role: 1,
        isAdmin: 1,
      })
      .toArray();
    const bannedUserIds = new Set(users.filter((u) => u.isBanned).map((u) => u._id.toString()));
    const userDataMap = new Map(
      users.map((u) => [
        u._id.toString(),
        {
          borderKey: u.patreonProfileBorder ?? null,
          tintColor: u.patreonHighlightColor ?? null,
          isAdmin: u.isAdmin === true || u.role === "admin",
          isModerator: u.role === "moderator" || u.role === "admin" || u.isAdmin === true,
        },
      ])
    );

    return players
      .filter((p) => !bannedUserIds.has(p.userId.toString()))
      .map((p) => {
        const userData = userDataMap.get(p.userId.toString());
        return Object.assign(p, {
          borderKey: userData?.borderKey ?? null,
          tintColor: userData?.tintColor ?? null,
          isAdmin: userData?.isAdmin ?? false,
          isModerator: userData?.isModerator ?? false,
        });
      });
  } catch (error) {
    console.error("Error fetching region players:", error);
    return [];
  }
}

export async function getRegionNPPs(stateId: string, countryId: CountryId) {
  try {
    const db = await getDb();
    const npps = await db
      .collection<NPP>("npps")
      .find({ homeState: stateId, retiredAt: null })
      .sort({ name: 1 })
      .toArray();

    const partyIds = [...new Set(npps.map((n) => n.party).filter(Boolean))];
    const partySeqIds = partyIds.map(Number).filter(Boolean);
    const parties = partySeqIds.length
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({ sequentialId: { $in: partySeqIds }, countryId })
          .toArray()
      : [];
    const partyMap = new Map(
      parties.map((p) => [String(p.sequentialId), { name: p.name, color: p.color }])
    );

    return npps.map((npp) => ({
      ...npp,
      partyName: npp.party ? partyMap.get(npp.party)?.name : undefined,
      partyColor: npp.party ? partyMap.get(npp.party)?.color : undefined,
    }));
  } catch (error) {
    console.error("Error fetching region NPPs:", error);
    return [];
  }
}

export async function getRegionOfficials(stateId: string, countryId: CountryId) {
  try {
    const db = await getDb();
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: stateId.toUpperCase() })
      .sort({ officeType: 1, senateClass: 1, seatsHeld: -1 })
      .toArray();

    const characterIds = officials.filter((o) => o.characterId).map((o) => o.characterId!);
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: characterIds } })
      .toArray();
    const userIds = characters.map((c) => c.userId);
    const users = await db
      .collection<User>("users")
      .find({ _id: { $in: userIds } })
      .project<Pick<User, "_id" | "isBanned" | "patreonProfileBorder" | "patreonHighlightColor">>({
        _id: 1,
        isBanned: 1,
        patreonProfileBorder: 1,
        patreonHighlightColor: 1,
      })
      .toArray();
    const bannedUserIds = new Set(users.filter((u) => u.isBanned).map((u) => u._id.toString()));
    const bannedCharacterIds = new Set(
      characters.filter((c) => bannedUserIds.has(c.userId.toString())).map((c) => c._id.toString())
    );
    const characterMap = new Map(characters.map((c) => [c._id.toString(), c]));
    const officialUserBorderMap = new Map(
      users.map((u) => [
        u._id.toString(),
        { borderKey: u.patreonProfileBorder ?? null, tintColor: u.patreonHighlightColor ?? null },
      ])
    );

    const nppIds = officials.filter((o) => o.nppId).map((o) => o.nppId!);
    const npps = await db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppIds } })
      .toArray();
    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

    const partyIds = [...new Set(officials.map((o) => o.party).filter(Boolean))] as string[];
    const partySeqIds = partyIds.map(Number).filter(Boolean);
    const parties = partySeqIds.length
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .find({ sequentialId: { $in: partySeqIds }, countryId })
          .toArray()
      : [];
    const partyAbbrev = new Map(
      parties.map((p) => [String(p.sequentialId), p.abbreviation ?? String(p.sequentialId)])
    );
    const partyColorMap = new Map(parties.map((p) => [String(p.sequentialId), p.color]));
    const partyNameMap = new Map(parties.map((p) => [String(p.sequentialId), p.name]));

    const filteredOfficials = officials.map((official) => {
      if (official.characterId && bannedCharacterIds.has(official.characterId.toString())) {
        return {
          ...official,
          characterId: null,
          characterName: undefined,
          party: undefined,
          avatarUrl: undefined,
          borderKey: null,
          tintColor: null,
          partyAbbreviation: undefined,
          partyColor: undefined,
          characterSequentialId: undefined,
          nppSequentialId: undefined,
        };
      }

      let avatarUrl: string | undefined;
      let characterSequentialId: number | undefined;
      let nppSequentialId: number | undefined;
      let borderKey: string | null = null;
      let tintColor: string | null = null;
      if (official.characterId) {
        const char = characterMap.get(official.characterId.toString());
        avatarUrl = char?.avatarUrl;
        characterSequentialId = char?.sequentialId;
        if (char?.userId) {
          const border = officialUserBorderMap.get(char.userId.toString());
          borderKey = border?.borderKey ?? null;
          tintColor = border?.tintColor ?? null;
        }
      } else if (official.nppId) {
        const npp = nppMap.get(official.nppId.toString());
        avatarUrl = npp?.avatarUrl;
        nppSequentialId = npp?.sequentialId;
      }
      const partyAbbreviation = official.party
        ? (partyAbbrev.get(official.party) ?? official.party)
        : undefined;
      const partyColor = official.party ? partyColorMap.get(official.party) : undefined;
      const partyName = official.party ? partyNameMap.get(official.party) : undefined;
      const displayName = official.nppId
        ? (nppMap.get(official.nppId.toString())?.name ?? official.characterName)
        : official.characterName;
      return {
        ...official,
        avatarUrl,
        borderKey,
        tintColor,
        partyAbbreviation,
        partyColor,
        partyName,
        characterName: displayName ?? official.characterName,
        characterSequentialId,
        nppSequentialId,
      };
    });

    return filteredOfficials;
  } catch (error) {
    console.error("Error fetching region officials:", error);
    return [];
  }
}

// ── Serializers ──

export function serializePartyOrg(
  partyOrg: Awaited<ReturnType<typeof getRegionPartyOrg>>,
  includeChairs: boolean
) {
  return partyOrg.map((po) => {
    return {
      _id: po._id,
      stateId: po.stateId,
      partyId: po.partyId,
      countryId: po.countryId,
      organization: po.organization,
      politicalStrength: po.politicalStrength,
      ...(includeChairs
        ? {
            chairId: po.chairId?.toString() || null,
            viceChairId: po.viceChairId?.toString() || null,
            treasurerId: po.treasurerId?.toString() || null,
            createdAt: po.createdAt?.toISOString() || null,
            updatedAt: po.updatedAt?.toISOString() || null,
          }
        : {}),
      partyName: po.partyName,
      partyAbbreviation: po.partyAbbreviation,
      partyColor: po.partyColor,
      isDefault: po.isDefault,
      chairName: po.chairName,
      chairCharacterId: po.chairCharacterId,
    };
  });
}
