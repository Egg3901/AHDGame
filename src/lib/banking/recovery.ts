/**
 * The recovery worker.
 *
 * Everything the banking subsystem writes is claimed before it moves and
 * stamped as it lands, so a crash anywhere leaves a record that says exactly
 * what remains. This is the pass that reads those records and finishes them:
 *
 * - settlement records still `partial` from an earlier turn are resumed from
 *   the journal (legs that did not land, then projections that did not);
 * - estates claimed for resolution on an earlier turn and never settled are
 *   run to completion under their original claim, whether the claim was a
 *   failure or a revocation.
 *
 * It runs at the start of every banking turn, before any new flow, so a turn
 * never builds on money that is still in flight from the last one; and an
 * admin can run it on demand. It never guesses: a resumed leg keeps its guard,
 * and a record it cannot finish is reported, not forced.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement } from "@/lib/banking/settlementJournal";
import { resolveFailedBankDepositors } from "@/lib/banking/insurance";
import { revokeCharter } from "@/lib/banking/charter";
import { countBankingEvent, recordBankingStage } from "@/lib/banking/telemetry";
import { lifecycleStage } from "@/lib/banking/rules/lifecycle";

export interface BankingRecoverySummary {
  turn: number;
  /** Keys whose legs and projections were finished from the record. */
  resumedSettlements: string[];
  /** Keys that still could not be finished, with why. */
  stillPartial: Array<{ key: string; kind: string; turn?: number; error: string }>;
  /** Estates whose claimed resolution or revocation was run to completion. */
  estatesRecovered: string[];
  /** Estates still in resolution after this pass, with why. */
  estatesStillResolving: Array<{ bankId: string; claimedTurn: number; error: string }>;
}

const MAX_RECORDS_PER_PASS = 200;

/**
 * Finish what earlier turns left unfinished. `turn` is the in-flight turn:
 * only records and claims from turns BEFORE it are touched, because one from
 * this turn may still be running in another pass.
 */
export async function recoverBankingSettlements(
  db: Db,
  turn: number
): Promise<BankingRecoverySummary> {
  const started = Date.now();
  const summary: BankingRecoverySummary = {
    turn,
    resumedSettlements: [],
    stillPartial: [],
    estatesRecovered: [],
    estatesStillResolving: [],
  };

  // Estates first: their settlements are resumed inside the resolution
  // itself, under the estate's own claim, and a record the estate owns must
  // not be resumed beside it.
  const claimed = await db
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.resolutionClaimedTurn": { $lt: turn },
      "bankCharter.depositorsResolvedTurn": { $exists: false },
    })
    .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
    .toArray();
  const estateKeys = new Set<string>();
  for (const corp of claimed) {
    const charter = corp.bankCharter;
    if (!charter || lifecycleStage(charter) !== "resolving") continue;
    const claimedTurn = charter.resolutionClaimedTurn ?? 0;
    const bankId = corp._id.toString();
    estateKeys.add(`deposit-book-return:${bankId}:failure:${claimedTurn}`);
    estateKeys.add(`deposit-book-return:${bankId}:revocation:${claimedTurn}`);
    const outcome = await recoverEstate(db, corp._id, charter, turn);
    if (outcome.ok) {
      summary.estatesRecovered.push(bankId);
      countBankingEvent(db, turn, "recoveredEstates");
    } else {
      summary.estatesStillResolving.push({ bankId, claimedTurn, error: outcome.error });
    }
  }

  const partial = await db
    .collection<{ _id: string; kind: string; turn?: number; status: string }>(MONEY_MOVE_COLLECTION)
    .find({ status: "partial", turn: { $lt: turn } })
    .sort({ createdAt: 1 })
    .limit(MAX_RECORDS_PER_PASS)
    .toArray();
  for (const record of partial) {
    if (estateKeys.has(record._id)) continue;
    const result = await resumeSettlement(db, record._id);
    if (result.status === "applied" || result.status === "replayed") {
      summary.resumedSettlements.push(record._id);
    } else {
      summary.stillPartial.push({
        key: record._id,
        kind: record.kind,
        turn: record.turn,
        error: result.error ?? `settlement ${result.status}`,
      });
    }
  }

  if (claimed.length > 0 || partial.length > 0) {
    recordBankingStage(db, turn, "recovery", Date.now() - started);
  }
  return summary;
}

async function recoverEstate(
  db: Db,
  corporationId: ObjectId,
  charter: NonNullable<Corporation["bankCharter"]>,
  turn: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (charter.status === "failed") {
      const result = await resolveFailedBankDepositors(db, corporationId, turn);
      if (result.error) return { ok: false, error: result.error };
      if (!result.resolved) return { ok: false, error: "resolution did not settle" };
      return { ok: true };
    }
    if (charter.status === "active") {
      const result = await revokeCharter(
        db,
        corporationId,
        charter.pendingRevocationReason ?? "revocation finished by recovery"
      );
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    }
    return { ok: false, error: `charter status ${charter.status} is not recoverable` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
