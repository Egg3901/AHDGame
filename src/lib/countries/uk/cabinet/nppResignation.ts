/**
 * NPP caretaker-minister resignation shell (epic #856, ticket #859).
 *
 * The decision is pure (`./rules/nppResignation.ts`); this module loads the
 * seat, vacates it, and records the flat `ministerResigned` confidence hit —
 * heavier for a Great Office of State, matching the player-resignation flow.
 * UK-only, like every other confidence-gauge writer: the gauge persists on
 * the `ukGovernment` singleton and has no meaning elsewhere.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GovernmentApproval } from "@/lib/db/types";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { GREAT_OFFICE_POSITION_IDS } from "@/lib/uk/confidence/confidenceGauge";
import { applyConfidenceEventToGov } from "@/lib/uk/confidence/confidenceGaugeStore";
import {
  shouldNppMinisterResign,
  type NppResignationInput,
} from "@/lib/uk/cabinet/rules/nppResignation";

export interface NppCaretakerResignationArgs {
  countryId: CountryId;
  /** The caretaker seat's cabinetMembers _id. */
  memberId: ObjectId;
  positionId: string;
  /** Resignation decision inputs (approval + tenure come from the caller). */
  input: NppResignationInput;
  rng: () => number;
  now: Date;
}

export interface NppCaretakerResignationResult {
  resigned: boolean;
}

/**
 * Vacate an NPP caretaker seat when the NPP AI chooses to resign. Guarded by
 * `isNPP` + `_id` so a concurrent dismissal/appointment wins the race and
 * this becomes a no-op rather than a double vacate. The seat is left vacant
 * for the head to re-appoint, mirroring `dismissCaretakerMinister`.
 */
export async function resignNppCaretakerMinister(
  db: Db,
  args: NppCaretakerResignationArgs
): Promise<NppCaretakerResignationResult> {
  const { countryId, memberId, positionId, input, rng, now } = args;
  if (!shouldNppMinisterResign(input, rng)) return { resigned: false };

  const removed = await getCabinetMembersCollection(db).deleteOne({
    _id: memberId,
    countryId,
    isNPP: true,
  });
  if (removed.deletedCount === 0) return { resigned: false };

  // eslint-disable-next-line local/no-country-literals -- the confidence gauge and Great Offices are UK-specific structures (ukGovernment singleton)
  if (countryId === "UK") {
    const greatOffice = GREAT_OFFICE_POSITION_IDS.has(positionId);
    await applyConfidenceEventToGov(db, { kind: "ministerResigned", greatOffice }, now);
  }
  return { resigned: true };
}

/** Read the latest aggregate approval for the resignation rule (UK hook). */
export async function readApprovalForResignation(db: Db, countryId: CountryId): Promise<number> {
  const doc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: countryId });
  return typeof doc?.approvalRating === "number" ? doc.approvalRating : 50;
}
