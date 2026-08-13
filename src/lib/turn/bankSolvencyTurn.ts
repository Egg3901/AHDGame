import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter, BankLoan, InterbankLoan } from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  isBankContagionEnabled,
  isBankPropTradingEnabled,
  isPrivateBankingEnabled,
} from "@/lib/banking/featureFlag";
import { archiveCharter } from "@/lib/banking/charterHistory";
import { getCashReserves } from "@/lib/banking/bankCash";
import { computeConfidence, type ConfidenceBand } from "@/lib/banking/confidence";
import { resolveFailedBankDepositors } from "@/lib/banking/insurance";
import {
  computePropEquityBase,
  forceLiquidateToLeverageCap,
  markBook,
} from "@/lib/banking/propTrading";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { discountWindowStigma } from "@/lib/banking/discountWindow";
import { isDepositTakingCharter } from "@/lib/banking/charterKinds";

/**
 * Provisional - fraction of npcDeposits that flee per solvency turn by band.
 * Independent of bankingTurn's normal NPC flow cap.
 */
export const FLIGHT_RATE_BY_BAND: Readonly<Record<"amber" | "red", number>> = {
  amber: 0.1,
  red: 0.3,
};

/**
 * Provisional - fail when liquid+posted < this fraction of required reserves,
 * but only while the warning band is already red.
 */
export const RUN_FAILURE_COVER_FRACTION = 0.5;

/** Provisional - panicTurns stamped onto same-currency peers on a failure. */
export const CONTAGION_PANIC_TURNS = 4;

export type BankSolvencyTurnSummary = {
  banksEvaluated: number;
  /** Total NPC deposit face value that fled back to externalBroadMoney. */
  fled: number;
  failures: number;
  /** Peers that received a contagion panic bump this turn. */
  contagionTriggered: number;
  /** Failed charters whose depositors were resolved this turn. */
  depositorsResolved: number;
  /** Fund + Treasury outflows that re-backed kept deposits. */
  insurancePaid: number;
  /** Total player excess haircut face value. */
  haircutsApplied: number;
  /** Banks whose prop book was force-liquidated for leverage breach. */
  forcedLiquidations: number;
};

const ZERO_SUMMARY: BankSolvencyTurnSummary = {
  banksEvaluated: 0,
  fled: 0,
  failures: 0,
  contagionTriggered: 0,
  depositorsResolved: 0,
  insurancePaid: 0,
  haircutsApplied: 0,
  forcedLiquidations: 0,
};

function isPropRunningCharter(charter: BankCharter | undefined): charter is BankCharter {
  return (
    charter != null &&
    charter.status === "active" &&
    (charter.type === "investment" || charter.type === "universal")
  );
}

type EvalResult = {
  corpId: ObjectId;
  currency: CurrencyCode;
  confidence: number;
  warningBand: ConfidenceBand;
  npcDeposits: number;
  totalDeposits: number;
  panicTurnsBefore: number;
  failed: boolean;
  fled: number;
  isDepositTaking: boolean;
};

/**
 * Private-bank solvency: prop-book mark-to-market, confidence/warning band,
 * NPC deposit flight on amber/red, run failure, depositor resolution, contagion.
 *
 * Runs immediately AFTER recomputeSharePrices so prop-book marking lands against
 * fresh equity / index / bond / FX prices.
 *
 * `turn` is the in-flight turn number from the registry (`newTurn`).
 */
export async function processBankSolvencyTurn(
  db: Db,
  turn: number
): Promise<BankSolvencyTurnSummary> {
  if (!(await isPrivateBankingEnabled())) {
    return { ...ZERO_SUMMARY };
  }

  const propEnabled = await isBankPropTradingEnabled();

  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      {
        "bankCharter.status": "active",
        "bankCharter.type": { $in: ["retail", "universal", "investment"] },
      },
      // Candidate filtering needs only the charter; evaluateOneBank re-reads
      // the live projected doc itself.
      { projection: { bankCharter: 1 } }
    )
    .toArray();

  const candidates: Corporation[] = [];
  for (const corp of corps) {
    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") continue;
    if (charter.lastSolvencyTurn === turn) continue;
    const depositTaking = isDepositTakingCharter(charter);
    const propRunning = propEnabled && isPropRunningCharter(charter);
    // Investment banks enter the solvency pass once they can run a prop book.
    if (!depositTaking && !propRunning) continue;
    candidates.push(corp);
  }

  const summary: BankSolvencyTurnSummary = { ...ZERO_SUMMARY };

  if (candidates.length > 0) {
    const reserveByCurrency = new Map<CurrencyCode, number>();
    const evals: EvalResult[] = [];

    for (const corp of candidates) {
      const result = await evaluateOneBank(db, turn, corp, reserveByCurrency, propEnabled);
      if (!result) continue;
      evals.push(result.row);
      summary.banksEvaluated += 1;
      summary.fled += result.row.fled;
      if (result.row.failed) summary.failures += 1;
      if (result.forcedLiquidation) summary.forcedLiquidations += 1;
    }

    // Contagion: every OTHER active deposit-taking charter in the same currency.
    const newlyPanicked = new Map<string, number>();
    const contagionOn = await isBankContagionEnabled();
    if (contagionOn) {
      const failedByCurrency = new Map<CurrencyCode, ObjectId[]>();
      for (const row of evals) {
        if (!row.failed || !row.isDepositTaking) continue;
        const list = failedByCurrency.get(row.currency) ?? [];
        list.push(row.corpId);
        failedByCurrency.set(row.currency, list);
      }

      if (failedByCurrency.size > 0) {
        const peers = await db
          .collection<Corporation>("corporations")
          .find({
            "bankCharter.status": "active",
            "bankCharter.type": { $in: ["retail", "universal"] },
          })
          .project({ _id: 1, bankCharter: 1 })
          .toArray();

        for (const [currency, failedIds] of failedByCurrency) {
          const failedHex = new Set(failedIds.map((id) => id.toString()));
          for (const peer of peers) {
            if (!isDepositTakingCharter(peer.bankCharter)) continue;
            if (peer.bankCharter.currency !== currency) continue;
            const peerHex = peer._id.toString();
            if (failedHex.has(peerHex)) continue;
            const existing = peer.bankCharter.panicTurns ?? 0;
            const next = Math.max(existing, CONTAGION_PANIC_TURNS);
            newlyPanicked.set(peerHex, next);
          }
        }
      }
    }

    for (const row of evals) {
      const hex = row.corpId.toString();
      if (row.failed) {
        continue;
      }

      let panicTurns: number;
      if (newlyPanicked.has(hex)) {
        panicTurns = newlyPanicked.get(hex)!;
        newlyPanicked.delete(hex);
        summary.contagionTriggered += 1;
      } else {
        panicTurns = Math.max(0, row.panicTurnsBefore - 1);
      }

      await db.collection<Corporation>("corporations").updateOne(
        {
          _id: row.corpId,
          "bankCharter.status": "active",
          $or: [
            { "bankCharter.lastSolvencyTurn": { $ne: turn } },
            { "bankCharter.lastSolvencyTurn": { $exists: false } },
          ],
        },
        {
          $set: {
            "bankCharter.confidence": row.confidence,
            "bankCharter.warningBand": row.warningBand,
            "bankCharter.npcDeposits": row.npcDeposits,
            "bankCharter.totalDeposits": row.totalDeposits,
            "bankCharter.panicTurns": panicTurns,
            "bankCharter.lastSolvencyTurn": turn,
            updatedAt: new Date(),
          },
        }
      );
    }

    for (const [hex, panicTurns] of newlyPanicked) {
      summary.contagionTriggered += 1;
      await db.collection<Corporation>("corporations").updateOne(
        { _id: new ObjectId(hex), "bankCharter.status": "active" },
        {
          $set: {
            "bankCharter.panicTurns": panicTurns,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  const unresolved = await db
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.status": "failed",
      "bankCharter.depositorsResolvedTurn": { $exists: false },
    })
    .project({ _id: 1 })
    .toArray();

  for (const failed of unresolved) {
    const resolution = await resolveFailedBankDepositors(db, failed._id, turn);
    if (!resolution.resolved) continue;
    summary.depositorsResolved += 1;
    summary.insurancePaid += resolution.insurancePaid;
    summary.haircutsApplied += resolution.haircutsApplied;
  }

  return summary;
}

async function evaluateOneBank(
  db: Db,
  turn: number,
  corp: Corporation,
  reserveByCurrency: Map<CurrencyCode, number>,
  propEnabled: boolean
): Promise<{ row: EvalResult; forcedLiquidation: boolean } | null> {
  const live = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corp._id }, { projection: { liquidCapital: 1, bankCharter: 1 } });
  if (!live?.bankCharter || live.bankCharter.lastSolvencyTurn === turn) {
    return null;
  }

  let charter = live.bankCharter;
  const depositTaking = isDepositTakingCharter(charter);
  const propRunning = propEnabled && isPropRunningCharter(charter);
  if (!depositTaking && !propRunning) {
    return null;
  }

  const currency = charter.currency as CurrencyCode;
  // The BANK's ring-fenced cash, not the holding company's treasury. Reading
  // `live.liquidCapital` here after the ring-fence would have compared the
  // parent's balance against the bank's deposit obligations: once the migration
  // moves cash onto the charter, `cover` collapses to posted capital alone and
  // every deposit-taking bank fails its liquidity test on the next pass.
  let cashReserves = getCashReserves(charter);
  let npcDeposits = Math.max(0, charter.npcDeposits ?? 0);
  const totalLoans = Math.max(0, charter.totalLoans ?? 0);
  const totalDepositsBefore = Math.max(0, charter.totalDeposits ?? 0);
  const panicTurnsBefore = Math.max(0, charter.panicTurns ?? 0);
  let forcedLiquidation = false;

  // Mark prop book before confidence so leverage / equity use fresh prices.
  if (propRunning) {
    const marked = await markBook(db, charter);
    const liq = await forceLiquidateToLeverageCap(db, corp._id, cashReserves, charter, marked);
    cashReserves = liq.cashReserves;
    charter = liq.charter;
    forcedLiquidation = liq.forced;
    if (!liq.forced) {
      await db.collection<Corporation>("corporations").updateOne(
        { _id: corp._id, "bankCharter.status": "active" },
        {
          $set: {
            "bankCharter.propBook": marked.positions,
            "bankCharter.propBookMarkValue": marked.propBookMarkValue,
            updatedAt: new Date(),
          },
        }
      );
      charter = {
        ...charter,
        propBook: marked.positions,
        propBookMarkValue: marked.propBookMarkValue,
      };
    }
  }

  if (!reserveByCurrency.has(currency)) {
    reserveByCurrency.set(currency, await getReserveRequirement(db, currency));
  }
  const reserveRatioRequired = reserveByCurrency.get(currency) ?? 0;

  const [arrearsOutstanding, retailDefaultsLastTurn, interbankDefaultsLastTurn] = await Promise.all(
    [
      sumLoanOutstanding(db, corp._id, { status: "arrears" }),
      sumLoanOutstanding(db, corp._id, { status: "defaulted", lastProcessedTurn: turn }),
      sumInterbankDefaultsLastTurn(db, corp._id, turn),
    ]
  );
  const defaultsLastTurn = retailDefaultsLastTurn + interbankDefaultsLastTurn;

  const postedCapital = Math.max(0, charter.postedCapital ?? 0);
  const { confidence, band } = computeConfidence({
    cashReserves,
    postedCapital,
    totalDeposits: totalDepositsBefore,
    totalLoans,
    reserveRatioRequired,
    arrearsOutstanding,
    defaultsLastTurn,
    panicTurns: panicTurnsBefore,
    forcedLiquidation,
    discountWindowStigma: discountWindowStigma(charter),
  });

  let fled = 0;
  if (depositTaking) {
    const priorBand = charter.warningBand;
    if (priorBand === "amber" || priorBand === "red") {
      const rate = FLIGHT_RATE_BY_BAND[priorBand];
      const outflow = npcDeposits * rate;
      if (outflow > 0) {
        const cbDocId = getBankId(getCountryIdForCurrency(currency));
        await db.collection<CentralBank>("centralBanks").updateOne(
          { _id: cbDocId },
          {
            $inc: { externalBroadMoney: outflow },
            $set: { updatedAt: new Date() },
          }
        );
        npcDeposits = Math.max(0, npcDeposits - outflow);
        await db.collection<Corporation>("corporations").updateOne(
          {
            _id: corp._id,
            "bankCharter.status": "active",
            $or: [
              { "bankCharter.lastSolvencyTurn": { $ne: turn } },
              { "bankCharter.lastSolvencyTurn": { $exists: false } },
            ],
          },
          {
            $set: {
              "bankCharter.npcDeposits": npcDeposits,
              updatedAt: new Date(),
            },
          }
        );
        fled = outflow;
      }
    }
  }

  const totalDeposits = Math.max(0, totalDepositsBefore - fled);
  const priorBand = charter.warningBand;
  const equityBase = computePropEquityBase(cashReserves, charter);

  let fails = false;
  if (depositTaking) {
    const requiredLiquidity = reserveRatioRequired * totalDeposits;
    // Not `+ postedCapital`: posted capital is a memo of cash already inside the
    // reserve balance, so adding it counted the same money twice.
    const cover = cashReserves;
    fails = priorBand === "red" && cover < RUN_FAILURE_COVER_FRACTION * requiredLiquidity;
  } else if (propRunning) {
    // Investment banks: red band + insolvent equity base.
    fails = band === "red" && equityBase <= 0;
  }

  if (fails) {
    const failedCharter: BankCharter = {
      ...charter,
      status: "failed",
      failedTurn: turn,
      confidence,
      warningBand: band,
      npcDeposits,
      totalDeposits,
      lastSolvencyTurn: turn,
    };
    await archiveCharter(db, corp._id, failedCharter, turn, "failed");
    await writeOffInterbankAndMarginOnFailure(db, corp._id, charter, turn);
    await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corp._id,
        "bankCharter.status": "active",
        $or: [
          { "bankCharter.lastSolvencyTurn": { $ne: turn } },
          { "bankCharter.lastSolvencyTurn": { $exists: false } },
        ],
      },
      {
        $set: {
          "bankCharter.status": "failed",
          "bankCharter.failedTurn": turn,
          "bankCharter.confidence": confidence,
          "bankCharter.warningBand": band,
          "bankCharter.npcDeposits": npcDeposits,
          "bankCharter.totalDeposits": totalDeposits,
          "bankCharter.interbankDebt": 0,
          "bankCharter.cbMarginDebt": 0,
          "bankCharter.propBook": [],
          "bankCharter.propBookMarkValue": 0,
          "bankCharter.lastSolvencyTurn": turn,
          updatedAt: new Date(),
        },
      }
    );
  }

  return {
    row: {
      corpId: corp._id,
      currency,
      confidence,
      warningBand: band,
      npcDeposits,
      totalDeposits,
      panicTurnsBefore,
      failed: fails,
      fled,
      isDepositTaking: depositTaking,
    },
    forcedLiquidation,
  };
}

/**
 * On failure: interbank lenders write off outstanding (loss; no cash), CB margin
 * debt is written off against the CB (LOC-style: clear the claim, no further
 * cash movement since principal was created into the corp).
 */
async function writeOffInterbankAndMarginOnFailure(
  db: Db,
  failedCorpId: ObjectId,
  charter: BankCharter,
  turn: number
): Promise<void> {
  const owedAsBorrower = await db
    .collection<InterbankLoan>("interbankLoans")
    .find({
      borrowerCorporationId: failedCorpId,
      status: "current",
    })
    .toArray();

  for (const loan of owedAsBorrower) {
    await db.collection<InterbankLoan>("interbankLoans").updateOne(
      { _id: loan._id },
      {
        $set: {
          status: "defaulted",
          lastProcessedTurn: turn,
        },
      }
    );
  }

  // Loans this bank originated as interbank lender: borrowers keep the cash;
  // the asset is written off (status defaulted) so confidence can see the loss.
  await db.collection<InterbankLoan>("interbankLoans").updateMany(
    {
      lenderCorporationId: failedCorpId,
      status: "current",
    },
    {
      $set: {
        status: "defaulted",
        lastProcessedTurn: turn,
      },
    }
  );

  // Clear borrower-side debt counters on counterparties who lent to the failed bank.
  for (const loan of owedAsBorrower) {
    const out = Math.max(0, loan.outstanding ?? 0);
    if (out <= 0) continue;
    // Lender absorbs the loss (no cash recovery). Debt already marked defaulted.
    void charter;
  }

  // CB margin: write off the claim (principal was created on draw; clearing debt
  // does not destroy residual cash still on the failed corp).
  if ((charter.cbMarginDebt ?? 0) > 0) {
    // No CB pool debit - mirror LOC writeoff (claim extinguished).
  }
}

async function sumLoanOutstanding(
  db: Db,
  bankCorporationId: ObjectId,
  filter: { status: BankLoan["status"]; lastProcessedTurn?: number }
): Promise<number> {
  const match: Record<string, unknown> = {
    bankCorporationId,
    status: filter.status,
    borrowerType: { $in: ["character", "corporation"] },
  };
  if (filter.lastProcessedTurn !== undefined) {
    match.lastProcessedTurn = filter.lastProcessedTurn;
  }
  const rows = await db
    .collection<BankLoan>("bankLoans")
    .aggregate<{ total: number }>([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$outstanding" } } },
    ])
    .toArray();
  const total = rows[0]?.total ?? 0;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

async function sumInterbankDefaultsLastTurn(
  db: Db,
  lenderCorporationId: ObjectId,
  turn: number
): Promise<number> {
  const rows = await db
    .collection<InterbankLoan>("interbankLoans")
    .aggregate<{ total: number }>([
      {
        $match: {
          lenderCorporationId,
          status: "defaulted",
          lastProcessedTurn: turn,
        },
      },
      { $group: { _id: null, total: { $sum: "$outstanding" } } },
    ])
    .toArray();
  const total = rows[0]?.total ?? 0;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}
