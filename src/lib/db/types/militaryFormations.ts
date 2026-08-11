import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictAssignment } from "@/lib/military/assignments";

/**
 * A country's military org layer. Per-country (keyed by `countryId`). Persisted so
 * the turn processor can read it when resolving battles server-side.
 *
 * The retired `formations` array lived here too. It never worked: every writer of
 * `MilitaryUnit.formationId` set it to null, so a formation's general could never
 * reach battle math. `conflictAssignments` replaces it as the single
 * general↔units↔front binding. `positions` is unrelated and still live.
 */
export interface MilitaryFormationsDoc {
  _id: ObjectId;
  countryId: CountryId;
  /** Per-unit combat role assignments (unitId → role). Written by the Combat Command UI. */
  positions: Record<string, string>;
  /** Generals posted to Conflicts and the units they lead there. Set by each Commanding General. */
  conflictAssignments: ConflictAssignment[];
}
