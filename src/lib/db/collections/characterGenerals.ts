import type { Db } from "mongodb";
import { type CharacterGeneralDoc, isCommissioned } from "@/lib/db/types/characterGeneral";
import {
  type ProfileGeneral,
  commanderFitFromGeneral,
  learnedOf,
} from "@/lib/military/generalsTree";
import type { CommanderRef } from "@/lib/military/types";
import { deriveSpec, specLabelOf } from "@/lib/military/deriveSpec";
import { getCharactersCollection } from "@/lib/db/collections/characters";
import type { CountryId } from "@/lib/constants/countries";

export function getCharacterGeneralsCollection(db: Db) {
  return db.collection<CharacterGeneralDoc>("characterGenerals");
}

/**
 * Every commissioned general in a country, keyed by the owning characterId.
 *
 * The authoritative source of general stats for battle math. Resolve through this —
 * never trust a general supplied by a client, which is exactly how the retired
 * `Formation.general` (`z.any()` on the formations route) could be fabricated.
 */
export async function loadGeneralsById(
  db: Db,
  countryId: string
): Promise<Record<string, ProfileGeneral>> {
  const chars = await (
    await getCharactersCollection(db)
  )
    .find({ countryId: countryId as CountryId })
    .project({ _id: 1 })
    .toArray();
  if (chars.length === 0) return {};
  const gens = await getCharacterGeneralsCollection(db)
    .find({ characterId: { $in: chars.map((c) => String(c._id)) } })
    .toArray();
  // Only live, specced commissions reach battle math. Without this a dismissed
  // general would keep buffing the units they led.
  return Object.fromEntries(
    gens
      .filter((g) => isCommissioned(g) && g.general)
      .map((g) => [g.characterId, g.general as NonNullable<typeof g.general>])
  );
}

/**
 * The country's commissioned generals as lightweight commander refs (id = the owning
 * character's id) — the pool a defense leader assigns as command commanders.
 */
export async function listCountryGenerals(db: Db, countryId: string): Promise<CommanderRef[]> {
  const chars = await (
    await getCharactersCollection(db)
  )
    .find({ countryId: countryId as CountryId })
    .project({ _id: 1, name: 1 })
    .toArray();
  if (chars.length === 0) return [];
  const nameById = new Map(chars.map((c) => [String(c._id), c.name as string]));
  const gens = await getCharacterGeneralsCollection(db)
    .find({ characterId: { $in: chars.map((c) => String(c._id)) } })
    .toArray();
  // A dismissed character (or a legacy profile-less doc) is not an assignable commander.
  return gens
    .filter((g) => isCommissioned(g) && g.general)
    .map((g) => {
      const gen = g.general as NonNullable<typeof g.general>;
      return {
        id: g.characterId,
        name: gen.name ?? nameById.get(g.characterId) ?? "Unknown",
        // Derived from what they trained, not stored — and "No specialisation" rather than
        // a discipline they never earned when they have trained nothing.
        spec: specLabelOf(deriveSpec(learnedOf(gen))),
        level: gen.level,
        fit: commanderFitFromGeneral(gen),
      };
    });
}

/**
 * A character's standing in the corps: whether they hold a commission, and their
 * profile (which is retained after dismissal, for re-appointment).
 *
 * Callers that gate on being a general must read `commissioned`, not merely the
 * presence of `general` — a dismissed veteran still has a profile.
 */
export async function getCharacterCommission(
  db: Db,
  characterId: string
): Promise<{ commissioned: boolean; general: ProfileGeneral | null }> {
  const doc = await getCharacterGeneralsCollection(db).findOne({ characterId });
  if (!doc) return { commissioned: false, general: null };
  return { commissioned: isCommissioned(doc), general: doc.general ?? null };
}

/** A member of a country's general corps. `spec` is their derived best-fit label. */
export interface CorpsMember {
  characterId: string;
  name: string;
  /** "dismissed" keeps the record for re-appointment. */
  state: "serving" | "dismissed";
  spec?: string;
  level?: number;
  /** Cumulative career XP — the roster derives rank progress from it. */
  xp?: number;
}

/**
 * A country's general corps for the defense holder's roster: everyone with a
 * commission record, serving or dismissed.
 *
 * Distinct from `listCountryGenerals`, which is the *assignable* pool and therefore
 * excludes the dismissed. This is the SecDef's personnel view, so it must show both —
 * a dismissed veteran is exactly who you might re-appoint.
 */
export async function listCountryCorps(db: Db, countryId: string): Promise<CorpsMember[]> {
  const chars = await (
    await getCharactersCollection(db)
  )
    .find({ countryId: countryId as CountryId })
    .project({ _id: 1, name: 1 })
    .toArray();
  if (chars.length === 0) return [];
  const nameById = new Map(chars.map((c) => [String(c._id), c.name as string]));
  const docs = await getCharacterGeneralsCollection(db)
    .find({ characterId: { $in: chars.map((c) => String(c._id)) } })
    .toArray();
  return docs.map((d) => ({
    characterId: d.characterId,
    name: d.general?.name ?? nameById.get(d.characterId) ?? "Unknown",
    state: isCommissioned(d) ? "serving" : "dismissed",
    spec: d.general ? specLabelOf(deriveSpec(learnedOf(d.general))) : undefined,
    level: d.general?.level,
    xp: d.general?.xp,
  }));
}

/**
 * Characters of a country the defense holder could commission — everyone without a
 * live commission. A dismissed veteran is a candidate again (re-appointment restores
 * their record), so only live commissions are excluded.
 */
export async function listCommissionCandidates(
  db: Db,
  countryId: string
): Promise<{ characterId: string; name: string }[]> {
  const chars = await (
    await getCharactersCollection(db)
  )
    .find({ countryId: countryId as CountryId })
    .project({ _id: 1, name: 1 })
    .toArray();
  if (chars.length === 0) return [];
  const docs = await getCharacterGeneralsCollection(db)
    .find({ characterId: { $in: chars.map((c) => String(c._id)) } })
    .toArray();
  const held = new Set(docs.filter(isCommissioned).map((d) => d.characterId));
  return chars
    .filter((c) => !held.has(String(c._id)))
    .map((c) => ({ characterId: String(c._id), name: c.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
