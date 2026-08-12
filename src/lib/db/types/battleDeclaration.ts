import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

export type BattleDeclarationStatus = "pending" | "resolved" | "fizzled";

/**
 * A declared offensive: one nation commits to attack a specific enemy nation at a
 * theater. Resolves on the turn AFTER `declaredTurn` (the defender's window to
 * reinforce/withdraw), then is marked `resolved` (or `fizzled` if the target had
 * no forces present).
 */
export interface BattleDeclarationDoc {
  _id: ObjectId;
  declarerCountry: CountryId;
  /**
   * The enemy named by this declaration.
   *
   * A `WorldEntityId`, not a `CountryId`: in a proxy war the belligerent on the
   * other side is a FACTION (`sideX.factionEntity`), which is a world entity with no
   * row in `COUNTRY_CONFIGS`. Every real country id is a valid value here too.
   */
  targetCountry: WorldEntityId;
  theaterId: string;
  declaredByCharacterId: string | null;
  declaredTurn: number;
  status: BattleDeclarationStatus;
  resolvedTurn?: number;
}
