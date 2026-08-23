/**
 * The alliance bar on war: two members of the same bloc cannot fight each other.
 *
 * NATO and the Warsaw Pact are mutual-defence treaties. A declaration by one member
 * against another is not a war the alliance survives, and the game had no gate against
 * it at all — `validateDeclareWar` checked the target, the goal, the cooldown and the
 * truce, and never once compared the two countries' membership.
 *
 * Resolved HERE, once, so the proposal gate, the enactment re-check and the panel that
 * greys the picker all read the same fact. `src/lib/military/bloc.ts` is explicit that
 * nothing in the military system may look a bloc up globally; this is the DB boundary
 * that loads it, exactly as `loadMilitaryBlocs` is for the pure combat functions.
 */
import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { loadBlocMembership, allianceNameFor } from "@/lib/world/blocMembership";
import { blocOf, sharesBloc, type BlocLookup } from "./bloc";

export interface AllianceRoll {
  /** entityId → bloc, from the live roll for the running era. */
  blocs: BlocLookup;
  /** The seed preset the roll was read for, which names the alliance. */
  preset: string;
}

/**
 * The era's bloc roll plus the preset that names its alliances.
 *
 * A single read: `loadMilitaryBlocs` already fetches game state for the preset and then
 * discards it, which is precisely the field a refusal needs in order to say "the Warsaw
 * Pact" rather than "east".
 */
export async function loadAllianceRoll(db: Db): Promise<AllianceRoll> {
  const col = await getGameStateCollection(db);
  const gs = await col.findOne({ _id: "current" }, { projection: { preset: 1 } });
  const preset = gs?.preset ?? DEFAULT_SEED_PRESET;
  return { blocs: await loadBlocMembership(db, preset), preset };
}

/**
 * Every country `source` is allied with, and the alliance that binds them.
 *
 * `alliance` is null when `source` is non-aligned, and `mates` is then empty: the
 * absence of a treaty binds nobody. See `sharesBloc` for why non-alignment is never
 * treated as a bloc of its own.
 */
export function alliesOf(
  roll: AllianceRoll,
  source: string
): { alliance: string | null; mates: string[] } {
  const bloc = blocOf(roll.blocs, source);
  if (bloc === "nonAligned") return { alliance: null, mates: [] };
  const mates = Object.keys(roll.blocs).filter(
    (c) => c !== source && sharesBloc(roll.blocs, source, c)
  );
  return { alliance: allianceNameFor(roll.preset, bloc), mates };
}

/**
 * The alliance binding these two, or null when nothing does.
 *
 * A non-null return is a refusal: the two sit in the same bloc. The string is the
 * alliance's display name where the era has one, falling back to a generic phrase
 * rather than to no refusal at all — the bar is the shared bloc, and it holds whether
 * or not the organisation carries a readable name in this world.
 */
export async function allianceBarBetween(
  db: Db,
  source: string,
  target: string
): Promise<string | null> {
  const roll = await loadAllianceRoll(db);
  if (!sharesBloc(roll.blocs, source, target)) return null;
  return allianceNameFor(roll.preset, blocOf(roll.blocs, source)) ?? "same alliance bloc";
}
