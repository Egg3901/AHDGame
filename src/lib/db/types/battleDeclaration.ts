import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

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
  targetCountry: CountryId;
  theaterId: string;
  declaredByCharacterId: string | null;
  declaredTurn: number;
  status: BattleDeclarationStatus;
  resolvedTurn?: number;
}
