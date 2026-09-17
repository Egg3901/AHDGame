import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

import type { IndexFund, IndexFundHolding } from "@/lib/db/types";
import {
  applyHoldingWriteOffSpend,
  buildHoldingWriteOffFingerprint,
  buildHoldingWriteOffKey,
  resumeHoldingWriteOffByKey,
} from "@/lib/indexFunds/fundHoldingWriteOffSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

export interface DeadHoldingWriteOffResult {
  /** Holdings removed at zero because the corporation no longer exists. */
  writtenOffCount: number;
  writtenOffValueAnchor: number;
  /** Holdings the fund still cannot sell, but whose corporation is alive. */
  unsellableCount: number;
  unsellableValueAnchor: number;
}

const EMPTY: DeadHoldingWriteOffResult = {
  writtenOffCount: 0,
  writtenOffValueAnchor: 0,
  unsellableCount: 0,
  unsellableValueAnchor: 0,
};

/**
 * Remove holdings in dead corporations that the sale path silently refused.
 *
 * Divestment was only ever implemented as a sale, and
 * `sellFundHoldingsForRedemptionCash` skips any holding whose corporation
 * document is gone (`if (!corp) continue`). So a corp that died left its
 * position in the book forever: flagged for removal every rebalance, never
 * sold, and still marked at `lastValueAnchor` from whenever it last traded.
 * NAV counted that stale mark as backing, so it drifted up as the world aged
 * and corps died. On 2026-09-03 this had accumulated to 5.89B across 34 funds.
 *
 * A dead corporation's shares are worth zero, so the correct exit is a
 * write-off, not a sale. Holdings whose corporation is still alive are only
 * counted and reported: the corp may get a bid next turn, and zeroing a live
 * position would destroy real holder value to fix a bookkeeping problem.
 *
 * Crash safety (issue #1672): the removal runs as one surgical `$pull` of
 * exactly the dead rows plus one deterministic audit row under a key derived
 * from the fund and the flagged removal list (see
 * `fundHoldingWriteOffSpend.ts`). A crash between the pull and the audit row
 * resumes under the same key instead of vanishing like the legacy
 * pull-then-insert (whose retry recomputed from post-pull holdings, found
 * nothing, and reported EMPTY, leaving the loss permanently unaudited). A
 * same-key retry after completion reports the stored outcome without
 * re-pulling: the loss is never repeated.
 */
export async function writeOffDeadConstituentHoldings(
  db: Db,
  fund: IndexFund,
  flagged: IndexFundHolding[],
  turn: number
): Promise<DeadHoldingWriteOffResult> {
  if (flagged.length === 0) return EMPTY;

  // Only holdings the sale left behind. Anything it managed to sell is gone
  // from `fund.holdings` already, and must not be written off on top.
  const flaggedIds = new Set(flagged.map((h) => h.corporationId.toString()));
  const stillHeld = fund.holdings.filter(
    (h) => flaggedIds.has(h.corporationId.toString()) && h.shares > 0
  );
  if (stillHeld.length === 0) return EMPTY;

  // The flagged removal list names the attempt: it is computed from target
  // constituents, not live holdings, so a same-turn retry names the same key
  // and reconciles the stored plan instead of auditing a remainder twice.
  const key = buildHoldingWriteOffKey(fund._id, turn, flagged);
  const fingerprint = buildHoldingWriteOffFingerprint({
    fundId: fund._id,
    turn,
    flagged,
    quotedNav: fund.quotedNav,
  });

  try {
    const { outcome } = await applyHoldingWriteOffSpend(db, {
      fundId: fund._id,
      quotedNav: fund.quotedNav,
      flagged,
      turn,
      fingerprint,
      idempotencyKey: key,
    });
    return outcome;
  } catch (err) {
    // A same-key retry can land on a receipt the orphan driver could not
    // resume (changed figures fail the fingerprint check by design, and a
    // settled receipt fails terminal-closed). Reconcile by key: a resumable
    // receipt completes here and reports; anything else throws and the
    // rebalance retries next cycle under a new key.
    if (err instanceof MoneyFlowKeyConflictError || err instanceof MoneyFlowTerminalError) {
      const reconciled = await resumeHoldingWriteOffByKey(db, key, fund._id, turn);
      if (reconciled) return reconciled.outcome;
    }
    throw err;
  }
}

/** Test seam: the ids a write-off would touch, without writing. */
export function selectDeadHoldingIds(
  holdings: IndexFundHolding[],
  liveCorporationIds: Iterable<ObjectId | string>
): ObjectId[] {
  const live = new Set(Array.from(liveCorporationIds, (id) => String(id)));
  return holdings
    .filter((h) => h.shares > 0 && !live.has(h.corporationId.toString()))
    .map((h) => h.corporationId);
}
