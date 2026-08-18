import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import type {
  BankCharter,
  BankLoan,
  DepositInsuranceFund,
  InterbankLoan,
} from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getBankId } from "@/lib/centralBank/helpers";
import { isBankPropTradingEnabled, isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { computeNpcDepositShare, equityCappedDepositCeiling } from "@/lib/banking/deposits";
import { domesticDepositRetention } from "@/lib/centralBank/marketEffects";
import {
  computeInsurancePremium,
  computeReserveRatioActual,
  ensureFund,
  getInsuredCap,
  sumInsuredPlayerDeposits,
} from "@/lib/banking/insurance";
import { applyLoanPayment, computeNpcLoanBook, markLoanDefaulted } from "@/lib/banking/lending";
import { cbMarginRatePercent } from "@/lib/banking/interbank";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rates";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { roundSavingsAmount, savingsApyPercent } from "@/lib/currency/savingsInterest";
import { discountWindowRatePercent } from "@/lib/banking/discountWindow";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { isDepositTakingCharter } from "@/lib/banking/charterKinds";
import { getCashReserves, bankEquity } from "@/lib/banking/bankCash";
import { processDeadBankLoans } from "@/lib/banking/deadBankLoans";
import {
  applyMoneyMove,
  claimMoneyMove,
  completeMoneyMove,
  turnMoveKey,
  type MoneyTarget,
} from "@/lib/banking/moneyMove";
import {
  CREDIT_BANDS,
  DEFAULT_LENDING_PROFILE,
  bandRatePercent,
  bandsForProfile,
  getCreditBand,
  type CreditBandId,
  type LendingProfileId,
} from "@/lib/banking/creditBands";

/** Max fraction of the household target that can migrate or be lent each turn. */
export const MAX_NPC_FLOW_PER_TURN_FRACTION = 0.025;

/** Provisional - consecutive shortfall turns before a player loan defaults. */
export const ARREARS_DEFAULT_TURNS = 8;

/** Rolling term for the synthetic NPC bulk book (re-sized each bankingTurn). */
const NPC_BULK_TERM_TURNS = TURNS_PER_YEAR;

export type BankingTurnSummary = {
  banksProcessed: number;
  depositInterestPaid: number;
  depositInterestShortfall: number;
  loanInterestCollected: number;
  loanPrincipalRepaid: number;
  defaultsWrittenOff: number;
  npcDepositDelta: number;
  npcBulkShortfall: number;
  /** Premium due that could not be paid from the bank's cash reserves. */
  premiumShortfall: number;
  /** Interbank interest paid borrower → lender. */
  interbankInterestPaid: number;
  /** Interbank principal written off on default. */
  interbankDefaultsWrittenOff: number;
  /** CB margin interest destroyed from borrower cash. */
  cbMarginInterestPaid: number;
  /** CB margin interest that could not be paid. */
  cbMarginInterestShortfall: number;
  /** Loans serviced on behalf of a bank that has already been wound up. */
  deadBankLoansServiced: number;
  /** Recovered into a failed bank's estate, before its waterfall runs. */
  deadBankRecoveredToEstate: number;
  /** Recovered to the insurance fund after the estate was closed. */
  deadBankRecoveredToInsurer: number;
};

const ZERO_SUMMARY: BankingTurnSummary = {
  banksProcessed: 0,
  depositInterestPaid: 0,
  depositInterestShortfall: 0,
  loanInterestCollected: 0,
  loanPrincipalRepaid: 0,
  defaultsWrittenOff: 0,
  npcDepositDelta: 0,
  npcBulkShortfall: 0,
  premiumShortfall: 0,
  interbankInterestPaid: 0,
  interbankDefaultsWrittenOff: 0,
  cbMarginInterestPaid: 0,
  cbMarginInterestShortfall: 0,
  deadBankLoansServiced: 0,
  deadBankRecoveredToEstate: 0,
  deadBankRecoveredToInsurer: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Per-turn interest on a balance at an annual percent rate (matches savingsInterestTurn). */
function perTurnInterest(balance: number, annualPercent: number, currency: CurrencyCode): number {
  if (!(balance > 0) || !(annualPercent > 0)) return 0;
  const raw = (balance * (annualPercent / 100)) / TURNS_PER_YEAR;
  return roundSavingsAmount(raw, currency);
}

function npcFlowDelta(current: number, target: number): number {
  const cur = Math.max(0, current);
  const desired = target - cur;
  const maxOutflow = MAX_NPC_FLOW_PER_TURN_FRACTION * cur;
  const maxInflow = MAX_NPC_FLOW_PER_TURN_FRACTION * Math.max(target, cur);
  return clamp(desired, -maxOutflow, maxInflow);
}

type DepositTaker = {
  corp: Corporation;
  charter: BankCharter;
  rates: { depositRatePercent: number; lendingRatePercent: number };
};

/**
 * Private-bank deposit flows, deposit interest (paid from bank cash), player
 * loan servicing, and NPC bulk book. Runs immediately after savingsInterestTurn.
 *
 * `turn` is the in-flight turn number from the registry (`newTurn`). gameState
 * `currentTurn` is only advanced after all phases finish, so callers must pass
 * the turn explicitly for idempotency keys.
 */
export async function processBankingTurn(db: Db, turn: number): Promise<BankingTurnSummary> {
  if (!(await isPrivateBankingEnabled())) {
    return { ...ZERO_SUMMARY };
  }

  // CB docs load once up front — bank rates and the savings APY both key off
  // them, so the per-corp getEffectiveBankRates findOne is unnecessary.
  type CbLite = Pick<
    CentralBank,
    "_id" | "primeRate" | "inflationHistory" | "externalBroadMoney" | "chairInfamy"
  >;
  const [corps, banks] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find({
        "bankCharter.status": "active",
        "bankCharter.type": { $in: ["retail", "universal"] },
      })
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({})
      .project({ _id: 1, primeRate: 1, inflationHistory: 1, externalBroadMoney: 1, chairInfamy: 1 })
      .toArray() as Promise<CbLite[]>,
  ]);
  const cbById = new Map<string, CbLite>();
  for (const b of banks) {
    cbById.set(typeof b._id === "string" ? b._id : String(b._id), b);
  }

  const depositTakers: DepositTaker[] = [];
  for (const corp of corps) {
    if (!isDepositTakingCharter(corp.bankCharter)) continue;
    if (corp.bankCharter.lastBankingTurn === turn) continue;
    const cb = cbById.get(getBankId(getCountryIdForCurrency(corp.bankCharter.currency)));
    const rates = effectiveBankRatesFromPrime(corp.bankCharter, cb?.primeRate);
    depositTakers.push({ corp, charter: corp.bankCharter, rates });
  }

  if (depositTakers.length === 0) {
    const summary: BankingTurnSummary = { ...ZERO_SUMMARY };
    if (await isBankPropTradingEnabled()) {
      await serviceInterbankAndCbMargin(db, turn, summary);
    }
    return summary;
  }

  const resolveCbApy = (currency: CurrencyCode): number => {
    const bankId = getBankId(getCountryIdForCurrency(currency));
    const cb = cbById.get(bankId);
    const prime =
      typeof cb?.primeRate === "number" && Number.isFinite(cb.primeRate) ? cb.primeRate : 0;
    const inflation = cb?.inflationHistory?.at(-1)?.rate ?? 0;
    return savingsApyPercent(prime, inflation);
  };

  // Competing deposit shares once per currency.
  const byCurrency = new Map<CurrencyCode, DepositTaker[]>();
  for (const row of depositTakers) {
    const c = row.charter.currency as CurrencyCode;
    const list = byCurrency.get(c) ?? [];
    list.push(row);
    byCurrency.set(c, list);
  }
  const npcShareByBankId = new Map<string, number>();
  for (const [currency, peers] of byCurrency) {
    const shares = computeNpcDepositShare(
      peers.map((p) => ({
        bankId: p.corp._id.toString(),
        effectiveDepositRatePercent: p.rates.depositRatePercent,
      })),
      resolveCbApy(currency)
    );
    // B4 market effect: deposit flight. When the currency's central bank is
    // discredited, NPC households move part of their savings into foreign
    // currency, so domestic banks capture a smaller share. The rest is not
    // destroyed, it simply stays outside the domestic banks, so the money
    // supply books still balance. Floored, and exactly 1 for a clean bank.
    const retention = domesticDepositRetention(
      cbById.get(getBankId(getCountryIdForCurrency(currency)))?.chairInfamy ?? 0
    );
    for (const s of shares) {
      npcShareByBankId.set(s.bankId, s.share * retention);
    }
  }

  const summary: BankingTurnSummary = { ...ZERO_SUMMARY };

  for (const row of depositTakers) {
    const bankResult = await processOneBank(db, turn, row, {
      npcShareByBankId,
      cbById,
    });
    summary.banksProcessed += 1;
    summary.depositInterestPaid += bankResult.depositInterestPaid;
    summary.depositInterestShortfall += bankResult.depositInterestShortfall;
    summary.loanInterestCollected += bankResult.loanInterestCollected;
    summary.loanPrincipalRepaid += bankResult.loanPrincipalRepaid;
    summary.defaultsWrittenOff += bankResult.defaultsWrittenOff;
    summary.npcDepositDelta += bankResult.npcDepositDelta;
    summary.npcBulkShortfall += bankResult.npcBulkShortfall;
    summary.premiumShortfall += bankResult.premiumShortfall;
  }

  // Loans owed to banks that have already been wound up. They are not part of
  // any live bank's pass, and before this they were serviced by nobody: the
  // borrower simply stopped paying and the value never reached the people who
  // lost out when the bank failed.
  const deadBankResult = await processDeadBankLoans(db, turn, async (loan, bank, target) => {
    const serviced = await servicePlayerLoan(
      db,
      turn,
      bank.corporationId,
      loan,
      bank.currency,
      bank.name,
      target
    );
    summary.loanInterestCollected += serviced.interestCollected;
    summary.loanPrincipalRepaid += serviced.principalRepaid;
    summary.defaultsWrittenOff += serviced.writtenOff;
    return { collected: serviced.bankCredit };
  });
  summary.deadBankLoansServiced = deadBankResult.loansServiced;
  summary.deadBankRecoveredToEstate = deadBankResult.recoveredToEstate;
  summary.deadBankRecoveredToInsurer = deadBankResult.recoveredToInsurer;

  if (await isBankPropTradingEnabled()) {
    await serviceInterbankAndCbMargin(db, turn, summary);
  }

  return summary;
}

type BankPassCaches = {
  npcShareByBankId: Map<string, number>;
  cbById: Map<
    string,
    Pick<CentralBank, "_id" | "primeRate" | "inflationHistory" | "externalBroadMoney">
  >;
};

type BankPassResult = {
  depositInterestPaid: number;
  depositInterestShortfall: number;
  loanInterestCollected: number;
  loanPrincipalRepaid: number;
  defaultsWrittenOff: number;
  npcDepositDelta: number;
  npcBulkShortfall: number;
  premiumShortfall: number;
};

async function processOneBank(
  db: Db,
  turn: number,
  row: DepositTaker,
  caches: BankPassCaches
): Promise<BankPassResult> {
  const { corp, charter, rates } = row;
  const currency = charter.currency as CurrencyCode;
  const bankIdHex = corp._id.toString();
  const result: BankPassResult = {
    depositInterestPaid: 0,
    depositInterestShortfall: 0,
    loanInterestCollected: 0,
    loanPrincipalRepaid: 0,
    defaultsWrittenOff: 0,
    npcDepositDelta: 0,
    npcBulkShortfall: 0,
    premiumShortfall: 0,
  };

  // Re-check idempotency against live doc (concurrent / retry safety).
  const live = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corp._id }, { projection: { liquidCapital: 1, bankCharter: 1 } });
  if (!live?.bankCharter || live.bankCharter.lastBankingTurn === turn) {
    return result;
  }
  if (!isDepositTakingCharter(live.bankCharter)) {
    return result;
  }

  let cashReserves = getCashReserves(live.bankCharter);
  let npcDeposits = Math.max(0, live.bankCharter.npcDeposits ?? 0);
  let totalLoans = Math.max(0, live.bankCharter.totalLoans ?? 0);

  // (a) Player depositors, loaded once — the total here and the interest pass
  // in (c) below use the same rows (NPC flow in (b) does not touch player
  // savings, so reading them up front is equivalent).
  const depositors = await db
    .collection<Character>("characters")
    .find({ [`currencyBalances.savingsHolder.${currency}`]: bankIdHex })
    // `name` is projected for the interest ledger legs in (c): the alternative
    // is one lookup per depositor per bank per turn.
    .project({ _id: 1, name: 1, [`currencyBalances.savings.${currency}`]: 1 })
    .toArray();
  const depositorNameById = new Map(
    depositors.map((ch) => [ch._id.toString(), ch.name ?? "Depositor"])
  );
  const playerDeposits = depositors.reduce((sum, ch) => {
    const bal = ch.currencyBalances?.savings?.[currency] ?? 0;
    return sum + (typeof bal === "number" && Number.isFinite(bal) && bal > 0 ? bal : 0);
  }, 0);

  // Deposit ceiling from financial-sector capacity × branch share. Caps NPC
  // target (and therefore inflow). Outflow always allowed. Player deposits
  // alone above the ceiling are grandfathered: NPC target contribution → 0.
  const capacityCeiling = await getBankDepositCeiling(db, {
    ...corp,
    bankCharter: live.bankCharter,
    liquidCapital: live.liquidCapital,
  });
  // Capacity sizes the ceiling, but a bank may only anchor a deposit base it has
  // the capital to stand behind. Cap the ceiling at a leverage multiple of book
  // equity so an undercapitalized bank (little/negative equity) cannot grow — or
  // keep — a base far larger than its capital. Negative equity drives this to 0,
  // and the normal per-turn NPC outflow then unwinds the excess gradually.
  const depositCeiling = equityCappedDepositCeiling(capacityCeiling, bankEquity(live.bankCharter));
  const npcRoom = Math.max(0, depositCeiling - playerDeposits);

  // (b) NPC deposit flow - CB update first, then corp npcDeposits
  const cbDocId = getBankId(getCountryIdForCurrency(currency));
  const cb = caches.cbById.get(cbDocId);
  const externalBroadMoney =
    typeof cb?.externalBroadMoney === "number" && Number.isFinite(cb.externalBroadMoney)
      ? Math.max(0, cb.externalBroadMoney)
      : 0;
  const share = caches.npcShareByBankId.get(bankIdHex) ?? 0;
  const uncappedTargetNpc = share * externalBroadMoney;
  const targetNpc = Math.min(uncappedTargetNpc, npcRoom);
  const delta = npcFlowDelta(npcDeposits, targetNpc);
  if (delta !== 0) {
    // The money MOVES. It leaves the central bank's household pool and lands in
    // the bank's cash, which is what a deposit is.
    //
    // Before this, the pool was debited and nothing was credited: the cash was
    // destroyed and the charter kept a number. Every rule measured against that
    // number then demanded cash the bank had never received, which is why a new
    // bank failed on turn 8 no matter what its CEO did. Crediting the cash here
    // closes a money-supply conservation hole and makes the reserve test
    // satisfiable by the same stroke.
    //
    // Both legs go through the shared money-movement primitive, which claims an
    // idempotency key BEFORE either lands and refuses a pair that does not net
    // to zero. The hand-rolled version wrote the two legs in sequence with
    // nothing tying them together, so a crash between them left the money
    // supply and the vault disagreeing by the size of the flow.
    const inflow = delta > 0;
    await applyMoneyMove(db, {
      key: turnMoveKey(inflow ? "npc-deposit-in" : "npc-deposit-out", bankIdHex, turn),
      kind: "npc_deposit_flow",
      turn,
      legs: [
        {
          kind: inflow ? "debit" : "credit",
          amount: Math.abs(delta),
          collection: "centralBanks",
          filter: { _id: cbDocId },
          path: "externalBroadMoney",
          note: inflow ? "households move money into the bank" : "households take money out",
        },
        {
          kind: inflow ? "credit" : "debit",
          amount: Math.abs(delta),
          collection: "corporations",
          filter: { _id: corp._id },
          path: "bankCharter.cashReserves",
          note: inflow ? "deposit arrives as vault cash" : "withdrawal leaves the vault",
        },
      ],
    });
    npcDeposits = Math.max(0, npcDeposits + delta);
    cashReserves = Math.max(0, cashReserves + delta);
    await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corp._id,
        "bankCharter.status": "active",
        $or: [
          { "bankCharter.lastBankingTurn": { $ne: turn } },
          { "bankCharter.lastBankingTurn": { $exists: false } },
        ],
      },
      {
        $set: {
          // Cash is moved by the money move above; only the deposit AGGREGATE
          // is written here, so the two cannot be applied twice.
          "bankCharter.npcDeposits": npcDeposits,
          updatedAt: new Date(),
        },
      }
    );
    result.npcDepositDelta += delta;
    // Keep in-memory CB stock coherent for later banks in the same currency.
    if (cb) {
      cb.externalBroadMoney = Math.max(0, externalBroadMoney - delta);
    }
  }

  // (c) Deposit interest - player balances + npcDeposits, paid from cashReserves
  type PlayerCredit = { characterId: ObjectId; interest: number };
  const playerCredits: PlayerCredit[] = [];
  let playerInterestDue = 0;
  for (const ch of depositors) {
    const bal = ch.currencyBalances?.savings?.[currency] ?? 0;
    if (!(bal > 0)) continue;
    const interest = perTurnInterest(bal, rates.depositRatePercent, currency);
    if (interest <= 0) continue;
    playerCredits.push({ characterId: ch._id, interest });
    playerInterestDue += interest;
  }
  const npcInterestDue = perTurnInterest(npcDeposits, rates.depositRatePercent, currency);
  const totalInterestDue = playerInterestDue + npcInterestDue;

  let interestScale = 1;
  if (totalInterestDue > cashReserves && totalInterestDue > 0) {
    interestScale = cashReserves / totalInterestDue;
    result.depositInterestShortfall += totalInterestDue - cashReserves;
  }

  const creditOps: {
    updateOne: { filter: object; update: object };
  }[] = [];
  let playerInterestPaid = 0;
  for (const pc of playerCredits) {
    const paid = roundSavingsAmount(pc.interest * interestScale, currency);
    if (paid <= 0) continue;
    playerInterestPaid += paid;
    creditOps.push({
      updateOne: {
        filter: { _id: pc.characterId },
        update: {
          $inc: {
            [`currencyBalances.savings.${currency}`]: paid,
            [`currencyBalances.interestEarned.${currency}`]: paid,
          },
          $set: { updatedAt: new Date() },
        },
      },
    });
  }
  // Cash actually leaving the bank for a saver's own balance. Claimed before it
  // moves, like every other money movement, but applied with a bulkWrite: the
  // counterparty is every depositor at the bank with a different amount each,
  // and one guarded write per player per bank per turn is a round trip the turn
  // loop cannot afford. `claimMoneyMove` gives the idempotency and the net-zero
  // check without the round trips.
  const interestMoveKey = turnMoveKey("deposit-interest", bankIdHex, turn);
  let playerInterestSettled = 0;

  if (playerInterestPaid > 0 && creditOps.length > 0) {
    const claim = await claimMoneyMove(db, {
      key: interestMoveKey,
      kind: "deposit_interest",
      turn,
      legs: [
        {
          kind: "debit",
          amount: playerInterestPaid,
          collection: "corporations",
          filter: { _id: corp._id },
          path: "bankCharter.cashReserves",
          note: "deposit interest leaves the bank",
        },
        {
          kind: "credit",
          amount: playerInterestPaid,
          note: "credited across every player depositor at this bank",
        },
      ],
    });

    if (claim.status === "claimed") {
      // The bank half is a guarded write for the same reason every debit is:
      // it must be impossible to pay interest the vault cannot cover, however
      // stale the figure this pass has been carrying.
      const debited = await db.collection<Corporation>("corporations").updateOne(
        { _id: corp._id, "bankCharter.cashReserves": { $gte: playerInterestPaid } },
        {
          $inc: { "bankCharter.cashReserves": -playerInterestPaid },
          $set: { updatedAt: new Date() },
        }
      );
      if (debited.matchedCount !== 1) {
        await completeMoneyMove(
          db,
          interestMoveKey,
          [],
          "the bank could not fund deposit interest"
        );
      } else {
        await db.collection("characters").bulkWrite(creditOps);
        await completeMoneyMove(db, interestMoveKey, [0, 1]);
        playerInterestSettled = playerInterestPaid;

        // Real cash leaving the bank's books for a depositor's savings, and
        // until now the only record was the balance itself. Bulk, with
        // thresholds loaded ONCE before the loop, per the emitTxBulk contract:
        // this runs for every depositor of every bank every turn.
        const thresholds = await loadTxThresholds(db);
        await emitTxBulk(
          db,
          playerCredits
            .map((pc) => ({ pc, paid: roundSavingsAmount(pc.interest * interestScale, currency) }))
            .filter(({ paid }) => paid > 0)
            .map(({ pc, paid }) => ({
              type: "bank_deposit_interest" as const,
              turn,
              createdAt: new Date(),
              subjectType: "character" as const,
              subjectId: pc.characterId,
              subjectName: depositorNameById.get(pc.characterId.toString()) ?? "Depositor",
              amount: paid,
              currencyCode: currency,
              counterpartyType: "corporation" as const,
              counterpartyId: corp._id,
              counterpartyName: corp.name,
              meta: { ratePercent: rates.depositRatePercent },
            })),
          thresholds
        );
      }
    }
  }

  const npcInterestPaid = roundSavingsAmount(npcInterestDue * interestScale, currency);
  const totalInterestPaid = playerInterestSettled + npcInterestPaid;
  if (totalInterestPaid > 0) {
    // Only the PLAYER half leaves the building. A player's interest is credited
    // to `currencyBalances.savings`, which is their own balance sheet, so the
    // cash goes with it. An NPC household's interest is credited to the account
    // it already holds AT this bank: the liability grows and the cash stays
    // exactly where it is.
    //
    // The player half already moved in the database above; this keeps the
    // in-memory figure the rest of the pass decides on in step with it.
    cashReserves = Math.max(0, cashReserves - playerInterestSettled);
    npcDeposits = Math.max(0, npcDeposits + npcInterestPaid);
    result.depositInterestPaid += totalInterestPaid;
  }

  // (c2) Deposit insurance premium - after interest, before loan servicing.
  // insuredDeposits ≈ Σ min(playerBal, cap) + npcDeposits (NPC fully insured).
  const paidByCharId = new Map<string, number>();
  for (const op of creditOps) {
    const id = String((op.updateOne.filter as { _id: ObjectId })._id);
    const paid =
      (op.updateOne.update as { $inc?: Record<string, number> }).$inc?.[
        `currencyBalances.savings.${currency}`
      ] ?? 0;
    paidByCharId.set(id, paid);
  }
  const postInterestBalances: number[] = [];
  for (const ch of depositors) {
    const bal = ch.currencyBalances?.savings?.[currency] ?? 0;
    const interestPaid = paidByCharId.get(ch._id.toString()) ?? 0;
    postInterestBalances.push(bal + interestPaid);
  }
  const insuredCap = await getInsuredCap(db, currency);
  const insuredDeposits = sumInsuredPlayerDeposits(postInterestBalances, insuredCap) + npcDeposits;
  // Reserves are held against deposits the bank actually RECEIVED in cash, which
  // is the NPC household book. Player deposits are a pointer: the money never
  // leaves `currencyBalances.savings`, so requiring the bank to hold reserves
  // against it would demand cash for a balance it does not have and cannot get.
  // Insurance still covers both, because a depositor's claim is a claim either way.
  const depositBaseForRatio = npcDeposits;
  const reserveRatioActual = computeReserveRatioActual(cashReserves, depositBaseForRatio);
  const reserveRatioRequired = await getReserveRequirement(db, currency);
  const premiumDue = computeInsurancePremium(
    insuredDeposits,
    reserveRatioActual,
    reserveRatioRequired
  );
  if (premiumDue > 0) {
    const premiumPaid = Math.min(premiumDue, cashReserves);
    const shortfall = premiumDue - premiumPaid;
    if (shortfall > 0) result.premiumShortfall += shortfall;
    if (premiumPaid > 0) {
      await ensureFund(db, currency);
      const premiumMove = await applyMoneyMove(db, {
        key: turnMoveKey("insurance-premium", bankIdHex, turn),
        kind: "insurance_premium",
        turn,
        legs: [
          {
            kind: "debit",
            amount: premiumPaid,
            collection: "corporations",
            filter: { _id: corp._id },
            path: "bankCharter.cashReserves",
            note: "insurance premium leaves the bank",
          },
          {
            kind: "credit",
            amount: premiumPaid,
            collection: "depositInsuranceFunds",
            filter: { _id: currency },
            path: "balance",
            note: "premium into the currency's insurance fund",
          },
        ],
      });
      if (premiumMove.status === "applied") {
        cashReserves = Math.max(0, cashReserves - premiumPaid);
        // Lifetime counter, not a balance, so it is not a leg of the move.
        await db
          .collection<DepositInsuranceFund>("depositInsuranceFunds")
          .updateOne({ _id: currency }, { $inc: { premiumsCollectedLifetime: premiumPaid } });
      }
    }
  }

  // (d) Player loan servicing
  const loans = await db
    .collection<BankLoan>("bankLoans")
    .find({
      bankCorporationId: corp._id,
      borrowerType: { $in: ["character", "corporation"] },
      status: { $in: ["current", "arrears"] },
      lastProcessedTurn: { $ne: turn },
    })
    .toArray();

  // Fan out across borrowers, stay serial per borrower: a borrower with two
  // loans must have them serviced in order so the affordability pre-check in
  // servicePlayerLoan sees the first loan's debit.
  const loansByBorrower = new Map<string, typeof loans>();
  for (const loan of loans) {
    const key = `${loan.borrowerType}:${String(loan.borrowerId)}`;
    const list = loansByBorrower.get(key) ?? [];
    list.push(loan);
    loansByBorrower.set(key, list);
  }
  await Promise.all(
    [...loansByBorrower.values()].map(async (borrowerLoans) => {
      for (const loan of borrowerLoans) {
        const loanResult = await servicePlayerLoan(db, turn, corp._id, loan, currency, corp.name);
        result.loanInterestCollected += loanResult.interestCollected;
        result.loanPrincipalRepaid += loanResult.principalRepaid;
        result.defaultsWrittenOff += loanResult.writtenOff;
        cashReserves += loanResult.bankCredit;
        totalLoans = Math.max(0, totalLoans + loanResult.totalLoansDelta);
      }
    })
  );

  // (e) NPC household loans. The book grows only from deposits actually held
  // by this bank after its reserve requirement. Rates set utilization, while
  // named loans consume the same capacity inside serviceNpcBulkBook.
  // Only cash-backed deposits can fund a loan; you cannot lend a pointer.
  const loanFundingCapacity = npcDeposits * (1 - reserveRatioRequired);
  const bulkResult = await serviceNpcBulkBook(
    db,
    turn,
    corp._id,
    currency,
    rates.lendingRatePercent,
    {
      loanFundingCapacity,
      cashReserves,
      totalLoans,
      cbDocId,
      cb,
      bankName: corp.name,
      requiredReserves: npcDeposits * reserveRatioRequired,
      lendingProfile: live.bankCharter.lendingProfile,
    }
  );
  cashReserves = bulkResult.cashReserves;
  totalLoans = bulkResult.totalLoans;
  result.loanInterestCollected += bulkResult.interestCollected;
  result.defaultsWrittenOff += bulkResult.writtenOff;
  result.npcBulkShortfall += bulkResult.shortfall;

  // (f) Recompute aggregates + stamp lastBankingTurn (END of bank pass)
  const finalPlayerDeposits = playerDeposits + playerInterestSettled;
  const totalDeposits = finalPlayerDeposits + npcDeposits;

  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corp._id,
      "bankCharter.status": "active",
      $or: [
        { "bankCharter.lastBankingTurn": { $ne: turn } },
        { "bankCharter.lastBankingTurn": { $exists: false } },
      ],
    },
    {
      $set: {
        // Cash is deliberately absent. Every movement in this pass now applies
        // its own guarded `$inc` through the money primitive, so writing the
        // in-memory figure here would silently overwrite anything that moved
        // concurrently and would resurrect money a failed leg never sent. What
        // is left are the derived aggregates, which are recomputed from the
        // ledgers each turn and are not balances anyone can claim.
        "bankCharter.npcDeposits": npcDeposits,
        "bankCharter.totalDeposits": totalDeposits,
        "bankCharter.totalLoans": totalLoans,
        "bankCharter.depositCeiling": depositCeiling,
        "bankCharter.lastBankingTurn": turn,
        updatedAt: new Date(),
      },
    }
  );

  return result;
}

type LoanServiceResult = {
  interestCollected: number;
  principalRepaid: number;
  writtenOff: number;
  bankCredit: number;
  totalLoansDelta: number;
};

async function servicePlayerLoan(
  db: Db,
  turn: number,
  bankCorporationId: ObjectId,
  loan: BankLoan,
  currency: CurrencyCode,
  bankName: string,
  /**
   * Where the payment lands. A live bank's vault for a normal turn; whoever
   * stood behind the bank when it was wound up, if the lender is dead. The
   * servicing arithmetic is identical either way, so it is a parameter rather
   * than a second copy of this function.
   */
  creditTarget: MoneyTarget = {
    collection: "corporations",
    filter: { _id: bankCorporationId },
    path: "bankCharter.cashReserves",
    note: "instalment reaches the lending bank",
  }
): Promise<LoanServiceResult> {
  const empty: LoanServiceResult = {
    interestCollected: 0,
    principalRepaid: 0,
    writtenOff: 0,
    bankCredit: 0,
    totalLoansDelta: 0,
  };
  if (loan.lastProcessedTurn === turn) return empty;

  const outstanding = Math.max(0, loan.outstanding ?? 0);
  if (outstanding <= 0) {
    await db.collection<BankLoan>("bankLoans").updateOne(
      { _id: loan._id, lastProcessedTurn: { $ne: turn } },
      {
        $set: {
          status: "repaid",
          outstanding: 0,
          lastProcessedTurn: turn,
          arrearsTurns: 0,
        },
      }
    );
    return empty;
  }

  const remainingTurns = Math.max(1, loan.originatedTurn + loan.termTurns - turn);
  const interestDue = (outstanding * (loan.ratePercent / 100)) / TURNS_PER_YEAR;
  const principalDue = outstanding / remainingTurns;
  const paymentDue = interestDue + principalDue;

  const borrowerName = await readBorrowerName(db, loan);
  const ledger = { bankName, borrowerName };

  const available = await readBorrowerAvailable(db, loan, currency);
  const payment = Math.min(paymentDue, Math.max(0, available));

  if (payment < paymentDue - 1e-9) {
    // Partial or zero - arrears path
    const interestPaid = Math.min(payment, interestDue);
    const principalPaid = Math.max(0, payment - interestPaid);
    const nextOutstanding = Math.max(0, outstanding - principalPaid);
    const arrearsTurns = (loan.arrearsTurns ?? 0) + 1;

    if (arrearsTurns >= ARREARS_DEFAULT_TURNS) {
      const marked = markLoanDefaulted({ outstanding: nextOutstanding, status: "arrears" });
      const collected = await collectLoanPayment(
        db,
        turn,
        loan,
        currency,
        payment,
        creditTarget,
        ledger
      );
      await db.collection<BankLoan>("bankLoans").updateOne(
        { _id: loan._id, lastProcessedTurn: { $ne: turn } },
        {
          $set: {
            outstanding: marked.outstanding,
            status: marked.status,
            arrearsTurns,
            lastProcessedTurn: turn,
          },
        }
      );
      return {
        interestCollected: interestPaid,
        principalRepaid: principalPaid,
        writtenOff: marked.outstanding,
        bankCredit: collected,
        totalLoansDelta: -(principalPaid + marked.outstanding),
      };
    }

    const collectedPartial = await collectLoanPayment(
      db,
      turn,
      loan,
      currency,
      payment,
      creditTarget,
      ledger
    );
    await db.collection<BankLoan>("bankLoans").updateOne(
      { _id: loan._id, lastProcessedTurn: { $ne: turn } },
      {
        $set: {
          outstanding: nextOutstanding,
          status: "arrears",
          arrearsTurns,
          lastProcessedTurn: turn,
        },
      }
    );
    return {
      interestCollected: interestPaid,
      principalRepaid: principalPaid,
      writtenOff: 0,
      bankCredit: collectedPartial,
      totalLoansDelta: -principalPaid,
    };
  }

  // Full payment
  const interestPaid = interestDue;
  const principalPaid = Math.min(principalDue, outstanding);
  const afterPay = applyLoanPayment({ outstanding, status: loan.status }, principalPaid);

  const collectedFull = await collectLoanPayment(
    db,
    turn,
    loan,
    currency,
    paymentDue,
    creditTarget,
    ledger
  );
  await db.collection<BankLoan>("bankLoans").updateOne(
    { _id: loan._id, lastProcessedTurn: { $ne: turn } },
    {
      $set: {
        outstanding: afterPay.outstanding,
        status: afterPay.status,
        arrearsTurns: 0,
        lastProcessedTurn: turn,
      },
    }
  );

  return {
    interestCollected: interestPaid,
    principalRepaid: principalPaid,
    writtenOff: 0,
    bankCredit: collectedFull,
    totalLoansDelta: -principalPaid,
  };
}

/** Borrower display name for the ledger leg. One read per serviced loan. */
async function readBorrowerName(db: Db, loan: BankLoan): Promise<string> {
  if (!loan.borrowerId) return "Borrower";
  if (loan.borrowerType === "character") {
    const ch = await db
      .collection<Character>("characters")
      .findOne({ _id: loan.borrowerId }, { projection: { name: 1 } });
    return ch?.name ?? "Borrower";
  }
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.borrowerId }, { projection: { name: 1 } });
  return corp?.name ?? "Borrower";
}

async function readBorrowerAvailable(
  db: Db,
  loan: BankLoan,
  currency: CurrencyCode
): Promise<number> {
  if (!loan.borrowerId) return 0;
  if (loan.borrowerType === "character") {
    const ch = await db
      .collection<Character>("characters")
      .findOne(
        { _id: loan.borrowerId },
        { projection: { [`currencyBalances.personal.${currency}`]: 1 } }
      );
    return Math.max(0, ch?.currencyBalances?.personal?.[currency] ?? 0);
  }
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.borrowerId }, { projection: { liquidCapital: 1 } });
  return Math.max(0, corp?.liquidCapital ?? 0);
}

/**
 * The single chokepoint every repayment path goes through: full payment,
 * partial/arrears, and the final debit before a default is written off.
 *
 * It now moves BOTH sides. It used to debit the borrower and leave the bank's
 * side as a number the caller added to an in-memory total that was flushed at
 * the end of the whole pass, so a crash anywhere in between destroyed the
 * payment: the borrower had paid and nobody had been paid. The two legs go
 * through the shared primitive under a per-loan key, which also makes a retried
 * turn unable to charge the same borrower twice for the same loan.
 *
 * Returns what actually moved, which is zero when the guard refused the debit.
 */
async function collectLoanPayment(
  db: Db,
  turn: number,
  loan: BankLoan,
  currency: CurrencyCode,
  amount: number,
  creditTarget: MoneyTarget,
  ledger?: { bankName: string; borrowerName: string }
): Promise<number> {
  if (!(amount > 0) || !loan.borrowerId) return 0;

  const borrowerPath =
    loan.borrowerType === "character" ? `currencyBalances.personal.${currency}` : "liquidCapital";
  const borrowerCollection = loan.borrowerType === "character" ? "characters" : "corporations";

  const move = await applyMoneyMove(db, {
    key: `loan-service:${loan._id.toString()}:${turn}`,
    kind: "loan_service",
    turn,
    legs: [
      {
        kind: "debit",
        amount,
        collection: borrowerCollection,
        filter: { _id: loan.borrowerId },
        path: borrowerPath,
        note: "borrower pays the instalment",
      },
      {
        kind: "credit",
        amount,
        collection: creditTarget.collection,
        filter: creditTarget.filter,
        path: creditTarget.path,
        note: creditTarget.note,
      },
    ],
  });

  if (move.status !== "applied") return 0;

  if (ledger) {
    await emitTx(db, {
      type: "bank_loan_repayment",
      turn,
      createdAt: new Date(),
      subjectType: loan.borrowerType === "character" ? "character" : "corporation",
      subjectId: loan.borrowerId,
      subjectName: ledger.borrowerName,
      amount: -amount,
      currencyCode: currency,
      counterpartyType: "corporation",
      counterpartyId: loan.bankCorporationId,
      counterpartyName: ledger.bankName,
      meta: { loanId: loan._id.toString() },
    });
  }
  return amount;
}

type NpcBulkState = {
  /** Total lending capacity from deposits after the reserve requirement. */
  loanFundingCapacity: number;
  cashReserves: number;
  totalLoans: number;
  cbDocId: string;
  cb?: Pick<CentralBank, "externalBroadMoney">;
  bankName: string;
  /** Cash the bank must retain; origination may only spend above this. */
  requiredReserves: number;
  /** CEO's stance: which credit bands this bank will originate into. */
  lendingProfile?: LendingProfileId;
};

type NpcBulkResult = {
  cashReserves: number;
  totalLoans: number;
  interestCollected: number;
  writtenOff: number;
  shortfall: number;
};

/**
 * Service the household book, one tranche per credit band.
 *
 * The book used to be a single `npcBulk` loan carrying one rate and one blended
 * default rate — which is why the console could only report it as one implied
 * number. It is now one loan document per band, so the same servicing loop
 * produces a book that can be read by rating and shocked by composition.
 *
 * Two rules govern what the CEO's lending profile may touch:
 *
 *  - It selects which bands are ORIGINATED into from here on. Bands outside the
 *    profile get a target of zero and wind down at the ordinary flow cap; they
 *    are not called in, repriced, or written off early.
 *  - A tranche already on the book keeps the rate it was originated at. Rate
 *    changes reach the book only through new origination, which is what "does
 *    not change existing loans" has to mean if it is to mean anything.
 *
 * A pre-split book has no `creditBand`. It is serviced as its own tranche with
 * a target of zero, at its own stored rate, so it runs off gradually while the
 * banded tranches build. Total book size lands in the same place; only its
 * composition changes, and only at the flow cap.
 */
async function serviceNpcBulkBook(
  db: Db,
  turn: number,
  bankCorporationId: ObjectId,
  currency: CurrencyCode,
  lendingRatePercent: number,
  state: NpcBulkState
): Promise<NpcBulkResult> {
  let { cashReserves, totalLoans } = state;
  // Net cash handed to (positive) or received from (negative) the household
  // pool this pass. Flushed to the central bank once at the end.
  let creditedToPool = 0;
  let interestCollected = 0;
  let writtenOff = 0;
  let shortfall = 0;

  const existing = await db
    .collection<BankLoan>("bankLoans")
    .find({
      bankCorporationId,
      borrowerType: "npcBulk",
      status: { $in: ["current", "arrears"] },
    })
    .toArray();

  // Idempotency: the whole book is stamped together, so one processed tranche
  // means the pass already ran for this bank this turn.
  if (existing.some((loan) => loan.lastProcessedTurn === turn)) {
    return { cashReserves, totalLoans, interestCollected, writtenOff, shortfall };
  }

  const currentTotal = existing.reduce((sum, loan) => sum + Math.max(0, loan.outstanding ?? 0), 0);
  const nonNpcLoans = Math.max(0, totalLoans - currentTotal);
  const npcFundingCapacity = Math.max(0, state.loanFundingCapacity - nonNpcLoans);

  const openBands = bandsForProfile(state.lendingProfile);
  const byBand = new Map<string, BankLoan>();
  const legacy: BankLoan[] = [];
  for (const loan of existing) {
    if (loan.creditBand) byBand.set(loan.creditBand, loan);
    else legacy.push(loan);
  }

  type TrancheWork = {
    loan: BankLoan | null;
    band: CreditBandId | undefined;
    target: number;
    ratePercent: number;
    defaultRatePercent: number;
  };

  const work: TrancheWork[] = [];

  for (const band of CREDIT_BANDS) {
    const open = openBands.some((b) => b.id === band.id);
    const loan = byBand.get(band.id) ?? null;
    if (!open && !loan) continue;

    const rate = bandRatePercent(band, lendingRatePercent);
    // Demand for a band is its share of the bank's funding capacity, taken at
    // the rate that band is actually charged: price still moves volume, it just
    // moves it per band now instead of across the whole book at once.
    const target = open
      ? Math.max(0, computeNpcLoanBook(npcFundingCapacity * band.demandShare, rate).volume)
      : 0;

    work.push({
      loan,
      band: band.id,
      target,
      // An existing tranche keeps its originated rate; only a fresh one prices
      // at today's rate.
      ratePercent: loan ? (loan.ratePercent ?? rate) : rate,
      defaultRatePercent: band.defaultRatePercent,
    });
  }

  for (const loan of legacy) {
    work.push({
      loan,
      band: undefined,
      target: 0,
      ratePercent: loan.ratePercent ?? lendingRatePercent,
      defaultRatePercent: getCreditBand(undefined).defaultRatePercent,
    });
  }

  const now = new Date();
  const bulkOps: AnyBulkWriteOperation<BankLoan>[] = [];
  /** Interest the household pool owes this bank across every credit band. */
  let interestFromPool = 0;

  for (const tranche of work) {
    const current = Math.max(0, tranche.loan?.outstanding ?? 0);
    let adjust = npcFlowDelta(current, tranche.target);

    // Originating a loan HANDS OVER CASH. The bank can only lend what it holds
    // above its reserve requirement, so the ramp is clamped to that headroom
    // rather than being free. Repayment brings the cash back.
    //
    // Without this the loan book was an asset conjured from nothing that paid
    // real interest forever, which is the same money-from-nowhere problem as
    // the deposit side and made the reserve ratio decorative.
    if (adjust > 0) {
      const lendable = Math.max(0, cashReserves - state.requiredReserves);
      adjust = Math.min(adjust, lendable);
      if (adjust > 0) {
        cashReserves -= adjust;
        creditedToPool += adjust; // cash goes out to the household pool
      }
    } else if (adjust < 0) {
      // Principal repaid: cash returns from the household pool.
      cashReserves += -adjust;
      creditedToPool -= -adjust;
    }

    const nextOutstandingBeforeYield = Math.max(0, current + adjust);
    if (nextOutstandingBeforeYield <= 0 && current <= 0) continue;

    totalLoans = Math.max(0, totalLoans + adjust);

    // Interest is real cash the unmodeled NPC economy pays out of the central
    // bank's externalBroadMoney pool (the named counterparty). Defaults destroy
    // loan asset only - no cash moves for a writeoff.
    const interest = (nextOutstandingBeforeYield * (tranche.ratePercent / 100)) / TURNS_PER_YEAR;
    const defaults =
      (nextOutstandingBeforeYield * (tranche.defaultRatePercent / 100)) / TURNS_PER_YEAR;

    const poolAvailable =
      typeof state.cb?.externalBroadMoney === "number" &&
      Number.isFinite(state.cb.externalBroadMoney)
        ? Math.max(0, state.cb.externalBroadMoney)
        : 0;
    const interestAffordable = Math.min(interest, poolAvailable);
    if (interestAffordable > 0) {
      // Accumulated rather than written per tranche: one move for the whole
      // book, so the household pool and the vault cannot be left disagreeing
      // by however many credit bands happened to be processed before a crash.
      interestFromPool += interestAffordable;
      if (state.cb) {
        state.cb.externalBroadMoney = poolAvailable - interestAffordable;
      }
      cashReserves += interestAffordable;
      interestCollected += interestAffordable;
    }
    if (interest > interestAffordable) {
      shortfall += interest - interestAffordable;
    }
    writtenOff += defaults;

    const afterDefaults = Math.max(0, nextOutstandingBeforeYield - defaults);
    totalLoans = Math.max(0, totalLoans - defaults);

    if (tranche.loan) {
      bulkOps.push({
        updateOne: {
          filter: { _id: tranche.loan._id },
          update: {
            $set: {
              outstanding: afterDefaults,
              principal: Math.max(tranche.loan.principal ?? 0, afterDefaults),
              ratePercent: tranche.ratePercent,
              status: afterDefaults <= 0 ? "repaid" : "current",
              lastProcessedTurn: turn,
            },
          },
        },
      });
    } else if (afterDefaults > 0) {
      bulkOps.push({
        insertOne: {
          document: {
            _id: new ObjectId(),
            bankCorporationId,
            currency,
            borrowerType: "npcBulk",
            creditBand: tranche.band,
            principal: afterDefaults,
            outstanding: afterDefaults,
            ratePercent: tranche.ratePercent,
            originatedTurn: turn,
            termTurns: NPC_BULK_TERM_TURNS,
            status: "current",
            lastProcessedTurn: turn,
          } as BankLoan,
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await db.collection<BankLoan>("bankLoans").bulkWrite(bulkOps);
  }

  // Settle the cash that moved between the bank and the household pool. Two
  // moves for the whole book rather than one write per band: what the pool paid
  // in interest, and the net principal that was lent out or came back.
  const bankIdHex = bankCorporationId.toString();
  const bankVault: MoneyTarget = {
    collection: "corporations",
    filter: { _id: bankCorporationId },
    path: "bankCharter.cashReserves",
    note: "the lending bank's vault",
  };
  const householdPool: MoneyTarget = {
    collection: "centralBanks",
    filter: { _id: state.cbDocId },
    path: "externalBroadMoney",
    note: "the household money pool",
  };

  if (interestFromPool > 0) {
    await applyMoneyMove(db, {
      key: turnMoveKey("npc-book-interest", bankIdHex, turn),
      kind: "npc_book_interest",
      turn,
      legs: [
        { kind: "debit", amount: interestFromPool, ...householdPool },
        { kind: "credit", amount: interestFromPool, ...bankVault },
      ],
    });
  }

  if (creditedToPool !== 0) {
    const lendingOut = creditedToPool > 0;
    const amount = Math.abs(creditedToPool);
    await applyMoneyMove(db, {
      key: turnMoveKey("npc-book-principal", bankIdHex, turn),
      kind: "npc_book_principal",
      turn,
      legs: [
        { kind: lendingOut ? "debit" : "credit", amount, ...bankVault },
        { kind: lendingOut ? "credit" : "debit", amount, ...householdPool },
      ],
    });
    if (state.cb) {
      state.cb.externalBroadMoney = Math.max(
        0,
        (state.cb.externalBroadMoney ?? 0) + creditedToPool
      );
    }
  }

  // One interest row for the whole book rather than one per band: this fires
  // for every bank every turn, and seven rows per bank per turn would bury the
  // ledger for no extra information the tranches do not already carry.
  if (interestCollected > 0) {
    await emitTx(db, {
      type: "bank_npc_loan_interest",
      turn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: bankCorporationId,
      subjectName: state.bankName,
      amount: interestCollected,
      currencyCode: currency,
      counterpartyType: "system",
      counterpartyName: "NPC households",
      meta: {
        borrowerType: "npcBulk",
        tranches: work.length,
        lendingProfile: state.lendingProfile ?? DEFAULT_LENDING_PROFILE,
      },
    });
  }

  return { cashReserves, totalLoans, interestCollected, writtenOff, shortfall };
}

/**
 * Service interbank interest (borrower → lender) and CB margin interest
 * (borrower cash destroyed; mirror of LOC principal creation/destruction).
 * Runs even when no deposit-taking banks need a pass this turn.
 */
async function serviceInterbankAndCbMargin(
  db: Db,
  turn: number,
  summary: BankingTurnSummary
): Promise<void> {
  const loans = await db
    .collection<InterbankLoan>("interbankLoans")
    .find({
      status: "current",
      lastProcessedTurn: { $ne: turn },
    })
    .toArray();

  for (const loan of loans) {
    const result = await serviceOneInterbankLoan(db, turn, loan);
    summary.interbankInterestPaid += result.interestPaid;
    summary.interbankDefaultsWrittenOff += result.writtenOff;
  }

  const marginBanks = await db
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.status": "active",
      // Either central-bank facility puts a bank in this pass. Selecting on the
      // margin line alone would leave a bank that drew ONLY on the discount
      // window (B8) unserviced forever — borrowing interest-free.
      $and: [
        {
          $or: [
            { "bankCharter.cbMarginDebt": { $gt: 0 } },
            { "bankCharter.discountWindowDebt": { $gt: 0 } },
          ],
        },
        {
          $or: [
            { "bankCharter.lastCbMarginTurn": { $ne: turn } },
            { "bankCharter.lastCbMarginTurn": { $exists: false } },
            { "bankCharter.lastDiscountWindowTurn": { $ne: turn } },
            { "bankCharter.lastDiscountWindowTurn": { $exists: false } },
          ],
        },
      ],
    })
    .project({ _id: 1, liquidCapital: 1, bankCharter: 1 })
    .toArray();

  const primeByCurrency = new Map<CurrencyCode, number>();
  // Margin interest received, per currency, flushed to the issuing central bank
  // once at the end. Same destination line-of-credit interest already uses.
  const cbReserveInc = new Map<CurrencyCode, number>();

  for (const corp of marginBanks) {
    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") continue;
    const hasMargin = (charter.cbMarginDebt ?? 0) > 0 && charter.lastCbMarginTurn !== turn;
    const hasWindow =
      (charter.discountWindowDebt ?? 0) > 0 && charter.lastDiscountWindowTurn !== turn;
    if (!hasMargin && !hasWindow) continue;

    const currency = charter.currency as CurrencyCode;
    if (!primeByCurrency.has(currency)) {
      const bankId = getBankId(getCountryIdForCurrency(currency));
      const cb = await db
        .collection<CentralBank>("centralBanks")
        .findOne({ _id: bankId }, { projection: { primeRate: 1 } });
      const prime =
        typeof cb?.primeRate === "number" && Number.isFinite(cb.primeRate) ? cb.primeRate : 0;
      primeByCurrency.set(currency, prime);
    }
    const rate = cbMarginRatePercent(primeByCurrency.get(currency) ?? 0);
    const debt = hasMargin ? Math.max(0, charter.cbMarginDebt ?? 0) : 0;
    const interestDue = (debt * (rate / 100)) / TURNS_PER_YEAR;
    const liquid = getCashReserves(charter);
    const paid = Math.min(interestDue, liquid);
    const shortfall = Math.max(0, interestDue - paid);

    // Interest is CB revenue, exactly like line-of-credit interest, which credits
    // the same reserveBalance. Destroying it here while crediting it there made
    // the same concept (a central-bank loan to a player-controlled borrower)
    // move money two opposite ways depending on who borrowed.
    //
    // A shortfall is no longer merely tallied: it accrues as arrears on the
    // charter and joins the principal the draw cap is measured against, so a
    // bank that cannot service the line loses headroom rather than borrowing its
    // own unpaid interest indefinitely.
    const marginUpdate: {
      $inc?: Record<string, number>;
      $set: { "bankCharter.lastCbMarginTurn": number; updatedAt: Date };
    } = {
      $set: {
        "bankCharter.lastCbMarginTurn": turn,
        updatedAt: new Date(),
      },
    };
    if (paid > 0 || shortfall > 0) {
      marginUpdate.$inc = {
        ...(paid > 0 ? { "bankCharter.cashReserves": -paid } : {}),
        ...(shortfall > 0 ? { "bankCharter.cbMarginArrears": shortfall } : {}),
      };
    }
    await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corp._id,
        "bankCharter.status": "active",
        $or: [
          { "bankCharter.lastCbMarginTurn": { $ne: turn } },
          { "bankCharter.lastCbMarginTurn": { $exists: false } },
        ],
      },
      marginUpdate
    );

    // B8: discount-window interest, serviced on the same terms as the margin
    // line — paid to the CB's reserve balance, shortfall accrued as arrears so
    // a bank that cannot service the facility loses headroom rather than
    // borrowing its own unpaid interest indefinitely (the B3 rule).
    const windowDebt = Math.max(0, charter.discountWindowDebt ?? 0);
    if (hasWindow) {
      const windowRate = discountWindowRatePercent(primeByCurrency.get(currency) ?? 0);
      const windowInterestDue = (windowDebt * (windowRate / 100)) / TURNS_PER_YEAR;
      const availableAfterMargin = Math.max(0, liquid - paid);
      const windowPaid = Math.min(windowInterestDue, availableAfterMargin);
      const windowShortfall = Math.max(0, windowInterestDue - windowPaid);
      await db.collection<Corporation>("corporations").updateOne(
        {
          _id: corp._id,
          "bankCharter.status": "active",
          $or: [
            { "bankCharter.lastDiscountWindowTurn": { $ne: turn } },
            { "bankCharter.lastDiscountWindowTurn": { $exists: false } },
          ],
        },
        {
          ...(windowPaid > 0 || windowShortfall > 0
            ? {
                $inc: {
                  ...(windowPaid > 0 ? { "bankCharter.cashReserves": -windowPaid } : {}),
                  ...(windowShortfall > 0
                    ? { "bankCharter.discountWindowArrears": windowShortfall }
                    : {}),
                },
              }
            : {}),
          $set: { "bankCharter.lastDiscountWindowTurn": turn, updatedAt: new Date() },
        }
      );
      if (windowPaid > 0) {
        cbReserveInc.set(currency, (cbReserveInc.get(currency) ?? 0) + windowPaid);
      }
    }

    if (paid > 0) {
      cbReserveInc.set(currency, (cbReserveInc.get(currency) ?? 0) + paid);
    }

    summary.cbMarginInterestPaid += paid;
    summary.cbMarginInterestShortfall += shortfall;
  }

  for (const [currency, inc] of cbReserveInc) {
    if (inc <= 0) continue;
    await db
      .collection<CentralBank>("centralBanks")
      .updateOne(
        { _id: getBankId(getCountryIdForCurrency(currency)) },
        { $inc: { reserveBalance: inc } }
      );
  }
}

/**
 * Interbank interest: one guarded pair, not two hopeful writes.
 *
 * Both sides are banks, so both legs are real cash. The old version debited the
 * borrower with a sufficiency guard and then credited the lender
 * unconditionally, without checking whether the debit had matched, so a
 * borrower whose balance had moved produced a lender credit with no debit
 * behind it. That is money created by a race, in the subsystem whose entire
 * problem is money that appears from nowhere.
 */
async function payInterbankInterest(
  db: Db,
  turn: number,
  loan: InterbankLoan,
  amount: number
): Promise<number> {
  if (!(amount > 0)) return 0;
  const move = await applyMoneyMove(db, {
    key: `interbank-interest:${loan._id.toString()}:${turn}`,
    kind: "interbank_interest",
    turn,
    legs: [
      {
        kind: "debit",
        amount,
        collection: "corporations",
        filter: { _id: loan.borrowerCorporationId },
        path: "bankCharter.cashReserves",
        note: "borrowing bank pays interbank interest",
      },
      {
        kind: "credit",
        amount,
        collection: "corporations",
        filter: { _id: loan.lenderCorporationId },
        path: "bankCharter.cashReserves",
        note: "lending bank receives interbank interest",
      },
    ],
  });
  return move.status === "applied" ? amount : 0;
}

type InterbankServiceResult = { interestPaid: number; writtenOff: number };

async function serviceOneInterbankLoan(
  db: Db,
  turn: number,
  loan: InterbankLoan
): Promise<InterbankServiceResult> {
  const empty: InterbankServiceResult = { interestPaid: 0, writtenOff: 0 };
  if (loan.lastProcessedTurn === turn) return empty;

  const outstanding = Math.max(0, loan.outstanding ?? 0);
  if (outstanding <= 0) {
    await db
      .collection<InterbankLoan>("interbankLoans")
      .updateOne(
        { _id: loan._id, lastProcessedTurn: { $ne: turn } },
        { $set: { status: "repaid", outstanding: 0, lastProcessedTurn: turn, arrearsTurns: 0 } }
      );
    return empty;
  }

  // Interest-only service (principal repaid via repayInterbank). Same shortfall /
  // ARREARS_DEFAULT_TURNS path as player loans.
  const interestDue = (outstanding * (loan.ratePercent / 100)) / TURNS_PER_YEAR;
  const borrower = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: loan.borrowerCorporationId }, { projection: { bankCharter: 1 } });
  // Both sides of an interbank loan are banks, so both legs move bank cash.
  const available = getCashReserves(borrower?.bankCharter);
  const payment = Math.min(interestDue, available);

  if (payment < interestDue - 1e-9) {
    const arrearsTurns = (loan.arrearsTurns ?? 0) + 1;
    const partialPaid = await payInterbankInterest(db, turn, loan, payment);

    if (arrearsTurns >= ARREARS_DEFAULT_TURNS) {
      // Write off: no cash moves for the remaining principal; clear borrower debt.
      await db.collection<Corporation>("corporations").updateOne(
        { _id: loan.borrowerCorporationId },
        {
          $inc: { "bankCharter.interbankDebt": -outstanding },
          $set: { updatedAt: new Date() },
        }
      );
      await db.collection<InterbankLoan>("interbankLoans").updateOne(
        { _id: loan._id, lastProcessedTurn: { $ne: turn } },
        {
          $set: {
            status: "defaulted",
            outstanding,
            arrearsTurns,
            lastProcessedTurn: turn,
          },
        }
      );
      return { interestPaid: partialPaid, writtenOff: outstanding };
    }

    await db.collection<InterbankLoan>("interbankLoans").updateOne(
      { _id: loan._id, lastProcessedTurn: { $ne: turn } },
      {
        $set: {
          arrearsTurns,
          lastProcessedTurn: turn,
        },
      }
    );
    return { interestPaid: partialPaid, writtenOff: 0 };
  }

  // Full interest
  const fullPaid = await payInterbankInterest(db, turn, loan, payment);
  await db.collection<InterbankLoan>("interbankLoans").updateOne(
    { _id: loan._id, lastProcessedTurn: { $ne: turn } },
    {
      $set: {
        arrearsTurns: 0,
        lastProcessedTurn: turn,
      },
    }
  );
  return { interestPaid: fullPaid, writtenOff: 0 };
}
