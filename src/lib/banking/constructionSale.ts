import { getCorporateSectorLaneQuery } from "@/lib/corporations/sectorLocation";
import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { getCorpFxRate, resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import {
  CURRENCY_ANCHOR_COUNTRY,
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { sectorFxSpreadBetween } from "@/lib/currency/sectorFxSpread";
import { getBankId } from "@/lib/centralBank/helpers";
import { quoteConstructionSale, type ConstructionSaleQuote } from "./rules/constructionSale";
import { acquireConstructionLoanLock, releaseConstructionLoanLock } from "./constructionLoanLock";
import {
  acquireConstructionServiceLease,
  releaseConstructionServiceLease,
} from "./constructionServiceLease";
import { releaseCompletedConstructionFunding } from "./constructionFundingLease";
import { ensureFund } from "./insurance";
import { resumeSettlement, settleTransition } from "./settlementJournal";
import type { TransitionLeg } from "./rules/boundary";

type Result = { ok: true; quote: ConstructionSaleQuote } | { ok: false; error: string };

/** Runs only for a persisted pledge. Ordinary sales do not query banking documents. */
export async function buySecuredConstructionProperty(input: {
  db: Db;
  sectorId: ObjectId;
  borrowerId: ObjectId;
  buyerId: ObjectId;
  turn: number;
}): Promise<Result> {
  const { db, sectorId, borrowerId, buyerId, turn } = input;
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const sector = await sectors.findOne({ _id: sectorId });
  const claim = sector?.constructionFinancing;
  if (
    !sector ||
    !claim ||
    claim.borrowerId !== String(borrowerId) ||
    !ObjectId.isValid(claim.loanId)
  )
    return { ok: false, error: "No matching secured property exists" };
  let quote = claim.sale;
  if (quote?.buyerId !== undefined && quote.buyerId !== String(buyerId))
    return { ok: false, error: "Another buyer owns this sale receipt" };
  const loans = db.collection<BankLoan>("bankLoans");
  const loan = await loans.findOne({ _id: new ObjectId(claim.loanId) });
  if (
    !loan ||
    String(loan.borrowerId) !== claim.borrowerId ||
    String(loan.bankCorporationId) !== claim.bankId ||
    loan.charteredTurn !== claim.charteredTurn ||
    loan.currency !== claim.currency
  )
    return { ok: false, error: "The original property creditor does not match" };
  const cleanup = async (paid: ConstructionSaleQuote) => {
    if (paid.destination === "bank")
      await releaseConstructionServiceLease(
        db,
        loan.bankCorporationId,
        loan._id,
        paid.transition.key,
        "recovery"
      );
    // The final projection has removed collateral, but the original sale lock
    // still belongs to this receipt until title acknowledgement is complete.
    await loans.updateOne(
      { _id: loan._id, constructionSettlementOwner: paid.key },
      { $unset: { constructionSettlementOwner: "" } }
    );
    await sectors.updateOne(
      {
        _id: sectorId,
        "constructionFinancing.sale.key": paid.key,
        "constructionFinancing.sale.completed": true,
        "constructionPropertyTransition.key": paid.key,
      },
      {
        $set: { "constructionFinancing.sale.cleanupCompleted": true },
        $unset: { constructionPropertyTransition: "" },
      }
    );
  };
  if (quote?.completed) {
    // Title may be published before the original final projection is acknowledged.
    const acknowledged = await resumeSettlement(db, quote.transition.key);
    if (acknowledged.error || !["applied", "replayed"].includes(acknowledged.status))
      return { ok: false, error: acknowledged.error ?? "Sale acknowledgement is pending" };
    await cleanup(quote);
    return { ok: true, quote };
  }
  if (quote?.aborted)
    return { ok: false, error: "This sale attempt was not funded; relist before retrying" };
  if (!quote) {
    if (
      !sector.corporationId.equals(borrowerId) ||
      !sector.forSale ||
      claim.escrowLocal !== 0 ||
      !loan.constructionCollateral ||
      loan.constructionCollateral.claimId !== claim.claimId ||
      !loan.constructionCollateral.sectorId.equals(sectorId)
    )
      return { ok: false, error: "The pledged site is not available for a funded sale" };
    if (claim.status === "building" && !(await releaseCompletedConstructionFunding(db, claim)))
      return { ok: false, error: "Finish construction funding before selling its security" };
    const key = `construction:${claim.claimId}:sale:${turn}:${buyerId}`;
    const owned = await acquireConstructionLoanLock(db, loan, key);
    if (!owned) return { ok: false, error: "Another receipt owns the pledged loan" };
    const [buyer, seller, bank] = await Promise.all([
      db.collection<Corporation>("corporations").findOne({ _id: buyerId }),
      db.collection<Corporation>("corporations").findOne({ _id: borrowerId }),
      db
        .collection<Corporation>("corporations")
        .findOne({ _id: loan.bankCorporationId }, { projection: { bankCharter: 1 } }),
    ]);
    const refuse = async (error: string): Promise<Result> => {
      await releaseConstructionLoanLock(db, loan, key);
      return { ok: false, error };
    };
    if (!buyer || !seller || resolveCorpLiquidCurrencyCode(seller) !== claim.currency)
      return refuse("The native seller cash account changed");
    const collision = await sectors.findOne({
      corporationId: buyerId,
      stateId: sector.stateId,
      ...getCorporateSectorLaneQuery(sector),
    });
    if (collision)
      return refuse(
        "A pledged property must transfer as a separate site; this buyer already owns that market"
      );
    const buyerCurrency = resolveCorpLiquidCurrencyCode(buyer);
    if (!buyerCurrency) return refuse("The buyer currency is unavailable");
    const [buyerRate, creditorRate] = await Promise.all([
      getCorpFxRate(db, buyer),
      getCorpFxRate(db, seller),
    ]);
    const spread = sectorFxSpreadBetween(
      buyerCurrency,
      claim.currency as CurrencyCode,
      sector.forSale.priceAnchor
    );
    const feeLocal = Math.round(spread.spreadAnchor * buyerRate);
    const feeLegs: TransitionLeg[] = [];
    if (feeLocal > 0) {
      const sourceId = getBankId(CURRENCY_ANCHOR_COUNTRY[buyerCurrency]);
      const destinationId = getBankId(CURRENCY_ANCHOR_COUNTRY[claim.currency as CurrencyCode]);
      const revenue = Math.round(feeLocal * SPREAD_FEE_FOREX_REVENUE_RATIO),
        reserve = Math.round(feeLocal * SPREAD_FEE_RESERVE_RATIO);
      const burned = feeLocal - revenue - reserve;
      if (burned < 0) return refuse("The FX fee rounding is invalid");
      const ids = [...new Set([sourceId, destinationId])];
      const recipients = await db
        .collection<CentralBank>("centralBanks")
        .find({ _id: { $in: ids } })
        .toArray();
      if (recipients.length !== ids.length) return refuse("The FX fee recipients are unavailable");
      const valuation = { currencyCode: buyerCurrency, localPerAnchor: buyerRate };
      if (revenue > 0)
        feeLegs.push({
          kind: "credit",
          amount: revenue,
          valuation,
          collection: "centralBanks",
          filter: { _id: sourceId },
          path: "forexRevenue",
          note: "Source central-bank sale FX revenue",
        });
      if (reserve > 0)
        feeLegs.push({
          kind: "credit",
          amount: reserve,
          valuation,
          collection: "centralBanks",
          filter: { _id: destinationId },
          path: `spreadFeeReserveBalances.${buyerCurrency}`,
          note: "Sale FX reserve held in buyer currency",
        });
      if (burned > 0)
        feeLegs.push({
          kind: "burn",
          amount: burned,
          valuation,
          note: "Destroy the remaining sale FX fee",
        });
    }
    const charter = bank?.bankCharter;
    const liveEpoch =
      charter?.charteredTurn === claim.charteredTurn &&
      ["active", "failed"].includes(charter.status) &&
      charter.depositorsResolvedTurn == null;
    const candidate = quoteConstructionSale({
      claim,
      loan: owned,
      sectorId: String(sectorId),
      buyerId: String(buyerId),
      buyerCurrency,
      buyerRate,
      creditorRate,
      priceAnchor: sector.forSale.priceAnchor,
      feeLocal,
      feeLegs,
      turn,
      destination: liveEpoch ? "bank" : "insurance",
    });
    if (!candidate) return refuse("The secured sale quote is invalid");
    if (
      liveEpoch &&
      !(await acquireConstructionServiceLease(db, loan, candidate.transition.key, turn, "recovery"))
    )
      return refuse("The original lender epoch is settling another operation");
    const frozen = await sectors.updateOne(
      {
        _id: sectorId,
        corporationId: borrowerId,
        forSale: sector.forSale,
        "constructionFinancing.claimId": claim.claimId,
        "constructionFinancing.sale": { $exists: false },
        constructionPropertyTransition: { $exists: false },
        "constructionFinancing.escrowLocal": 0,
      },
      {
        $set: {
          "constructionFinancing.sale": candidate,
          constructionPropertyTransition: { key, kind: "secured_sale" },
        },
      }
    );
    if (frozen.matchedCount !== 1) {
      if (liveEpoch)
        await releaseConstructionServiceLease(
          db,
          loan.bankCorporationId,
          loan._id,
          candidate.transition.key,
          "recovery"
        );
      return refuse("The property listing changed before sale admission");
    }
    quote = candidate;
  } else {
    if (!(await acquireConstructionLoanLock(db, loan, quote.key)))
      return { ok: false, error: "Another receipt owns the secured sale" };
    if (
      quote.destination === "bank" &&
      !(await acquireConstructionServiceLease(
        db,
        loan,
        quote.transition.key,
        quote.turn,
        "recovery"
      ))
    )
      return { ok: false, error: "The original sale creditor is settling another operation" };
  }
  if (quote.destination === "insurance") await ensureFund(db, loan.currency);
  const settle = async (transition: ConstructionSaleQuote["transition"]) => {
    let result = await settleTransition(db, transition);
    if (result.status === "partial" || (result.status === "replayed" && result.error))
      result = await resumeSettlement(db, transition.key);
    return result;
  };
  let result = await settle(quote.fundingTransition);
  const fundingCompleted = !result.error && ["applied", "replayed"].includes(result.status);
  if (fundingCompleted) result = await settle(quote.transition);
  if (result.error || !["applied", "replayed"].includes(result.status)) {
    if (
      !fundingCompleted &&
      result.status === "rejected" &&
      result.appliedLegs.length === 0 &&
      result.appliedProjections.length === 0
    ) {
      await sectors.updateOne(
        { _id: sectorId, "constructionFinancing.sale.key": quote.key },
        {
          $set: { "constructionFinancing.sale.aborted": true },
          $unset: { constructionPropertyTransition: "", forSale: "" },
        }
      );
      if (quote.destination === "bank")
        await releaseConstructionServiceLease(
          db,
          loan.bankCorporationId,
          loan._id,
          quote.transition.key,
          "recovery"
        );
      await releaseConstructionLoanLock(db, loan, quote.key);
    }
    return { ok: false, error: result.error ?? "Buyer-funded secured sale is incomplete" };
  }
  await cleanup(quote);
  return { ok: true, quote };
}

export async function recoverConstructionSales(
  db: Db,
  turn: number
): Promise<Array<{ key: string; error: string }>> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        "constructionFinancing.sale.turn": { $lt: turn },
        "constructionFinancing.sale.cleanupCompleted": { $ne: true },
        "constructionFinancing.sale.aborted": { $ne: true },
      },
      { projection: { constructionFinancing: 1 } }
    )
    .limit(200)
    .toArray();
  const failures: Array<{ key: string; error: string }> = [];
  for (const sector of sectors) {
    const claim = sector.constructionFinancing,
      quote = claim?.sale;
    if (!claim || !quote) continue;
    const result = await buySecuredConstructionProperty({
      db,
      sectorId: sector._id,
      borrowerId: new ObjectId(claim.borrowerId),
      buyerId: new ObjectId(quote.buyerId),
      turn,
    });
    if (!result.ok) failures.push({ key: quote.key, error: result.error });
  }
  return failures;
}
