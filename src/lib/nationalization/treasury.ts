import type { Db, ObjectId } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { resolveCountryCurrencyCode, writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { getCurrencyFxRate } from "@/lib/currency/corporationCapital";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import {
  resolveTreasuryCashOptions,
  witnessTreasuryCash,
  type TreasuryCashFlow,
  type TreasuryCashOptions,
} from "./treasuryLedger";
import { settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";

/**
 * Opt-in government-side witness for an event-driven caller whose own rows do
 * not already evidence the treasury. Callers that emit a government row leave
 * it out, so no flow is witnessed twice.
 */
export interface TreasuryWitness {
  flow: TreasuryCashFlow;
  key?: string;
  site?: string;
  /** Internal marker set after the funded cash receipt has landed. */
  fundedTransitionLanded?: boolean;
  ledger?: TreasuryCashOptions;
  /** The corporation the caller's counterparty rows settle against, when it only passes the cash through. */
  passThroughCorpId?: string;
}

async function witnessTreasuryLeg(
  db: Db,
  witness: TreasuryWitness | undefined,
  countryId: CountryId,
  amount: number,
  now: Date,
  site: string
): Promise<void> {
  if (!witness || witness.fundedTransitionLanded) return;
  if (witness.ledger?.context?.treasuryCashLedgerEnabled) return;
  await witnessTreasuryCash(db, witness.ledger, {
    flow: witness.flow,
    account: { kind: "government", countryId },
    amount,
    now,
    site: `treasury:${site}`,
    passThroughCorpId: witness.passThroughCorpId,
  });
}

/**
 * Government cash account for nationalization money flows.
 *
 * All "government money" — nationalization compensation, CEO treasury draws,
 * privatization proceeds, SOE remittance and loss-backing — moves the country's
 * signed `federalBudget.treasuryBalance` (the unified national cash position; see
 * the live-treasury-balance spec §5). The balance is allowed to go negative (the
 * country takes on debt); FX-intervention reserves live in a separate
 * `centralBanks.reserveBalance` field and are untouched here. Each flow keeps its
 * corp-side counterparty, so money is conserved — only the account changed.
 */

/**
 * Move `delta` (signed, country-local currency) on the country's treasury balance.
 *
 * Every nationalization/SOE/privatization cash flow funnels through here as a
 * cash-only `$inc` (concurrent-safe). `debt.principal` belongs to the bond
 * ledger (see bonds/sovereignPrincipal.ts) and is correctly left alone (#1975).
 * Returns whether a treasury matched, so callers witness only cash that landed.
 */
async function incTreasuryBalance(
  db: Db,
  countryId: CountryId,
  delta: number,
  now: Date,
  witness?: TreasuryWitness
): Promise<boolean> {
  const ledger = witness ? await resolveTreasuryCashOptions(db, witness.ledger) : undefined;
  if (ledger?.context?.treasuryCashLedgerEnabled) {
    if (witness) witness.fundedTransitionLanded = true;
    if (delta > 0) {
      throw new Error(
        `Funded Treasury credit for ${countryId} requires a durable paired source leg`
      );
    }
    if (!witness?.key) throw new Error("Funded Treasury movement requires a stable receipt key");
    const amount = Math.abs(delta);
    const currency =
      ledger.context.treasuryCurrencies.get(countryId) ??
      (await loadTreasuryCurrency(db, countryId));
    const transition: BankingTransition = {
      key: `treasury-nationalization:${witness.key}`,
      kind: "treasury_funded_expense",
      turn: ledger.context.turn,
      currency,
      legs: [
        {
          kind: "debit",
          amount,
          collection: "federalBudget",
          filter: { countryId, treasuryCashLocal: { $gte: amount } },
          path: "treasuryCashLocal",
          note: "Fund the nationalization or SOE expense from spendable Treasury cash",
        },
        { kind: "burn", amount, note: "Settle the expense outside Treasury cash" },
      ],
      projections: [
        {
          collection: "federalBudget",
          filter: { countryId },
          update: { $inc: { treasuryBalance: delta }, $set: { updatedAt: now } },
          note: "Update signed fiscal position after the funded expense",
        },
      ],
      event: {
        kind: "monetary.executed",
        command: witness.site ?? "nationalization.treasury",
        subjectType: "government",
        subjectId: countryId,
        amount,
        meta: { flow: witness.flow },
      },
    };
    const result = await settleTransition(db, transition);
    if (result.status === "rejected" || result.status === "partial") {
      throw new Error(result.error ?? "Funded Treasury expense is incomplete");
    }
    return result.status === "applied" || result.status === "replayed";
  }
  const result = await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ countryId }, { $inc: { treasuryBalance: delta }, $set: { updatedAt: now } });
  return (result?.matchedCount ?? 0) > 0;
}

/** Resolve the denomination of the persisted treasury, including 2027 EUR budgets. */
export async function loadTreasuryCurrency(db: Db, countryId: CountryId): Promise<CurrencyCode> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId }, { projection: { countryId: 1, currencyCode: 1 } });
  return resolveCountryCurrencyCode(budget ?? { countryId }) ?? "USD";
}

/**
 * Debit `payoutAnchor` (₳) of nationalization compensation from the country's
 * treasury, converting to home currency at `fxByCurrency`. Returns the local
 * amount debited. The debit is unconditional — an unaffordable payout simply
 * pushes the treasury further into the hole (national debt) rather than being
 * blocked, consistent with the unified-treasury model. Seizure (0 payout) moves
 * nothing.
 */
export async function debitTreasuryCompensation(
  db: Db,
  countryId: CountryId,
  payoutAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  witness?: TreasuryWitness,
  treasuryCurrency?: CurrencyCode
): Promise<number> {
  if (payoutAnchor <= 0) return 0;

  const currency = treasuryCurrency ?? (await loadTreasuryCurrency(db, countryId));
  const rate = fxByCurrency.get(currency) ?? 1;
  const payoutLocal = Math.round(writeGovBudgetLocal(payoutAnchor, currency, rate));

  if (await incTreasuryBalance(db, countryId, -payoutLocal, now, witness)) {
    await witnessTreasuryLeg(db, witness, countryId, -payoutLocal, now, "compensation");
  }
  return payoutLocal;
}

/**
 * Debit an already-local amount from a country's treasury. Mirror of
 * `creditTreasuryProceeds`, for money the state hands back rather than
 * collects (C4 group loss relief). Unconditional, like every other treasury
 * debit here: an unaffordable refund pushes the treasury further into debt
 * rather than being silently withheld.
 */
export async function debitTreasury(
  db: Db,
  countryId: CountryId,
  amountLocal: number,
  now: Date,
  witness?: TreasuryWitness
): Promise<number> {
  if (!(amountLocal > 0)) return 0;
  const amount = Math.round(amountLocal);
  if (await incTreasuryBalance(db, countryId, -amount, now, witness)) {
    await witnessTreasuryLeg(db, witness, countryId, -amount, now, "debitTreasury");
  }
  return amount;
}

/**
 * Credit divestiture proceeds (privatization IPO float sale, spec §13.2) to the
 * country's treasury, in home currency. `proceedsLocal` is already denominated in
 * the country's currency (the spun-out corp's sharePrice is local), so no FX
 * conversion is applied. Returns the local amount credited. Inverse of
 * {@link debitTreasuryCompensation}; symmetric double-entry with the share-float pool.
 */
export async function creditTreasuryProceeds(
  db: Db,
  countryId: CountryId,
  proceedsLocal: number,
  now: Date,
  witness?: TreasuryWitness
): Promise<number> {
  if (proceedsLocal <= 0) return 0;
  const amount = Math.round(proceedsLocal);
  if (await incTreasuryBalance(db, countryId, amount, now, witness)) {
    await witnessTreasuryLeg(db, witness, countryId, amount, now, "proceeds");
  }
  return amount;
}

/**
 * Credit a country's treasury with an amount denominated in ₳, converting to
 * that country's OWN currency first.
 *
 * Use this instead of `creditTreasuryProceeds` whenever the payer and the
 * receiving country can differ. Fines and assessments are debited from the
 * corporation in the CORPORATION's currency; handing that same figure to
 * `creditTreasuryProceeds`, which expects country-local units, silently treats
 * (say) 50,000 GBP as 50,000 USD, so a cross-border payer over- or under-pays
 * the government by the whole exchange-rate difference (#808).
 *
 * Returns the local amount credited.
 */
export async function creditTreasuryProceedsFromAnchor(
  db: Db,
  countryId: CountryId,
  proceedsAnchor: number,
  now: Date,
  witness?: TreasuryWitness
): Promise<number> {
  if (!(proceedsAnchor > 0)) return 0;
  const currency = await loadTreasuryCurrency(db, countryId);
  const rate = await getCurrencyFxRate(db, currency);
  const amount = Math.round(writeGovBudgetLocal(proceedsAnchor, currency, rate));
  if (amount <= 0) return 0;
  if (await incTreasuryBalance(db, countryId, amount, now, witness)) {
    await witnessTreasuryLeg(db, witness, countryId, amount, now, "proceedsFromAnchor");
  }
  return amount;
}

/**
 * Cover an SOE operating-loss shortfall (spec §11.2 — SOEs cannot go bankrupt).
 * Unconditional debit of the treasury in home currency (the national budget's
 * cash account). `shortfallAnchor` is the positive ₳ amount needed to bring the
 * SOE's liquidCapital back to zero. Returns the local amount debited.
 */
export async function coverSoeOperatingLoss(
  db: Db,
  countryId: CountryId,
  shortfallAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  ledger?: TreasuryCashOptions,
  treasuryCurrency?: CurrencyCode,
  operationKey?: string
): Promise<number> {
  if (shortfallAnchor <= 0) return 0;
  const currency = treasuryCurrency ?? (await loadTreasuryCurrency(db, countryId));
  const rate = fxByCurrency.get(currency) ?? 1;
  const local = Math.round(writeGovBudgetLocal(shortfallAnchor, currency, rate));
  const witness: TreasuryWitness = {
    flow: "soe_loss_backing",
    key: operationKey,
    ledger,
    site: "treasury:coverSoeOperatingLoss",
  };
  if (
    (await incTreasuryBalance(db, countryId, -local, now, witness)) &&
    !witness.fundedTransitionLanded
  ) {
    await witnessTreasuryCash(db, ledger, {
      flow: "soe_loss_backing",
      account: { kind: "government", countryId },
      amount: -local,
      now,
      site: "treasury:coverSoeOperatingLoss",
    });
  }
  return local;
}

/**
 * Debit the owning treasury for a state capex grant — the budgeted line that
 * buys back one turn of depreciation on a state enterprise's capacity (plants
 * tier; see `applyStateCapexGrants`).
 *
 * Deliberately NOT `drawFromTreasury`: the money never becomes corp cash. The
 * state pays the builder and the enterprise receives PLANT, so the grant cannot
 * be diverted into a discretionary build order — which is what keeps the P3b
 * anti-exploit ("an SOE cannot have the treasury fund an unbounded build")
 * closed. Unconditional debit, exactly like {@link coverSoeOperatingLoss}: an
 * unaffordable grant pushes the treasury into debt rather than being refused.
 * Returns the local amount debited.
 */
export async function debitTreasurySoeCapex(
  db: Db,
  countryId: CountryId,
  grantAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  ledger?: TreasuryCashOptions,
  treasuryCurrency?: CurrencyCode,
  operationKey?: string
): Promise<number> {
  if (!(grantAnchor > 0)) return 0;
  const currency = treasuryCurrency ?? (await loadTreasuryCurrency(db, countryId));
  const rate = fxByCurrency.get(currency) ?? 1;
  const local = Math.round(writeGovBudgetLocal(grantAnchor, currency, rate));
  if (local <= 0) return 0;
  const witness: TreasuryWitness = {
    flow: "soe_capex_grant",
    key: operationKey,
    ledger,
    site: "treasury:debitTreasurySoeCapex",
  };
  if (
    (await incTreasuryBalance(db, countryId, -local, now, witness)) &&
    !witness.fundedTransitionLanded
  ) {
    await witnessTreasuryCash(db, ledger, {
      flow: "soe_capex_grant",
      account: { kind: "government", countryId },
      amount: -local,
      now,
      site: "treasury:debitTreasurySoeCapex",
    });
  }
  return local;
}

/**
 * CEO treasury draw (spec P6g §5.2): move `amountLocal` (already in the country's
 * currency — a NatCorp's liquidCapital is local) from the treasury into the
 * National Corporation's liquidCapital. The debit is unconditional — a draw is
 * permitted even when it pushes the treasury negative. The per-turn
 * `treasuryDrawCap` (set by the treasury minister; 0 disables draws entirely) is
 * the only hard limit, enforced by the route. Returns `{ ok: true, amount }`.
 */
export async function drawFromTreasury(
  db: Db,
  input: TreasuryTransferInput,
  now: Date,
  ledger?: TreasuryCashOptions
): Promise<{ ok: true; amount: number }> {
  const amount = Math.round(input.amountLocal);
  if (amount <= 0) return { ok: true, amount: 0 };

  const debited = await incTreasuryBalance(db, input.countryId, -amount, now);
  const credited = await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: input.corpId },
      { $inc: { liquidCapital: amount }, $set: { updatedAt: now } }
    );
  await witnessTreasuryTransfer(db, ledger, "soe_treasury_draw", input, now, {
    treasury: debited ? -amount : 0,
    corporation: (credited?.matchedCount ?? 0) > 0 ? amount : 0,
  });
  return { ok: true, amount };
}

/**
 * Per-turn NatCorp profit remittance (spec P6g §5.1): move `amountLocal` from the
 * corp's liquidCapital to the treasury. Inverse of {@link drawFromTreasury}.
 * Returns the amount moved. The corp's profit has already accrued to liquidCapital
 * in the corp turn, so this just transfers the remitted share out.
 */
export async function remitToTreasury(
  db: Db,
  input: TreasuryTransferInput,
  now: Date,
  ledger?: TreasuryCashOptions
): Promise<number> {
  const amount = Math.round(input.amountLocal);
  if (amount <= 0) return 0;

  const options = await resolveTreasuryCashOptions(db, ledger);
  if (options.context?.treasuryCashLedgerEnabled) {
    const context = options.context;
    const treasuryCurrency =
      context.treasuryCurrencies.get(input.countryId) ??
      COUNTRY_CURRENCY_MAP[input.countryId] ??
      "USD";
    const corporationRate = context.rates.get(input.corpCurrency) ?? 1;
    const treasuryRate = treasuryAnchorValuation({
      countryId: input.countryId,
      currencyCode: treasuryCurrency,
      preset: context.preset,
      observedRate: context.rates.get(treasuryCurrency),
    }).anchorRate;
    const amountAnchor = amount / corporationRate;
    const treasuryAmount = roundSavingsAmount(amountAnchor * treasuryRate, treasuryCurrency);
    const treasury = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: input.countryId }, { projection: { _id: 1 } });
    if (!treasury) throw new Error(`Treasury for ${input.countryId} is unavailable`);
    const key = `treasury-soe-remittance:${context.turn}:${input.corpId.toString()}`;
    const settled = await settleTransition(db, {
      key,
      kind: "soe_profit_remittance",
      turn: context.turn,
      currency: input.corpCurrency,
      legs: [
        {
          kind: "debit",
          amount,
          valuation: { currencyCode: input.corpCurrency, localPerAnchor: corporationRate },
          collection: "corporations",
          filter: { _id: input.corpId },
          path: "liquidCapital",
          note: "Take the realized remittance from the state enterprise's actual cash",
        },
        {
          kind: "credit",
          amount: treasuryAmount,
          valuation: { currencyCode: treasuryCurrency, localPerAnchor: treasuryRate },
          collection: "federalBudget",
          filter: { _id: treasury._id, countryId: input.countryId },
          path: "treasuryCashLocal",
          note: "Deliver the remittance to spendable Treasury cash",
        },
      ],
      projections: [
        {
          collection: "federalBudget",
          filter: { _id: treasury._id },
          update: { $inc: { treasuryBalance: treasuryAmount }, $set: { updatedAt: now } },
          note: "Update signed fiscal position after the funded SOE remittance",
        },
      ],
      event: {
        kind: "monetary.executed",
        command: "turn.soe.remittance",
        subjectType: "corporation",
        subjectId: input.corpId.toString(),
        amount: treasuryAmount,
        meta: {
          sourceCurrency: input.corpCurrency,
          destinationCurrency: treasuryCurrency,
          sourceLocalPerAnchor: corporationRate,
          destinationLocalPerAnchor: treasuryRate,
        },
      },
    });
    if (settled.status === "replayed" && !settled.error) return 0;
    if (settled.status !== "applied") {
      throw new Error(settled.error ?? "Funded SOE remittance is incomplete");
    }
    return amount;
  }

  const debited = await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: input.corpId },
      { $inc: { liquidCapital: -amount }, $set: { updatedAt: now } }
    );
  const credited = await incTreasuryBalance(db, input.countryId, amount, now);
  await witnessTreasuryTransfer(db, options, "soe_remittance", input, now, {
    corporation: (debited?.matchedCount ?? 0) > 0 ? -amount : 0,
    treasury: credited ? amount : 0,
  });
  return amount;
}

/** A treasury and enterprise transfer; `corpCurrency` is the enterprise's ledger account currency. */
export interface TreasuryTransferInput {
  countryId: CountryId;
  corpId: ObjectId;
  amountLocal: number;
  corpCurrency: CurrencyCode;
}

/** Witness each landed leg of a transfer under one context and settlement reason. */
async function witnessTreasuryTransfer(
  db: Db,
  ledger: TreasuryCashOptions | undefined,
  flow: "soe_remittance" | "soe_treasury_draw",
  input: TreasuryTransferInput,
  now: Date,
  landed: { treasury: number; corporation: number }
): Promise<void> {
  if (landed.treasury === 0 && landed.corporation === 0) return;
  const options = await resolveTreasuryCashOptions(db, ledger);
  const site = `treasury:${flow}`;
  await witnessTreasuryCash(db, options, {
    flow,
    account: { kind: "corporation", corpId: input.corpId.toString(), currency: input.corpCurrency },
    amount: landed.corporation,
    now,
    site,
  });
  await witnessTreasuryCash(db, options, {
    flow,
    account: { kind: "government", countryId: input.countryId },
    amount: landed.treasury,
    now,
    site,
  });
}
