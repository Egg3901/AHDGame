/**
 * Seat data for wiki seat pages. Each seat is a distinct office:
 * - governor: state governor
 * - senate-class-1|2|3: US Senate seat by class
 * - house: state's House delegation (lumped)
 */
import { getDb } from "@/lib/mongodb";
import type { State, ElectedOfficial, Character, NPP, PoliticalParty } from "@/lib/db/types";
import { SENATE_CLASSES } from "@/lib/constants";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";

export type SeatSlugType = "governor" | "senate" | "house";

export interface SeatSlug {
  slug: string;
  stateId: string;
  type: SeatSlugType;
  senateClass?: 1 | 2 | 3;
}

export interface SeatHolder {
  id: string;
  name: string;
  party: string | null;
  partyAbbreviation: string | null;
  partyColor: string | null;
  avatarUrl: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
  isNPP: boolean;
  profileHref: string | null; // /character/[id] for character, /politicians/npp/[id] for NPP
}

export interface SeatData {
  slug: string;
  title: string;
  stateId: string;
  stateName: string;
  countryId?: string;
  type: SeatSlugType;
  senateClass?: 1 | 2 | 3;
  holders: SeatHolder[];
  houseSeatCount?: number;
}

function slugToStateAndType(
  slug: string
): { stateId: string; type: SeatSlugType; senateClass?: 1 | 2 | 3 } | null {
  const match = slug.match(/^([a-z0-9_]+)-(governor|senate-class-[123]|house)$/);
  if (!match) return null;
  const [, stateId, typePart] = match;
  const stateIdUpper = stateId.toUpperCase();
  if (typePart === "governor") return { stateId: stateIdUpper, type: "governor" };
  if (typePart === "house") return { stateId: stateIdUpper, type: "house" };
  const classMatch = typePart.match(/^senate-class-([123])$/);
  if (classMatch)
    return {
      stateId: stateIdUpper,
      type: "senate",
      senateClass: Number(classMatch[1]) as 1 | 2 | 3,
    };
  return null;
}

export async function getAllSeatSlugs(): Promise<SeatSlug[]> {
  const db = await getDb();
  const states = await db
    .collection<State>("states")
    .find({
      $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
    })
    .toArray();
  const slugs: SeatSlug[] = [];
  for (const state of states) {
    const sid = state._id.toLowerCase();
    slugs.push({ slug: `${sid}-governor`, stateId: state._id, type: "governor" });
    const classes = SENATE_CLASSES[state._id] ?? [1, 2];
    for (const c of classes) {
      slugs.push({
        slug: `${sid}-senate-class-${c}`,
        stateId: state._id,
        type: "senate",
        senateClass: c,
      });
    }
    slugs.push({ slug: `${sid}-house`, stateId: state._id, type: "house" });
  }
  return slugs;
}

export async function getSeatData(slug: string): Promise<SeatData | null> {
  const parsed = slugToStateAndType(slug);
  if (!parsed) return null;

  const db = await getDb();
  // This API only resolves US state-level offices (governor/house) — scope the
  // lookup to US to avoid cross-country state-ID collisions.
  const state = await db
    .collection<State>("states")
    .findOne({ _id: parsed.stateId, countryId: "US" });
  if (!state) return null;

  let officials: ElectedOfficial[];
  if (parsed.type === "governor") {
    officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: parsed.stateId, officeType: "governor" })
      .toArray();
  } else if (parsed.type === "senate" && parsed.senateClass) {
    officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: parsed.stateId, officeType: "senate", senateClass: parsed.senateClass })
      .toArray();
  } else {
    officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: parsed.stateId, officeType: "house" })
      .toArray();
  }

  const characterIds = officials.filter((o) => o.characterId).map((o) => o.characterId!);
  const nppIds = officials.filter((o) => o.nppId).map((o) => o.nppId!);
  const [characters, npps, parties] = await Promise.all([
    characterIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } })
          .toArray()
      : [],
    nppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray()
      : [],
    // Filter parties by country derived from state to avoid cross-country collisions
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: state.countryId })
      .toArray(),
  ]);

  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
  // Safe: parties already filtered by countryId at query level (line 127)
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  const holders: SeatHolder[] = officials.map((o) => {
    const isNPP = o.isNPP ?? !!o.nppId;
    const entityId = (o.characterId ?? o.nppId)?.toString();
    const char = o.characterId ? charMap.get(o.characterId.toString()) : null;
    const npp = o.nppId ? nppMap.get(o.nppId.toString()) : null;
    const name = o.characterName ?? char?.name ?? npp?.name ?? "Vacant";
    const party = o.party ?? char?.party ?? npp?.party ?? null;
    const p = party ? partyMap.get(party) : null;
    const profileHref = entityId
      ? isNPP
        ? npp
          ? buildNppHref(npp)
          : `/politicians/npp/${entityId}`
        : char
          ? buildCharacterHref(char)
          : `/character/${entityId}`
      : null;
    return {
      id: entityId ?? "",
      name,
      party,
      partyAbbreviation: p?.abbreviation ?? party ?? null,
      partyColor: p?.color ?? null,
      avatarUrl: char?.avatarUrl ?? npp?.avatarUrl ?? null,
      borderKey: char?.borderKey ?? npp?.borderKey ?? null,
      tintColor: char?.tintColor ?? npp?.tintColor ?? null,
      isNPP,
      profileHref,
    };
  });

  let title: string;
  if (parsed.type === "governor") {
    title = `${state.name} Governor`;
  } else if (parsed.type === "senate" && parsed.senateClass) {
    title = `${state.name} Senate Class ${parsed.senateClass}`;
  } else {
    const count = officials.length;
    title = `${state.name} House Delegation${count > 1 ? ` (${count} seats)` : ""}`;
  }

  return {
    slug,
    title,
    stateId: state._id,
    stateName: state.name,
    countryId: state.countryId ?? "US",
    type: parsed.type,
    senateClass: parsed.senateClass,
    holders,
    houseSeatCount: parsed.type === "house" ? officials.length : undefined,
  };
}
