import type { Db } from "mongodb";
import type { Character, CentralBank, SavingsLedgerEntry } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCountryIdForCurrency,
  FOREX_ACTIVE_COUNTRIES,
  FOREX_ACTIVE_CURRENCIES,
} from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  computeSavingsInterestForTurn,
  interestEligibleBalance,
  roundSavingsAmount,
  SAVINGS_CREDIT_INTERVAL_TURNS,
} from "@/lib/currency/savingsInterest";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildSavingsInterestAccrualBulkOp } from "@/lib/currency/characterFunds";
import { getNppAutonomyLevel, nppAutonomyLevelAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { processNppSavingsInterest } from "@/lib/turn/nppSavingsInterest";

const DEFAULT_PRIME = 2.5;

/**
 * Interest on savings held at the CENTRAL bank had no payer.
 *
 * Every quarter the pass credited each account and nothing was debited
 * anywhere, so the money supply grew by an amount that appeared in no ledger,
 * no operation record and no telemetry. On a subsystem whose whole disease is
 * quantities with no cash behind them, an uncounted mint is the disease itself.
 *
 * The payer is the central bank, which is who actually pays it: these accounts
 * are liabilities of the CB, and interest on them is currency creation. That is
 * already a modelled thing here, so this books it the same way an open-market
 * operation is booked, against `externalBroadMoney` and
 * `netMoneyCreatedLifetime`. Nothing about the player's credit changes; what
 * changes is that the money now comes from somewhere, shows up in the money
 * supply, and therefore feeds the inflation signal that prices it.
 *
 * Deposits held at a PRIVATE bank are not on this path at all: `bankingTurn`
 * pays those out of the bank's own `cashReserves`, and the accrual loop below
 * skips any account whose `savingsHolder` is a bank.
 */
async function bookCentralBankInterestCreation(
  db: Db,
  interestByCountry: Map<CountryId, number>
): Promise<void> {
  const rows = [...interestByCountry.entries()].filter(([, amount]) => amount > 0);
  if (rows.length === 0) return;

  // Shared-bank countries (IE and the rest of the euro area) roll up into one
  // doc, so sum before writing rather than issuing competing increments.
  const byBankId = new Map<string, number>();
  for (const [countryId, amount] of rows) {
    const bankId = getBankId(countryId);
    byBankId.set(bankId, (byBankId.get(bankId) ?? 0) + amount);
  }

  await db.collection<CentralBank>("centralBanks").bulkWrite(
    [...byBankId.entries()].map(([bankId, amount]) => ({
      updateOne: {
        filter: { _id: bankId },
        update: {
          $inc: {
            externalBroadMoney: Math.round(amount * 100) / 100,
            netMoneyCreatedLifetime: Math.round(amount * 100) / 100,
            savingsInterestPaidLifetime: Math.round(amount * 100) / 100,
          },
        },
      },
    }))
  );
}

/**
 * Savings interest turn (forex path): two-phase quarterly compounding.
 *
 * Every turn: accrue per-turn interest into currencyBalances.pendingSavingsInterest (no balance
 * change visible to the player yet).
 *
 * Every 12 turns (one game quarter): flush all pending interest into the savings balance, update
 * the lifetime interestEarned counter, and write a single ledger transaction per currency — this
 * is the moment compounding occurs (next period's accrual runs on the enlarged balance).
 *
 * Non-forex path (legacy savingsOnHand): still credited per-turn, unchanged.
 */
export async function processSavingsInterestTurn(
  db: Db,
  turn: number
): Promise<{ charactersProcessed: number; totalInterest: number }> {
  const forexEnabled = await isForexEnabled();

  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({})
    .project({ _id: 1, primeRate: 1, nationalSavingsBalance: 1, inflationHistory: 1 })
    .toArray();
  const primeByCountryId = new Map<string, number>();
  const inflationByCountryId = new Map<string, number>();
  // Prior-turn national savings stock, used as the pool basis for the per-account
  // share cap. Read from the stored value (written at the end of last turn's pass)
  // so the cap needs no second aggregation pass this turn.
  const poolTotalByCountryId = new Map<string, number>();
  for (const b of banks) {
    const id = typeof b._id === "string" ? b._id : String(b._id);
    primeByCountryId.set(id, b.primeRate ?? DEFAULT_PRIME);
    poolTotalByCountryId.set(id, b.nationalSavingsBalance ?? 0);
    // Live realized inflation (same source forexTurn.ts uses); 0 when no history yet.
    inflationByCountryId.set(id, b.inflationHistory?.at(-1)?.rate ?? 0);
  }

  // The maps above are keyed by bank _id, so resolve through getBankId: the
  // EUR anchor is DE but its bank doc is the shared "ECB" — a raw countryId
  // lookup would silently fall back to DEFAULT_PRIME for every EUR account.
  const resolvePrime = (currency: CurrencyCode): number => {
    const bankId = getBankId(getCountryIdForCurrency(currency));
    return primeByCountryId.get(bankId) ?? DEFAULT_PRIME;
  };

  const resolvePoolTotal = (currency: CurrencyCode): number => {
    const bankId = getBankId(getCountryIdForCurrency(currency));
    return poolTotalByCountryId.get(bankId) ?? 0;
  };

  // Local inflation for the currency's jurisdiction. Savings pays the REAL rate
  // (prime − inflation), which is what neutralises the cross-currency carry trade.
  const resolveInflation = (currency: CurrencyCode): number => {
    const bankId = getBankId(getCountryIdForCurrency(currency));
    return inflationByCountryId.get(bankId) ?? 0;
  };

  // ─────────────────────────────────────────
  // Forex path: quarterly compounding
  // ─────────────────────────────────────────
  if (forexEnabled) {
    const isQuarterlyCredit = turn > 0 && turn % SAVINGS_CREDIT_INTERVAL_TURNS === 0;

    // Phase 1: accrue this turn's interest into the pending bucket
    const accrualFilter = {
      $or: FOREX_ACTIVE_CURRENCIES.map((c) => ({
        [`currencyBalances.savings.${c}`]: { $gt: 0 },
      })),
    };
    const accrualCharacters = await db
      .collection<Character>("characters")
      .find(accrualFilter)
      .project({ _id: 1, currencyBalances: 1 })
      .toArray();

    // Accumulate national savings balance per country (keyed by currency jurisdiction).
    // Summed here during the accrual pass so inflationRecalc can read it from centralBanks
    // without running its own character aggregation each turn.
    const nationalSavingsBalance = new Map<CountryId, number>();

    const accrualOps: { updateOne: { filter: object; update: object } }[] = [];
    for (const char of accrualCharacters) {
      const savings = char.currencyBalances?.savings ?? {};
      const holders = char.currencyBalances?.savingsHolder ?? {};
      const perCharInc: Record<string, number> = {};
      const perCharFilter: Record<string, unknown> = { _id: char._id };
      for (const [code, bal] of Object.entries(savings)) {
        const oldBalance = typeof bal === "number" ? bal : 0;
        if (oldBalance <= 0) continue;
        const currency = code as CurrencyCode;
        // Accumulate balance under the currency's country jurisdiction
        const cid = getCountryIdForCurrency(currency) as CountryId;
        nationalSavingsBalance.set(cid, (nationalSavingsBalance.get(cid) ?? 0) + oldBalance);
        // Bank-held deposits earn from the bank's cash in bankingTurn — do not mint.
        const holder = holders[currency];
        if (holder != null && holder !== "centralBank") continue;
        const prime = resolvePrime(currency);
        // Interest accrues on the REAL rate (prime − inflation) and only on up to
        // SAVINGS_POOL_SHARE_CAP of the national pool, so no single account can farm
        // ~100% of a currency's savings at a free nominal rate (#3064).
        const eligible = interestEligibleBalance(oldBalance, resolvePoolTotal(currency));
        const interest = computeSavingsInterestForTurn(
          eligible,
          prime,
          currency,
          resolveInflation(currency)
        );
        if (interest <= 0) continue;
        perCharInc[`currencyBalances.pendingSavingsInterest.${currency}`] = interest;
        // Price interest only against the balance and holder snapshot we read.
        // A concurrent deposit, withdrawal, or bank-routing change makes this
        // operation miss rather than receiving stale-snapshot interest.
        perCharFilter[`currencyBalances.savings.${currency}`] = oldBalance;
        perCharFilter[`currencyBalances.savingsHolder.${currency}`] = holder ?? null;
      }
      if (Object.keys(perCharInc).length > 0) {
        accrualOps.push({
          updateOne: { filter: perCharFilter, update: { $inc: perCharInc } },
        });
      }
    }
    if (accrualOps.length > 0) {
      await db.collection("characters").bulkWrite(accrualOps);
    }

    // Write national savings balances to centralBanks for inflationRecalc to read.
    // Always refresh every forex country (including 0) so the stock never stays stale
    // after the last account in that currency is closed.
    // Use getBankId so shared-bank countries (e.g. IE → ECB) write to the correct doc.
    await db.collection<CentralBank>("centralBanks").bulkWrite(
      FOREX_ACTIVE_COUNTRIES.map((cid) => ({
        updateOne: {
          filter: { _id: getBankId(cid) },
          update: {
            $set: {
              nationalSavingsBalance:
                Math.round((nationalSavingsBalance.get(cid) ?? 0) * 100) / 100,
            },
          },
        },
      }))
    );

    // Phase 2 (quarterly): flush pending → savings balance, log ledger transaction
    let totalInterest = 0;
    if (isQuarterlyCredit) {
      const creditFilter = {
        $or: FOREX_ACTIVE_CURRENCIES.map((c) => ({
          [`currencyBalances.pendingSavingsInterest.${c}`]: { $gt: 0 },
        })),
      };
      const creditCharacters = await db
        .collection<Character>("characters")
        .find(creditFilter)
        .project({ _id: 1, currencyBalances: 1 })
        .toArray();

      const creditOps: { updateOne: { filter: object; update: object } }[] = [];
      const ledgerBatch: Omit<SavingsLedgerEntry, "_id">[] = [];
      const now = new Date();
      // What the central bank is about to pay, by jurisdiction.
      const interestPaidByCountry = new Map<CountryId, number>();

      for (const char of creditCharacters) {
        const pending = char.currencyBalances?.pendingSavingsInterest ?? {};
        const savingsNow = char.currencyBalances?.savings ?? {};
        const holders = char.currencyBalances?.savingsHolder ?? {};
        const perCharInc: Record<string, number> = {};
        const perCharSet: Record<string, number> = {};

        for (const [code, pendingAmt] of Object.entries(pending)) {
          const amount = typeof pendingAmt === "number" ? pendingAmt : 0;
          if (amount <= 0) continue;
          const currency = code as CurrencyCode;
          // Bank-held deposits are paid by bankingTurn; do not flush minted pending.
          const holder = holders[currency];
          if (holder != null && holder !== "centralBank") continue;
          totalInterest += amount;
          const payingCountry = getCountryIdForCurrency(currency) as CountryId;
          interestPaidByCountry.set(
            payingCountry,
            (interestPaidByCountry.get(payingCountry) ?? 0) + amount
          );
          perCharInc[`currencyBalances.savings.${currency}`] = amount;
          perCharInc[`currencyBalances.interestEarned.${currency}`] = amount;
          // Zero out pending (keep key present so next accrual uses $inc cleanly)
          perCharSet[`currencyBalances.pendingSavingsInterest.${currency}`] = 0;
          const currentSavings =
            typeof savingsNow[currency as CurrencyCode] === "number"
              ? (savingsNow[currency as CurrencyCode] ?? 0)
              : 0;
          ledgerBatch.push({
            characterId: char._id,
            countryId: getCountryIdForCurrency(currency),
            currencyCode: currency,
            type: "interest",
            amount,
            balanceAfter: roundSavingsAmount(currentSavings + amount, currency),
            turn,
            createdAt: now,
          });
        }

        if (Object.keys(perCharInc).length > 0) {
          creditOps.push({
            updateOne: {
              filter: { _id: char._id },
              update: { $inc: perCharInc, $set: perCharSet },
            },
          });
        }
      }

      if (creditOps.length > 0) {
        await db.collection("characters").bulkWrite(creditOps);
        // Booked AFTER the credit lands: crediting first and failing here
        // understates money created, which is recoverable from the ledger;
        // booking first and failing there overstates it, which is not.
        await bookCentralBankInterestCreation(db, interestPaidByCountry);
      }
      if (ledgerBatch.length > 0) {
        await db.collection("savingsLedger").insertMany(ledgerBatch);

        // Emit savings_interest tx log entries for each quarterly credit
        const thresholds = await loadTxThresholds(db);
        const charIds = [...new Set(ledgerBatch.map((e) => e.characterId))];
        const nameDocs = await db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .project({ _id: 1, name: 1 })
          .toArray();
        const nameById = new Map(nameDocs.map((c) => [c._id.toString(), c.name as string]));
        void emitTxBulk(
          db,
          ledgerBatch.map((e) => ({
            type: "savings_interest" as const,
            turn,
            createdAt: e.createdAt,
            subjectType: "character" as const,
            subjectId: e.characterId,
            subjectName: nameById.get(e.characterId.toString()) ?? "",
            amount: e.amount,
            currencyCode: e.currencyCode,
            balanceAfter: e.balanceAfter,
          })),
          thresholds
        );
      }
    }

    // v3 full-agency: accrue/compound interest on autonomous NPP savings in an
    // isolated pass (same forex two-phase model, writing to `npps`). Gated so
    // the player path is unaffected below v3.
    // v3 AND ABOVE — a strict `=== "v3"` here used to switch NPP savings
    // interest back off the moment the level was raised to v4.
    if (nppAutonomyLevelAtLeast(await getNppAutonomyLevel(db), "v3")) {
      await processNppSavingsInterest(db, turn, resolvePrime, resolveInflation, resolvePoolTotal);
    }

    return { charactersProcessed: accrualOps.length, totalInterest };
  }

  // ─────────────────────────────────────────
  // Legacy path (non-forex): per-turn credit, unchanged
  // ─────────────────────────────────────────
  const legacyFilter = { $or: [{ savingsOnHand: { $gt: 0 } }] };
  const characters = await db
    .collection<Character>("characters")
    .find(legacyFilter)
    .project({ _id: 1, name: 1, countryId: 1, savingsOnHand: 1, currencyBalances: 1 })
    .toArray();

  const bulkOps: ReturnType<typeof buildSavingsInterestAccrualBulkOp>[] = [];
  const ledgerBatch: Omit<SavingsLedgerEntry, "_id">[] = [];
  let totalInterest = 0;
  const legacyNationalBalance = new Map<CountryId, number>();
  const legacyInterestByCountry = new Map<CountryId, number>();

  for (const char of characters) {
    const sav = char.savingsOnHand ?? 0;
    if (sav <= 0) continue;
    // Track national balance for inflation signal (legacy path: home currency = countryId)
    legacyNationalBalance.set(
      char.countryId as CountryId,
      (legacyNationalBalance.get(char.countryId as CountryId) ?? 0) + sav
    );
    const home = getHomeCurrency(char as Character);
    const prime = resolvePrime(home);
    const eligible = interestEligibleBalance(sav, resolvePoolTotal(home));
    const interest = computeSavingsInterestForTurn(eligible, prime, home, resolveInflation(home));
    if (interest <= 0) continue;
    totalInterest += interest;
    const payingCountry = getCountryIdForCurrency(home) as CountryId;
    legacyInterestByCountry.set(
      payingCountry,
      (legacyInterestByCountry.get(payingCountry) ?? 0) + interest
    );
    bulkOps.push(buildSavingsInterestAccrualBulkOp(char._id, interest, home, false));
    ledgerBatch.push({
      characterId: char._id,
      countryId: char.countryId,
      currencyCode: home,
      type: "interest",
      amount: interest,
      balanceAfter: roundSavingsAmount(sav + interest, home),
      turn,
      createdAt: new Date(),
    });
  }

  if (bulkOps.length === 0) {
    return { charactersProcessed: 0, totalInterest: 0 };
  }

  await db.collection("characters").bulkWrite(bulkOps);
  await bookCentralBankInterestCreation(db, legacyInterestByCountry);
  if (ledgerBatch.length > 0) {
    await db.collection("savingsLedger").insertMany(ledgerBatch);

    // Emit savings_interest tx log entries (legacy path — per-turn credit)
    const thresholds = await loadTxThresholds(db);
    const nameMap = new Map(characters.map((c) => [c._id.toString(), (c as Character).name]));
    void emitTxBulk(
      db,
      ledgerBatch.map((e) => ({
        type: "savings_interest" as const,
        turn,
        createdAt: e.createdAt,
        subjectType: "character" as const,
        subjectId: e.characterId,
        subjectName: nameMap.get(e.characterId.toString()) ?? "",
        amount: e.amount,
        currencyCode: e.currencyCode,
        balanceAfter: e.balanceAfter,
      })),
      thresholds
    );
  }
  if (legacyNationalBalance.size > 0) {
    await db.collection<CentralBank>("centralBanks").bulkWrite(
      [...legacyNationalBalance.entries()].map(([cid, balance]) => ({
        updateOne: {
          filter: { _id: getBankId(cid) },
          update: { $set: { nationalSavingsBalance: Math.round(balance * 100) / 100 } },
        },
      }))
    );
  }
  return { charactersProcessed: bulkOps.length, totalInterest };
}
