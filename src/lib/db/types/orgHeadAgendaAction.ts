import type { ObjectId } from "mongodb";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";

/**
 * The personal agenda pool of an organisation's head (Secretary-General,
 * President of the European Council, ...). One document per (organisation,
 * holder), so a new head starts a fresh pool. Refreshes lazily: a row written on
 * an older turn reads as `remaining` plus the per-turn accrual for every turn
 * since, clamped to the bank cap, so no turn phase is needed.
 */
export interface OrgHeadAgendaPool {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  characterId: ObjectId;
  /** Turn that `remaining` was valid for. */
  turn: number;
  /** Agenda actions banked as of `turn` (0..ORG_HEAD_AGENDA_ACTION_CAP). */
  remaining: number;
  updatedAt: Date;
}
