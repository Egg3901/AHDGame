/**
 * Leadership data for wiki leadership pages.
 */
import { getDb } from "@/lib/mongodb";
import type { CongressLeader, Character, NPP, PoliticalParty } from "@/lib/db/types";
import { LEADERSHIP_ROLES } from "@/lib/congress/leadershipRoles";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";

export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number]["role"];

export interface LeadershipHolder {
  entityId: string | null;
  name: string;
  party: string | null;
  partyName: string;
  partyColor: string;
  state?: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  isVacant: boolean;
  /** /character/[id] or /politicians/npp/[id] */
  profileHref: string | null;
}

export interface LeadershipData {
  role: LeadershipRole;
  label: string;
  chamber: "house" | "senate";
  holder: LeadershipHolder;
}

export async function getAllLeadershipSlugs(): Promise<{ role: LeadershipRole }[]> {
  return LEADERSHIP_ROLES.map((r) => ({ role: r.role }));
}

export async function getLeadershipData(role: string): Promise<LeadershipData | null> {
  const entry = LEADERSHIP_ROLES.find((r) => r.role === role);
  if (!entry) return null;

  const db = await getDb();
  const doc = await db.collection<CongressLeader>("congressLeaders").findOne({ role: entry.role });
  // Congress leadership is US-only, so filter parties by US countryId
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "US" })
    .toArray();
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const vacant = !doc?.characterId;
  const party = doc?.party ?? null;
  const p = party ? partyMap.get(party) : null;

  let state: string | undefined;
  let avatarUrl: string | undefined;
  let borderKey: string | null | undefined;
  let tintColor: string | null | undefined;
  let profileHref: string | null = null;
  if (doc?.characterId) {
    const char = await db
      .collection<Character>("characters")
      .findOne(
        { _id: doc.characterId },
        { projection: { homeState: 1, avatarUrl: 1, borderKey: 1, tintColor: 1, sequentialId: 1 } }
      );
    if (char) {
      state = char.homeState;
      avatarUrl = char.avatarUrl;
      borderKey = char.borderKey;
      tintColor = char.tintColor;
      profileHref = buildCharacterHref(char);
    } else {
      const npp = await db.collection<NPP>("npps").findOne(
        { _id: doc.characterId },
        {
          projection: { homeState: 1, avatarUrl: 1, borderKey: 1, tintColor: 1, sequentialId: 1 },
        }
      );
      if (npp) {
        state = npp.homeState;
        avatarUrl = npp.avatarUrl;
        borderKey = npp.borderKey;
        tintColor = npp.tintColor;
        profileHref = buildNppHref(npp);
      }
    }
  }

  const partyColor = p?.color ?? "#888888";

  return {
    role: entry.role,
    label: entry.label,
    chamber: entry.chamber,
    holder: {
      entityId: doc?.characterId?.toString() ?? null,
      name: doc?.characterName ?? "Vacant",
      party,
      partyName: p?.name ?? (party === "independent" ? "Independent" : (party ?? "—")),
      partyColor,
      state,
      avatarUrl,
      borderKey,
      tintColor,
      isVacant: vacant,
      profileHref,
    },
  };
}
