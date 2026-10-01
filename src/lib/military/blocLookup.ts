import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { loadBlocMapData } from "@/lib/world/blocMembership";
import type { BlocLookup } from "./bloc";

export async function loadMilitaryBlocRollForPreset(
  db: Db,
  preset: string
): Promise<{ blocs: BlocLookup; namesByBloc: Record<string, string> }> {
  const { membership: blocs, customBlocs } = await loadBlocMapData(db, preset);
  const namesByBloc = Object.fromEntries(customBlocs.map((bloc) => [bloc.poleId, bloc.label]));
  return { blocs, namesByBloc };
}

/**
 * The bloc roll for the running era, resolved once at a DB boundary and threaded into
 * the pure military functions. The world map uses this same live treaty roll,
 * including player-founded alignment poles.
 *
 * Callers resolve this ONCE per request or per turn tick and pass it down. It is a
 * bounded set of reads; a per-row resolution would re-introduce exactly the
 * global-lookup shape this replaces.
 */
export async function loadMilitaryBlocs(db: Db): Promise<BlocLookup> {
  const col = await getGameStateCollection(db);
  const gs = await col.findOne({ _id: "current" }, { projection: { preset: 1 } });
  return (await loadMilitaryBlocRollForPreset(db, gs?.preset ?? DEFAULT_SEED_PRESET)).blocs;
}
