import type { Db } from "mongodb";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { sellFundHoldingShares } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { recordAudit } from "@/lib/audit/recordAudit";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { bankNavFloorPerShareAnchor, takeoverBankNav } from "../takeovers/rules/bankNavFloor";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";

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
 * Money-safety: the cash movement is `sellFundHoldingShares`, the existing,
 * conservation-tested "corp buys its float back from a fund" path (issuer-funded
 * debit with a balance guard, correct FX, fund cash credit, registry update),
 * plus a bank-NAV top-up (issue #1750; see below) when the market execution
 * price underprices the realizable bank net assets. Retiring the resulting
 * float is a pure share-count cleanup with no money move.
 *
 * Bank-NAV floor (issue #1750 residual): the quoted/execution share price
 * recognizes only BANK_EQUITY_VALUATION_WEIGHT of a subsidiary bank's book
 * equity and none of its marked bond/prop book, so a bank-heavy corp can
 * otherwise be taken private through this path for less than the realizable
 * bank net assets (ring-fenced cash plus loans plus the marked book, net of
 * cash-backed deposits and borrowings) the CEO inherits. The fund is topped up
 * from the corporate treasury to full realizable NAV per share, exactly like
 * the hostile-takeover squeeze-out and the voted take-private floors. Inert
 * for corps without an active charter; secondary-market pricing is untouched.
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

  // Bank-NAV floor per share, in anchor and in corp-local. Zero when the corp
  // has no active charter, the bank is at or below water, or floor infra
  // (FX/policy) is unavailable: a missing floor fails open to the market
  // price, never to zero — mirroring the hostile and voted take-private paths.
  let floorPerShareAnchor = 0;
  let floorPerShareLocal = 0;
  const activeCharter =
    corporation.bankCharter?.status === "active" ? corporation.bankCharter : null;
  if (activeCharter) {
    try {
      const fxByCurrency = await loadFxRatesByCurrency(db);
      const bankCurrency = activeCharter.currency;
      let playerDepositsAreLiabilities = false;
      try {
        const bankingPolicy = await loadBankingPolicy(db);
        playerDepositsAreLiabilities = bankCurrency
          ? savingsReadsAuthoritative(bankingPolicy, bankCurrency)
          : false;
      } catch {
        playerDepositsAreLiabilities = false;
      }
      const navAnchor = corpCapitalToAnchor(
        takeoverBankNav(activeCharter, { playerDepositsAreLiabilities }),
        bankCurrency,
        bankCurrency ? (fxByCurrency.get(bankCurrency) ?? 1) : 1
      );
      floorPerShareAnchor = bankNavFloorPerShareAnchor({
        bankNavAnchor: navAnchor,
        totalShares: corporation.totalShares ?? 0,
      });
      floorPerShareLocal = anchorToCorpCapital(
        floorPerShareAnchor,
        currency,
        fxRateForCorpFromMap(corporation, fxByCurrency)
      );
    } catch {
      floorPerShareAnchor = 0;
      floorPerShareLocal = 0;
    }
  }

  // Cheap pre-flight so we don't begin a buyback we can't finish. The real,
  // race-safe guard is settleFloatSellDebit inside each sellFundHoldingShares
  // call; this just fails fast with a clear message. 5% buffer covers
  // execution-price drift on the sellback. Measured against the FLOORED unit
  // price so a treasury that covers the market print but not the bank NAV it
  // would capture can never start a discounted take-private.
  const buyoutUnitLocal = Math.max(corporation.sharePrice, floorPerShareLocal);
  const estimatedCost = Math.ceil(fundShares * buyoutUnitLocal * 1.05);
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
  const settlements: {
    fundId: NonNullable<(typeof fundHolders)[number]["fundId"]>;
    sharesSold: number;
    cashPaidAnchor: number;
  }[] = [];
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
    settlements.push({
      fundId: holder.fundId!,
      sharesSold: res.sharesSold,
      cashPaidAnchor: res.cashRaisedAnchor,
    });
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

  // Bank-NAV top-up: the sellback above executes at the MARKET price, so when
  // the floor binds the fund was just underpaid for bank net assets the CEO is
  // about to capture in full. Pay the per-share shortfall from the corporate
  // treasury before going private. Measured against what was ACTUALLY paid
  // (cashPaidAnchor / boughtBack), so execution-price drift can never reopen
  // the discount. A treasury that covered the market print but cannot cover
  // the top-up leaves the corp public: a partial sellback is a benign market
  // operation, but a discounted take-private must never complete.
  let topUpAnchorTotal = 0;
  const floorActive = Number.isFinite(floorPerShareAnchor) && floorPerShareAnchor > 0;
  if (floorActive && boughtBack > 0) {
    const paidPerShareAnchor = cashPaidAnchor / boughtBack;
    const shortfallPerShareAnchor = floorPerShareAnchor - paidPerShareAnchor;
    if (shortfallPerShareAnchor > 0) {
      topUpAnchorTotal = Math.round(shortfallPerShareAnchor * boughtBack * 100) / 100;
    }
  }
  if (topUpAnchorTotal > 0) {
    const now = new Date();
    let fxRate = 1;
    try {
      fxRate = fxRateForCorpFromMap(corporation, await loadFxRatesByCurrency(db));
    } catch {
      fxRate = 1;
    }
    const topUpLocalTotal = anchorToCorpCapital(topUpAnchorTotal, currency, fxRate);
    const debit = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, liquidCapital: { $gte: topUpLocalTotal } },
        { $inc: { liquidCapital: -topUpLocalTotal }, $set: { updatedAt: now } }
      );
    const debited = (debit.modifiedCount ?? debit.matchedCount ?? 0) > 0;
    if (!debited) {
      return {
        ok: false,
        error:
          "Could not cover the bank-NAV top-up to index-fund holders (corporate treasury insufficient). The corporation remains public; try again once the treasury can cover the buyout.",
        status: 400,
      };
    }
    // Split the top-up across funds pro-rata to shares sold (uniform per-share
    // shortfall). Last fund takes the rounding remainder so cents conserve.
    let creditedAnchor = 0;
    for (let i = 0; i < settlements.length; i++) {
      const s = settlements[i];
      if (s.sharesSold <= 0) continue;
      const share =
        i === settlements.length - 1
          ? Math.round((topUpAnchorTotal - creditedAnchor) * 100) / 100
          : Math.round((s.sharesSold / boughtBack) * topUpAnchorTotal * 100) / 100;
      if (share <= 0) continue;
      await db
        .collection<IndexFund>("indexFunds")
        .updateOne({ _id: s.fundId }, { $inc: { cashAnchor: share }, $set: { updatedAt: now } });
      creditedAnchor += share;
    }
    cashPaidAnchor = Math.round((cashPaidAnchor + topUpAnchorTotal) * 100) / 100;
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
        // Approved-but-unissued public float is void once the corp leaves the
        // public market; the paced placement loop skips private corps, so a
        // surviving flag would block future share proposals forever.
        pendingShareIssuance: "",
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
      bankNavFloorApplied: topUpAnchorTotal > 0,
      bankNavTopUpAnchor: topUpAnchorTotal,
    },
  });

  return { ok: true };
}
