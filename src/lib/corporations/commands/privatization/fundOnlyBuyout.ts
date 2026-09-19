import type { Db } from "mongodb";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { sellFundHoldingShares } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { recordAudit } from "@/lib/audit/recordAudit";

export type FundOnlyBuyoutResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Take a corporation private by buying out index-fund minority holders from the
 * CORPORATE TREASURY (a corporate buyback). Used when the only non-CEO holders
 * are index funds.
 *
 * Why this exists (suggestion #71): index funds have no vote path, so the normal
 * 24-turn privatization vote is structurally unwinnable when a fund holds the
 * only minority stake — the CEO owns e.g. 99.9%, a fund owns 0.1%, nobody can
 * cast a vote, and the vote can never pass (it fails after 24 turns and sets a
 * 96-turn cooldown). This buys the fund out instead so the take-private completes.
 *
 * Funds are cashed out at fair MARKET value (execution price), NOT the 10%
 * take-private premium: the premium exists to induce consent from holders who
 * can object, and a passive fund neither votes nor objects — it is simply cashed
 * out at fair value.
 *
 * Money-safety: the ONLY cash movement is `sellFundHoldingShares`, the existing,
 * conservation-tested "corp buys its float back from a fund" path (issuer-funded
 * debit with a balance guard, correct FX, fund cash credit, registry update).
 * Retiring the resulting float is a pure share-count cleanup with no money move.
 *
 * Preconditions (enforced by the caller, openPrivatizationVote):
 *  - corp public, CEO controls > threshold voting power, no vote open, not on cooldown
 *  - the ONLY non-CEO shareholders are index funds (no non-CEO characters/corps)
 *  - publicFloat === 0 (float-present take-privates are a follow-up)
 */
export async function executeFundOnlyBuyout(
  db: Db,
  corporation: Corporation,
  currentTurn: number
): Promise<FundOnlyBuyoutResult> {
  const ceoIdStr = corporation.ceoId.toString();
  const fundHolders = (corporation.shareholders ?? []).filter(
    (s) => s.fundId && !s.characterId && !s.corporationId
  );
  if (fundHolders.length === 0) {
    return { ok: false, error: "No index-fund holders to buy out", status: 400 };
  }

  const currency = corporation.liquidCurrencyCode ?? "USD";
  const fundShares = fundHolders.reduce((acc, h) => acc + h.shares, 0);

  // Cheap pre-flight so we don't begin a buyback we can't finish. The real,
  // race-safe guard is settleFloatSellDebit inside each sellFundHoldingShares
  // call; this just fails fast with a clear message. 5% buffer covers
  // execution-price drift on the sellback.
  const estimatedCost = Math.ceil(fundShares * corporation.sharePrice * 1.05);
  if ((corporation.liquidCapital ?? 0) < estimatedCost) {
    return {
      ok: false,
      error: `Corporate treasury is too low to buy out the remaining index-fund shares (need ~${estimatedCost.toLocaleString()} ${currency}).`,
      status: 400,
    };
  }

  const fundIds = fundHolders.map((h) => h.fundId!);
  const funds = await db
    .collection<IndexFund>("indexFunds")
    .find({ _id: { $in: fundIds } })
    .toArray();

  // Buy each fund's stake back into the corp's float (corp-funded).
  let boughtBack = 0;
  let cashPaidAnchor = 0;
  for (const holder of fundHolders) {
    const fund = funds.find((f) => f._id.toString() === holder.fundId!.toString());
    if (!fund) {
      return {
        ok: false,
        error: "A referenced index fund could not be loaded; buyout aborted (no changes).",
        status: 409,
      };
    }
    const wanted = Math.floor(holder.shares);
    const res = await sellFundHoldingShares(db, fund, corporation._id, wanted, {
      note: "Take-private buyout of index-fund holding (#71)",
      settlementCounterparty: "issuer",
    });
    boughtBack += res.sharesSold;
    cashPaidAnchor += res.cashRaisedAnchor;
    if (res.sharesSold < wanted) {
      // Could not fully buy back (treasury ran short mid-way, or the issuer's
      // buyback mode blocked it). Leave the corp public — a partial sellback is
      // a benign market operation; the CEO retries once the treasury covers it.
      return {
        ok: false,
        error:
          "Could not buy back all index-fund shares (corporate treasury insufficient). The corporation remains public; try again once the treasury can cover the buyout.",
        status: 400,
      };
    }
  }

  // Re-read and verify the CEO is the only remaining holder before consolidating,
  // so any registry/fund-holding drift can never let us silently drop unpaid
  // shares when we rebuild the cap table.
  const after = await db.collection<Corporation>("corporations").findOne({ _id: corporation._id });
  if (!after) {
    return { ok: false, error: "Corporation vanished mid-buyout", status: 409 };
  }
  const remainingNonCeo = (after.shareholders ?? []).filter(
    (s) => s.characterId?.toString() !== ceoIdStr
  );
  if (remainingNonCeo.length > 0) {
    return {
      ok: false,
      error: "Buyout left non-CEO shareholders; aborted before going private (no privacy change).",
      status: 409,
    };
  }

  // Retire the bought-back float and finalize the take-private. The float here
  // is the corp's own just-repurchased shares (already paid for above), so
  // retiring it is a pure share-count cleanup — NO further money moves. Strip
  // dual-class supershare state (#908): a private corp is single-class.
  const now = new Date();
  const ceoEntry = after.shareholders?.find((s) => s.characterId?.toString() === ceoIdStr);
  const ceoSharesAfter = ceoEntry?.shares ?? 0;
  const cleanedShareholders = [
    {
      characterId: corporation.ceoId,
      shares: ceoSharesAfter,
      ...(ceoEntry?.avgCostPerShare !== undefined
        ? { avgCostPerShare: ceoEntry.avgCostPerShare }
        : {}),
    },
  ];
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporation._id },
    {
      $set: {
        isPrivate: true,
        lastPrivatizationTurn: currentTurn,
        updatedAt: now,
        shareholders: cleanedShareholders,
        totalShares: ceoSharesAfter,
        publicFloat: 0,
      },
      $unset: {
        privatizationCooldownUntilTurn: "",
        superShareMultiplier: "",
        superSharesAdoptedAtTurn: "",
      },
    }
  );

  recordAudit({
    source: "api",
    action: "privatization.fundBuyout",
    category: "corp",
    turn: currentTurn,
    ts: now,
    actor: { kind: "player", userId: undefined, characterId: corporation.ceoId },
    subject: { type: "corporation", id: corporation._id, name: corporation.name },
    refs: { corporationId: corporation._id },
    outcome: "ok",
    meta: {
      fundsBoughtOut: fundHolders.length,
      sharesBoughtBack: boughtBack,
      cashPaidAnchor,
    },
  });

  return { ok: true };
}
