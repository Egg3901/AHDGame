import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { PoliticalParty, StatePartyOrg, TreasuryTransaction } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import type { OrgBuildFundingScope } from "@/lib/politicalStrength/buildOrgFunding";

/**
 * Cash side of the Build Org action — the money counterpart to
 * `spendPoliticalStrength`.
 *
 * Charges the treasury of the SAME tier that pays the PS: a `state`-scope click
 * debits `statePartyOrg.treasury`, a national-scope click debits
 * `politicalParties.treasury`. The price itself is computed by
 * `orgBuildCashPrice` / `resolveOrgBuildFunding`; this command only moves it.
 *
 * **Never overdraws, never hard-fails.** The debit runs as an update pipeline
 * that subtracts `min(amount, max(treasury, 0))`, so:
 *  - a treasury that fell below the price between the caller's read and this
 *    write pays what is left rather than going negative, and
 *  - an already-overdrawn row is left exactly as it was rather than sinking
 *    further.
 *
 * Callers get back the amount ACTUALLY charged and derive the click's realized
 * funded fraction from it (floored via `clampFundedFraction`, so committed PS
 * can never buy zero Org). That is why this returns a number instead of an
 * ok/error union: by the time it runs, the PS is already spent and there is no
 * failure the player could act on.
 */

export interface ChargeOrgBuildFundsInput {
  countryId: CountryId;
  /** Party's `sequentialId`-string identifier. */
  partyId: string;
  /** Which treasury pays. Mirrors the PS `SpendScope` for the same click. */
  scope: OrgBuildFundingScope;
  /** `StatePartyOrg._id` (e.g. `"US_CA_1"`). Required for `state` scope. */
  stateRowId?: string;
  /** Full price of the click. The charge is capped at the available balance. */
  amount: number;
  /** Short audit label, e.g. `"Build Org (California)"`. */
  memo: string;
  /** Actor metadata for the chair-facing audit row. */
  initiatedBy?: TreasuryTransaction["initiatedBy"];
  turn: number;
  now: Date;
}

export interface ChargeOrgBuildFundsResult {
  /** Cash actually debited. `0` when the row was missing or already overdrawn. */
  charged: number;
}

/** Subtract `min(amount, max(treasury, 0))` atomically, never past zero. */
function debitPipeline(amount: number, now: Date) {
  const available = { $max: [{ $ifNull: ["$treasury", 0] }, 0] };
  return [
    {
      $set: {
        treasury: {
          $subtract: [{ $ifNull: ["$treasury", 0] }, { $min: [amount, available] }],
        },
        updatedAt: now,
      },
    },
  ];
}

export async function chargeOrgBuildFunds(
  input: ChargeOrgBuildFundsInput,
  injectedDb?: Db
): Promise<ChargeOrgBuildFundsResult> {
  const amount = input.amount;
  if (!Number.isFinite(amount) || amount <= 0) return { charged: 0 };

  const db = injectedDb ?? (await getDb());
  const isState = input.scope === "state";

  // Debit and read the PRE-update balance in one atomic op, so the amount we
  // report (and audit) is exactly what the pipeline took.
  let before: { treasury?: number } | null;
  let holderId: string;
  if (isState) {
    if (!input.stateRowId) return { charged: 0 };
    holderId = input.stateRowId;
    before = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOneAndUpdate({ _id: input.stateRowId }, debitPipeline(amount, input.now), {
        returnDocument: "before",
      });
  } else {
    holderId = input.partyId;
    before = await db
      .collection<PoliticalParty>("politicalParties")
      .findOneAndUpdate(
        { countryId: input.countryId, sequentialId: Number(input.partyId) },
        debitPipeline(amount, input.now),
        { returnDocument: "before" }
      );
  }

  if (!before) return { charged: 0 };

  const charged = Math.min(amount, Math.max(before.treasury ?? 0, 0));
  if (charged <= 0) return { charged: 0 };

  await emitTreasuryTransaction({
    db,
    countryId: input.countryId,
    partyId: input.partyId,
    holderType: isState ? "state_party" : "party",
    holderId,
    category: "org_building",
    direction: "debit",
    amount: charged,
    memo: input.memo,
    initiatedBy: input.initiatedBy,
    turn: input.turn,
    now: input.now,
  });

  return { charged };
}
