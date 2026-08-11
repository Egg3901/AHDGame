import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { loadBlocMembership } from "@/lib/world/blocMembership";
import type { BlocLookup } from "./bloc";

/**
 * The bloc roll for the running era, resolved once at a DB boundary and threaded into
 * the pure military functions — the same shape `src/app/world/page.tsx` already uses to
 * colour the globe, and against the same source of truth.
 *
 * Callers resolve this ONCE per request or per turn tick and pass it down. It is a
 * two-query read, and more importantly a per-call resolution would re-introduce exactly
 * the global-lookup shape this replaces.
 */
export async function loadMilitaryBlocs(db: Db): Promise<BlocLookup> {
  const col = await getGameStateCollection(db);
  const gs = await col.findOne({ _id: "current" }, { projection: { preset: 1 } });
  return loadBlocMembership(db, gs?.preset ?? DEFAULT_SEED_PRESET);
}
