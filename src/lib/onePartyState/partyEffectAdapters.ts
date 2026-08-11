/**
 * Thin adapters between decision-event handlers and the underlying
 * party / purge collections. Keeps the handler code declarative —
 * "ban this party", "record a purge" — without each handler
 * re-discovering the storage shape.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import type { PurgeEvent, PurgeSeverity } from "@/lib/turn/rulingPartyPriorities";

export interface RecordPurgeEventInput {
  severity: PurgeSeverity;
  /**
   * Purge category. `"anticorruption"` is treated as a popular benefit
   * by the per-turn driver (no popularLegitimacy cost). Phase 4
   * default-action and crackdown decisions use `"discipline"`; faction
   * negotiation uses `"faction"`; reform-action anti-corruption uses
   * `"anticorruption"`.
   */
  kind: "discipline" | "anticorruption" | "faction" | "ideological";
  reason: string;
  turn: number;
  targetCount?: number;
}

/**
 * Insert a row into the `rulingPartyPurgeEvents` collection so the
 * per-turn confidence + popular drivers pick it up on their next tick.
 * The new `kind` field is read by `popularLegitimacyDrivers.repressionIntensityDrift`.
 */
export async function recordPurgeEvent(
  db: Db,
  countryId: CountryId,
  input: RecordPurgeEventInput
): Promise<void> {
  // PurgeEvent.kind isn't on the type yet (legacy schema) — write the
  // field anyway since the popular-driver's `mapPurgeEventsToInput`
  // defaults missing kinds to "discipline" and existing readers ignore
  // unknown fields. Phase 4 also reads kind via the new collector.
  await db.collection<PurgeEvent & { kind: string }>("rulingPartyPurgeEvents").insertOne({
    _id: new ObjectId().toString(),
    countryId,
    severity: input.severity,
    kind: input.kind,
    reason: input.reason,
    turn: input.turn,
    targetCount: input.targetCount,
    processed: false,
    createdAt: new Date(),
  });
}

/**
 * Flip a party's regimeStatus from `banned` → `approved`. Used by
 * Stage 2's "selective concession" decision and Phase 5's "legalize a
 * banned party" reform action.
 *
 * No-op when the party doesn't exist or isn't currently banned.
 */
export async function legalizeBannedParty(
  db: Db,
  countryId: CountryId,
  partyId: number
): Promise<void> {
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { sequentialId: partyId, countryId, regimeStatus: "banned" },
      { $set: { regimeStatus: "approved", updatedAt: new Date() } }
    );
}

/**
 * Flip a party's regimeStatus to `banned`. Used by Stage 3's "purge
 * the defectors" decision and Stage 4's "resist" (which bans every
 * approved party). Does NOT touch the ruling party — caller
 * responsibility to scope the partyId.
 */
export async function banApprovedParty(
  db: Db,
  countryId: CountryId,
  partyId: number
): Promise<void> {
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { sequentialId: partyId, countryId, regimeStatus: "approved" },
      { $set: { regimeStatus: "banned", updatedAt: new Date() } }
    );
}

/**
 * Bulk-ban every party in the country whose regimeStatus is
 * `"approved"`. Used by Stage 4's "resist" decision.
 */
export async function banAllApprovedParties(db: Db, countryId: CountryId): Promise<void> {
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateMany(
      { countryId, regimeStatus: "approved" },
      { $set: { regimeStatus: "banned", updatedAt: new Date() } }
    );
}
