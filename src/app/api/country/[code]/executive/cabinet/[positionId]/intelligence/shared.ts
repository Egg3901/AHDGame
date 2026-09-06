// Shared plumbing for the national-intelligence routes.
//
// The seat gate lives in the PATH, the way every other seat-gated route in this
// repo works (the nuclear console included): `.../cabinet/[positionId]/...`.
// A route without `positionId` could not express "the caller holds this office"
// at all, which is the whole authorization model here.
import { NextResponse } from "next/server";
import type { Db, ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { resolveCabinetOfficeVisibility } from "@/lib/cabinet/officeVisibility";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import { getIntelligenceAgenciesCollection } from "@/lib/db/collections/intelligence";
import type { IntelligenceAgency } from "@/lib/db/types/intelligence";
import {
  COUNTER_INTEL_DEFAULT,
  TRADECRAFT_DEFAULT,
  OP_SLOTS_PER_TURN,
} from "@/lib/intelligence/config";
import { EFFICACY_PIVOT, EFFICACY_SLOPE, NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import type { CharacterStats } from "@/lib/stats/statsConstants";

/** The intelligence seat's id. Identical across every country that has one. */
export const INTELLIGENCE_POSITION_ID = "director_of_intelligence";

export interface IntelligenceRouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

/**
 * The director's contribution to an operation roll.
 *
 * A VACANT seat resolves neutral rather than failing. Vacancy is the common case,
 * not an edge case: most countries have no player director at all, and an agency
 * that simply stopped working would make most of the world inert. `NEUTRAL_STAT`
 * is the same fallback the stat system already uses for characters that predate
 * the stat migration.
 */
export function directorStatMultiplier(stats: CharacterStats | null | undefined): number {
  const intellect = stats?.intellect ?? NEUTRAL_STAT;
  const statecraft = stats?.statecraft ?? NEUTRAL_STAT;
  const mean = (intellect + statecraft) / 2;
  return 1 + EFFICACY_SLOPE * (mean - EFFICACY_PIVOT);
}

/**
 * Shared guard: valid country, the intelligence seat, caller may reach it.
 *
 * `intent: "manage"` is the mutation rule: the seated holder or an admin.
 * `intent: "read"` follows the cabinet office visibility rule, so a head of
 * government who may open the office does not then hit a 403 inside it.
 */
export async function requireIntelligenceHolder(
  code: string,
  positionId: string,
  { intent = "manage" }: { intent?: "manage" | "read" } = {}
) {
  const auth = await requireAuth();
  if (!auth.ok) return { error: auth.response } as const;

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) } as const;
  }
  if (positionId !== INTELLIGENCE_POSITION_ID) {
    return {
      error: NextResponse.json({ error: "Not the intelligence position" }, { status: 404 }),
    } as const;
  }

  const db = await getDb();
  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });

  const { canView, canAct } = await resolveCabinetOfficeVisibility(db, {
    countryId,
    holderCharacterId: member?.characterId ?? null,
    viewerCharacterId: auth.user.character?._id ?? null,
    // Keyed by user, not character: a reigning monarch is an imperial character.
    viewerUserId: auth.user.userId ?? null,
    isAdmin: !!auth.user.isAdmin,
  });

  const permitted = intent === "read" ? canView : canAct;
  if (!permitted) {
    return {
      error: NextResponse.json(
        {
          error:
            intent === "read"
              ? "This office's records are not published outside the office."
              : "Only the intelligence director may direct the service.",
        },
        { status: 403 }
      ),
    } as const;
  }

  // An acting director reads the service but does not set its direction. Every
  // mutation funnels through `intent: "manage"`, so the whole console is covered
  // here once rather than in each route.
  if (intent === "manage") {
    const denied = requireConfirmedSecretary(member, "stance", !!auth.user.isAdmin);
    if (denied) return { error: denied } as const;
  }

  return { db, countryId, member, user: auth.user } as const;
}

interface GameStateSlice {
  currentTurn?: number;
}

export async function loadCurrentTurn(db: Db): Promise<number> {
  const gs = await db
    .collection<GameStateSlice & { _id: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  return gs?.currentTurn ?? 0;
}

/**
 * The country's agency, created on first touch.
 *
 * Lazily created rather than seeded: a country that has never opened the console
 * has nothing worth a row, and seeding one per country per world would write ~24
 * documents nobody reads.
 */
export async function getOrCreateAgency(
  db: Db,
  countryId: CountryId,
  turn: number,
  directorCharacterId: ObjectId | null
): Promise<IntelligenceAgency> {
  const agencies = await getIntelligenceAgenciesCollection(db);
  const existing = await agencies.findOne({ countryId });
  if (existing) {
    // Re-sync the denormalized holder. Cabinet seats change hands, and a stored
    // director id silently goes stale the moment one does: operations would be
    // logged against the previous holder and resolved on their stats. This is
    // the same failure class as the stale corporation `ceoType`.
    const live = directorCharacterId ? String(directorCharacterId) : null;
    const stored = existing.directorCharacterId ? String(existing.directorCharacterId) : null;
    if (live !== stored) {
      await agencies.updateOne(
        { _id: existing._id },
        { $set: { directorCharacterId, updatedAt: new Date() } }
      );
      return { ...existing, directorCharacterId };
    }
    return existing;
  }

  const fresh: Omit<IntelligenceAgency, "_id"> = {
    countryId,
    directorCharacterId,
    tradecraft: TRADECRAFT_DEFAULT,
    counterIntel: COUNTER_INTEL_DEFAULT,
    opSlots: { turn, remaining: OP_SLOTS_PER_TURN },
    foundedTurn: turn,
    updatedAt: new Date(),
  };
  // Upsert rather than insert: two concurrent first touches would otherwise race,
  // and the unique index on countryId would turn the loser into a 500.
  //
  // An upsert is NOT itself atomic against a unique index: two of them can both
  // find nothing and both try to insert, and the loser gets E11000. The fix is
  // the documented one, a single retry, which then matches the row the winner
  // wrote. The turn phase upserts these same rows for NPP countries, so this is
  // a real race and not a theoretical one.
  try {
    await agencies.updateOne({ countryId }, { $setOnInsert: fresh }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    await agencies.updateOne({ countryId }, { $setOnInsert: fresh }, { upsert: true });
  }
  const created = await agencies.findOne({ countryId });
  if (!created) throw new Error(`intelligence agency upsert failed for ${countryId}`);
  return created;
}

/**
 * A target must be a REGISTERED country, not merely a configured one.
 *
 * `COUNTRY_CONFIGS` is static: a country dissolved by a merge is still in it
 * forever. Checking only that map would let a service fund a network inside, and
 * run operations against, a state that no longer exists — and would quietly
 * recreate the very rows the dissolution purge just deleted.
 */
export async function requireRegisteredTarget(db: Db, raw: string, ownerCountryId: CountryId) {
  const targetCountryId = raw.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[targetCountryId]) {
    return {
      error: NextResponse.json({ error: "Invalid target country" }, { status: 400 }),
    } as const;
  }
  if (targetCountryId === ownerCountryId) {
    return {
      error: NextResponse.json(
        { error: "A service cannot work against its own country." },
        { status: 400 }
      ),
    } as const;
  }
  const access = await getCountryAccessFromDb(db, targetCountryId);
  if (access.registered === false) {
    return {
      error: NextResponse.json({ error: "That country no longer exists." }, { status: 404 }),
    } as const;
  }
  return { targetCountryId } as const;
}
