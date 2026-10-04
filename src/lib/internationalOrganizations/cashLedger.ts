/**
 * Organization cash accounting witnesses real treasury and pooled-fund writes.
 * Funded flows share a settlement reason; tribute from unmodeled treasuries has
 * its own explicit mint. Valuation never changes the existing cash conversion.
 */
import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import type { LedgerEntryInput } from "@/lib/ledger/types";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";

export interface OrganizationCashContext {
  turn: number;
  preset: string;
  ledgerShadowEnabled?: boolean;
  treasuryCashLedgerEnabled?: boolean;
  rates: ReadonlyMap<string, number>;
  budgetCurrencies: ReadonlyMap<string, CurrencyCode>;
  fundCountries: ReadonlyMap<string, CountryId>;
  pending?: LedgerEntryInput[];
}

export interface OrganizationCashOptions {
  context?: OrganizationCashContext | null;
  turn?: number;
}

export interface OrganizationFundedCashMove {
  key: string;
  kind: string;
  source: {
    collection: string;
    filter: Record<string, unknown>;
    path: string;
    amount: number;
    currencyCode: CurrencyCode;
    localPerAnchor: number;
  };
  destination: {
    collection: string;
    filter: Record<string, unknown>;
    path: string;
    amount: number;
    currencyCode: CurrencyCode;
    localPerAnchor: number;
  };
  sourceTreasuryCountry?: CountryId;
  destinationTreasuryCountry?: CountryId;
  command: string;
}

export function organizationTreasuryLocalPerAnchor(
  context: OrganizationCashContext,
  countryId: CountryId
): number {
  const currency =
    context.budgetCurrencies.get(countryId) ?? COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
  return treasuryAnchorValuation({
    countryId,
    currencyCode: currency,
    preset: context.preset,
    observedRate: context.rates.get(currency),
  }).anchorRate;
}

export function organizationLocalPerAnchor(
  context: OrganizationCashContext,
  countryId: CountryId
): number {
  const currency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
  const rate = context.rates.get(currency);
  return !rate || rate <= 0 ? 1 : rate;
}

/** Settle a funded cross-currency organization move with its original FX quote. */
export async function settleOrganizationFundedCashMove(
  db: Db,
  context: OrganizationCashContext,
  input: OrganizationFundedCashMove
): Promise<SettlementResult> {
  if (!context.treasuryCashLedgerEnabled) {
    throw new Error("Funded organization cash move requires the cash-ledger policy");
  }
  const journal = db.collection<{ _id: string }>("bankMoneyMoves");
  if (await journal.findOne({ _id: input.key }, { projection: { _id: 1 } })) {
    return resumeSettlement(db, input.key);
  }
  const amountAnchor = input.source.amount / input.source.localPerAnchor;
  const destinationAnchor = input.destination.amount / input.destination.localPerAnchor;
  if (
    !Number.isFinite(amountAnchor) ||
    amountAnchor <= 0 ||
    Math.abs(amountAnchor - destinationAnchor) > 1e-6
  ) {
    throw new Error("Funded organization cash move does not conserve its frozen anchor value");
  }
  const [sourceTarget, destinationTarget] = await Promise.all([
    db.collection(input.source.collection).findOne(input.source.filter, { projection: { _id: 1 } }),
    db
      .collection(input.destination.collection)
      .findOne(input.destination.filter, { projection: { _id: 1 } }),
  ]);
  if (!sourceTarget || !destinationTarget) {
    return {
      status: "rejected",
      key: input.key,
      appliedLegs: [],
      appliedProjections: [],
      newlyAppliedProjections: [],
      error: "Funded organization cash move has no matching source or destination",
    };
  }
  return settleTransition(db, {
    key: input.key,
    kind: input.kind,
    turn: context.turn,
    currency: input.source.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: input.source.amount,
        valuation: {
          currencyCode: input.source.currencyCode,
          localPerAnchor: input.source.localPerAnchor,
        },
        collection: input.source.collection,
        filter: { ...input.source.filter, _id: sourceTarget._id },
        path: input.source.path,
        note: "Fund the organization cash movement from its existing balance",
      },
      {
        kind: "credit",
        amount: input.destination.amount,
        valuation: {
          currencyCode: input.destination.currencyCode,
          localPerAnchor: input.destination.localPerAnchor,
        },
        collection: input.destination.collection,
        filter: { ...input.destination.filter, _id: destinationTarget._id },
        path: input.destination.path,
        note: "Deliver the cash movement to its destination",
      },
    ],
    projections: [
      ...(input.sourceTreasuryCountry
        ? [
            {
              collection: "federalBudget",
              filter: { countryId: input.sourceTreasuryCountry },
              update: { $inc: { treasuryBalance: -input.source.amount } },
              note: "Update signed fiscal position after the funded debit",
            },
          ]
        : []),
      ...(input.destinationTreasuryCountry
        ? [
            {
              collection: "federalBudget",
              filter: { countryId: input.destinationTreasuryCountry },
              update: { $inc: { treasuryBalance: input.destination.amount } },
              note: "Update signed fiscal position after the funded credit",
            },
          ]
        : []),
    ],
    event: {
      kind: "monetary.executed",
      command: input.command,
      amount: input.source.amount,
      meta: {
        sourceCurrency: input.source.currencyCode,
        destinationCurrency: input.destination.currencyCode,
        sourceLocalPerAnchor: input.source.localPerAnchor,
        destinationLocalPerAnchor: input.destination.localPerAnchor,
      },
    },
  });
}

/** Same stored/native currency boundary as organizationFunds in the M2 snapshot. */
export function organizationFundCountry(
  organizationId: string,
  storedCountry?: CountryId,
  customFounders?: ReadonlyMap<string, CountryId>
): CountryId {
  return (
    storedCountry ??
    (INTERNATIONAL_ORGANIZATIONS[organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
      ?.foundingMembers[0] as CountryId | undefined) ??
    customFounders?.get(organizationId) ??
    "US"
  );
}

/** One projected read per cohort, not one accounting query per member. */
export async function loadOrganizationCashContext(
  db: Db,
  turn?: number
): Promise<OrganizationCashContext | null> {
  try {
    const config = await db
      .collection<{
        _id: string;
        ledgerShadow?: boolean;
        treasuryCashLedgerEnabled?: boolean;
      }>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { ledgerShadow: 1, treasuryCashLedgerEnabled: 1 } }
      );
    const ledgerShadowEnabled = config?.ledgerShadow === true;
    const treasuryCashLedgerEnabled = config?.treasuryCashLedgerEnabled === true;
    if (!ledgerShadowEnabled && !treasuryCashLedgerEnabled) return null;
    const [state, rates, budgets, funds, custom] = await Promise.all([
      db
        .collection<{ _id: string; currentTurn: number; preset?: string }>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1, preset: 1 } }),
      db
        .collection<{ currencyCode: string; rate: number }>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      db
        .collection<{ countryId: string; currencyCode?: CurrencyCode }>("federalBudget")
        .find({}, { projection: { countryId: 1, currencyCode: 1 } })
        .toArray(),
      db
        .collection<{ organizationId: string; currencyCountryId?: CountryId }>("organizationFunds")
        .find({}, { projection: { organizationId: 1, currencyCountryId: 1 } })
        .toArray(),
      db
        .collection<{ id: string; foundingMembers?: CountryId[] }>(
          "customInternationalOrganizations"
        )
        .find({}, { projection: { id: 1, foundingMembers: 1 } })
        .toArray(),
    ]);
    const resolvedTurn = turn ?? state?.currentTurn;
    if (resolvedTurn === undefined || !Number.isInteger(resolvedTurn)) {
      throw new Error("Organization cash witness requires a turn");
    }
    const founders = new Map(custom.map((row) => [row.id, row.foundingMembers?.[0] ?? "US"]));
    return {
      turn: resolvedTurn,
      preset: state?.preset ?? DEFAULT_SEED_PRESET,
      ledgerShadowEnabled,
      treasuryCashLedgerEnabled,
      rates: new Map(rates.map((row) => [row.currencyCode, row.rate])),
      budgetCurrencies: new Map(
        budgets.map((row) => [
          row.countryId,
          row.currencyCode ?? COUNTRY_CURRENCY_MAP[row.countryId as CountryId] ?? "USD",
        ])
      ),
      fundCountries: new Map(
        funds.map((row) => [
          row.organizationId,
          organizationFundCountry(row.organizationId, row.currencyCountryId, founders),
        ])
      ),
    };
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "loadOrganizationCashContext" } });
    return null;
  }
}

export async function organizationCashContext(
  db: Db,
  options?: OrganizationCashOptions
): Promise<OrganizationCashContext | null> {
  return options?.context === undefined
    ? loadOrganizationCashContext(db, options?.turn)
    : options.context;
}

/** Every input describes a rounded movement whose authoritative write landed. */
export async function witnessOrganizationCash(
  db: Db,
  context: OrganizationCashContext | null,
  input: {
    kind: "government" | "org";
    ref: string;
    countryId: CountryId;
    amount: number;
    site: string;
    now: Date;
    modeledTribute?: boolean;
  }
): Promise<void> {
  if (
    !context ||
    !context.ledgerShadowEnabled ||
    !Number.isFinite(input.amount) ||
    input.amount === 0
  )
    return;
  try {
    const countryId =
      input.kind === "org"
        ? (context.fundCountries.get(input.ref) ?? input.countryId)
        : input.countryId;
    const currency =
      input.kind === "government"
        ? (context.budgetCurrencies.get(input.ref) ?? COUNTRY_CURRENCY_MAP[countryId] ?? "USD")
        : (COUNTRY_CURRENCY_MAP[countryId] ?? "USD");
    const rate = context.rates.get(currency);
    const denominator =
      input.kind === "government"
        ? treasuryAnchorValuation({
            countryId,
            currencyCode: currency,
            preset: context.preset,
            observedRate: rate,
          }).anchorRate
        : !rate || rate <= 0
          ? 1
          : rate;
    const anchorAmount = input.amount / denominator;
    const reason = input.modeledTribute
      ? "organization_tribute_unmodeled"
      : "organization_fund_cash";
    const entry: LedgerEntryInput = {
      turn: context.turn,
      createdAt: input.now,
      txType: input.modeledTribute ? "org_tribute_mint" : "org_cash",
      emitSite: `internationalOrganizations/${input.site}`,
      legs: [
        {
          account: accountId(input.kind, input.ref, currency),
          amount: input.amount,
          currencyCode: currency,
          anchorAmount,
          role: "primary",
        },
        {
          account: mintSinkAccount(anchorAmount, reason, currency),
          amount: -input.amount,
          currencyCode: currency,
          anchorAmount: -anchorAmount,
          role: "contra",
        },
      ],
    };
    if (context.pending) context.pending.push(entry);
    else await emitLedgerEntries(db, [entry]);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { phase: "witnessOrganizationCash", site: input.site },
    });
  }
}

/** Flush landed movements even if a later operation in the cohort fails. */
export async function withOrganizationCashBatch<T>(
  db: Db,
  context: OrganizationCashContext | null,
  work: (context: OrganizationCashContext | null) => Promise<T>
): Promise<T> {
  const pending: LedgerEntryInput[] = [];
  try {
    return await work(context ? { ...context, pending } : null);
  } finally {
    await emitLedgerEntries(db, pending);
  }
}
