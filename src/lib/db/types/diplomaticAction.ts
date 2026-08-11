import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * A country's diplomatic-action budget for the International Organizations page.
 * One document per country. The budget refreshes lazily: any read/spend for a
 * turn newer than `turn` treats the budget as full, so no global turn-loop hook
 * is required.
 */
export interface DiplomaticActionBudget {
  _id: ObjectId;
  countryId: CountryId;
  /** Turn that `remaining` is valid for. */
  turn: number;
  /** Actions left this turn (0..DIPLOMATIC_ACTIONS_PER_TURN). */
  remaining: number;
  updatedAt: Date;
}
