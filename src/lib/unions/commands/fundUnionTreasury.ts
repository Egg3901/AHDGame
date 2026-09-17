/**
 * Move CAMPAIGN FUNDS into the treasury of a union you lead.
 *
 * Player ticket #1121 asked "how do I send money to a union", while still
 * building one, and the honest answer was that there was no way at all. Dues
 * were the only inflow, and dues are collected once a turn from a membership the
 * union must first win, so a new union had no route from zero treasury to the
 * 1,000 an organizing drive costs. A head could found a union and then be unable
 * to act with it. Ticket #1112 ("what is the treasury and how do I get more of
 * it") is the same gap read from the other side.
 *
 * Campaign funds rather than personal wealth, matching what founding costs.
 * Backing a union is political spending, so it comes out of the same war chest
 * that pays for campaigning and direct action. Personal wealth is deliberately
 * not a route in: it would let a rich character bankroll an industry's labour
 * movement out of pocket, and it would make the treasury a laundering path
 * between a character's own balances.
 *
 * Head-only on purpose. Letting any character push money into any union would be
 * a clean channel for moving funds between players with no trace of why, which is
 * exactly the shape of the alt-funding rings the forensics work exists to catch.
 */
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { rejectIfTurnProcessing, resolveOwnedUnion } from "./unionActions";
import type { UnionActionResult } from "./unionActions";
import {
  applyUnionTreasuryFundingSpend,
  UNION_FUND_CREDIT_FAILED,
  UNION_FUND_DEBIT_INSUFFICIENT,
} from "@/lib/unions/unionTreasuryFundingSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";

/**
 * Smallest contribution worth a write. Not a balance question: it stops a
 * fractional-amount request from spending a turn's rate limit on a treasury
 * movement that rounds to nothing.
 */
export const MIN_UNION_CONTRIBUTION = 1;

/**
 * Fund the treasury of the union `character` leads.
 *
 * The debit is a keyed idempotent money-flow leg (issue #1672) carrying the
 * same conditional guard every other cash spend uses, so two concurrent
 * contributions can never both pass on a stale balance. If the treasury
 * credit then fails the cash is compensated, so the failure mode is
 * "nothing happened", never "charged for nothing", and a crash between the
 * writes reconciles instead of stranding either half.
 */
export async function fundUnionTreasury(
  db: Db,
  character: Character,
  unionId: string,
  amount: number,
  options?: { idempotencyKey?: string }
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (!Number.isFinite(amount) || amount < MIN_UNION_CONTRIBUTION) {
    return {
      ok: false,
      status: 400,
      error: `Enter an amount of at least ${MIN_UNION_CONTRIBUTION}.`,
    };
  }
  // Whole units only: the treasury is displayed rounded, so a fractional
  // contribution would read as money that vanished.
  const contribution = Math.floor(amount);

  const forexEnabled = await isForexEnabled();
  const homeCurrency = getHomeCurrency(character);
  // Campaign funds live in `currencyBalances.campaign` post-forex and on the
  // legacy `funds` field before it, the same resolution `directAction` does.
  const useForexCampaignBalance =
    forexEnabled && typeof character.currencyBalances?.campaign === "number";
  const campaignFundsField = useForexCampaignBalance ? "currencyBalances.campaign" : "funds";

  const now = new Date();
  // Crash-safe spend (issue #1672): the funder debit is a keyed idempotent
  // leg and the treasury credit a keyed update, so a crash between the
  // sequential writes reconciles to exactly one charged contribution instead
  // of charging for money that never landed (or landing it twice).
  // `Idempotency-Key` replays the stored outcome without charging again.
  try {
    await applyUnionTreasuryFundingSpend(db, {
      characterId: character._id,
      unionId: union._id,
      campaignFundsField,
      contribution,
      now,
      fingerprint: `fund:${character._id.toHexString()}:${union._id.toHexString()}:${contribution}`,
      ...(options?.idempotencyKey !== undefined
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith(UNION_FUND_DEBIT_INSUFFICIENT)) {
      const available = useForexCampaignBalance
        ? (character.currencyBalances?.campaign ?? 0)
        : (character.funds ?? 0);
      return {
        ok: false,
        status: 402,
        error: `You do not have ${contribution.toLocaleString()} ${homeCurrency} in campaign funds (you have ${Math.floor(available).toLocaleString()}).`,
      };
    }
    if (message.startsWith(UNION_FUND_CREDIT_FAILED)) {
      return {
        ok: false,
        status: 500,
        error: "The contribution did not go through, you have been refunded.",
      };
    }
    if (error instanceof MoneyFlowKeyConflictError) {
      return {
        ok: false,
        status: 409,
        error: "This contribution key was already used for a different contribution.",
      };
    }
    if (error instanceof MoneyFlowTerminalError) {
      return {
        ok: false,
        status: 409,
        error: "This contribution already settled; retry without the idempotency key.",
      };
    }
    throw error;
  }

  return {
    ok: true,
    status: 200,
    contributed: contribution,
    currency: homeCurrency,
    treasury: (union.treasury ?? 0) + contribution,
  };
}
