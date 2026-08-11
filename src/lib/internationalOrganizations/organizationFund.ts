import { ObjectId, type Db } from "mongodb";
import { type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import {
  DEFAULT_ORG_DUES_RATE_ANNUAL,
  INTERNATIONAL_ORGANIZATIONS,
  MAX_ORG_DUES_RATE_ANNUAL,
  MIN_ORG_DUES_RATE_ANNUAL,
  ORG_DUES_TURNS_PER_YEAR,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import { getOrganizationFundsCollection } from "@/lib/db/collections";
import type { FederalBudget } from "@/lib/db/types";
import { loadOrganizationDef } from "@/lib/internationalOrganizations/service";

/** Per-turn USD dues a member owes given its USD GDP + the org's annual rate. */
export function memberDueUsd(gdpUsd: number, duesRateAnnual: number): number {
  if (!(gdpUsd > 0) || !(duesRateAnnual > 0)) return 0;
  return (gdpUsd * duesRateAnnual) / ORG_DUES_TURNS_PER_YEAR;
}

/**
 * Convert a country's local-currency amount to USD (USD = local × rate).
 * `preset` selects the era's rate (refs #3778) — see `getGdpAnchorRate`.
 */
export function localToUsd(country: CountryId, amountLocal: number, preset?: string): number {
  if (!(amountLocal > 0)) return 0;
  return Math.round(amountLocal * getGdpAnchorRate(country, preset));
}

/**
 * Convert an amount from one country's local currency to another's, via USD
 * (USD = local × rate ⇒ toLocal = amount × fromRate / toRate). Same country → no-op.
 */
export function convertLocal(
  from: CountryId,
  to: CountryId,
  amount: number,
  preset?: string
): number {
  if (!(amount > 0)) return 0;
  if (from === to) return Math.round(amount);
  const fromRate = getGdpAnchorRate(from, preset);
  const toRate = getGdpAnchorRate(to, preset);
  return Math.round((amount * fromRate) / toRate);
}

/**
 * The country whose local currency an org's fund is denominated in: its first
 * founding member. Built-ins resolve from the constant (EU → DE/euro, NATO/UN →
 * US/USD); custom orgs from their stored founding members (the founder). US fallback.
 */
export async function resolveOrgFundCurrencyCountry(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<CountryId> {
  const builtin =
    INTERNATIONAL_ORGANIZATIONS[organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS];
  if (builtin) return (builtin.foundingMembers[0] as CountryId) ?? "US";
  const def = await loadOrganizationDef(db, organizationId);
  return (def?.foundingMembers?.[0] as CountryId) ?? "US";
}

/** Clamp a proposed annual dues rate to the allowed band. */
export function clampDuesRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_ORG_DUES_RATE_ANNUAL;
  return Math.min(MAX_ORG_DUES_RATE_ANNUAL, Math.max(MIN_ORG_DUES_RATE_ANNUAL, rate));
}

/**
 * Read an org's fund: balance (founding-currency), dues rate, and the currency
 * country. Defaults when the doc is absent (resolving the currency country from
 * the org). `balanceUsd` legacy docs fall back numerically.
 */
export async function getOrganizationFund(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<{ balanceLocal: number; duesRateAnnual: number; currencyCountryId: CountryId }> {
  const col = await getOrganizationFundsCollection(db);
  const row = await col.findOne({ organizationId });
  const currencyCountryId =
    row?.currencyCountryId ?? (await resolveOrgFundCurrencyCountry(db, organizationId));
  return {
    // `balanceUsd` fallback covers pre-rename docs (built-ins sit at rate 1.0).
    balanceLocal: row?.balanceLocal ?? (row as { balanceUsd?: number } | null)?.balanceUsd ?? 0,
    duesRateAnnual: row?.duesRateAnnual ?? DEFAULT_ORG_DUES_RATE_ANNUAL,
    currencyCountryId,
  };
}

/** Set an org's dues rate (clamped); creates the fund row if absent. */
export async function setOrganizationDuesRate(
  db: Db,
  organizationId: InternationalOrganizationId,
  rate: number
): Promise<void> {
  const col = await getOrganizationFundsCollection(db);
  const currencyCountryId = await resolveOrgFundCurrencyCountry(db, organizationId);
  await col.updateOne(
    { organizationId },
    {
      $set: { duesRateAnnual: clampDuesRate(rate), updatedAt: new Date() },
      $setOnInsert: { _id: new ObjectId(), organizationId, balanceLocal: 0, currencyCountryId },
    },
    { upsert: true }
  );
}

/**
 * Charge per-turn dues from each member's treasury into the org fund. Each
 * member is debited its due in its OWN local currency; the fund is credited the
 * total converted into the FUND's (founding) currency. Returns the fund-currency
 * total charged.
 */
export async function chargeOrganizationDues(
  db: Db,
  organizationId: InternationalOrganizationId,
  memberGdpUsd: { countryId: CountryId; gdpUsd: number }[]
): Promise<number> {
  const { duesRateAnnual, currencyCountryId } = await getOrganizationFund(db, organizationId);
  if (!(duesRateAnnual > 0) || memberGdpUsd.length === 0) return 0;
  const preset = await loadWorldPreset(db);
  const now = new Date();
  const budget = db.collection<FederalBudget>("federalBudget");
  let totalFund = 0;
  for (const m of memberGdpUsd) {
    const dueUsd = memberDueUsd(m.gdpUsd, duesRateAnnual);
    if (dueUsd <= 0) continue;
    const rate = getGdpAnchorRate(m.countryId, preset);
    const dueLocal = Math.round(dueUsd / rate); // member's own currency (debit)
    if (dueLocal <= 0) continue;
    await budget.updateOne(
      { countryId: m.countryId },
      { $inc: { treasuryBalance: -dueLocal }, $set: { updatedAt: now } }
    );
    // Credit the fund in its (founding) currency.
    const fundRate = getGdpAnchorRate(currencyCountryId, preset);
    totalFund += dueUsd / fundRate;
  }
  const totalFundRounded = Math.round(totalFund);
  if (totalFundRounded > 0) {
    const col = await getOrganizationFundsCollection(db);
    await col.updateOne(
      { organizationId },
      {
        $inc: { balanceLocal: totalFundRounded },
        $set: { updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), organizationId, duesRateAnnual, currencyCountryId },
      },
      { upsert: true }
    );
  }
  return totalFundRounded;
}

/** Credit `amountLocal` (already in the fund's currency) into the pooled fund. */
export async function creditOrganizationFund(
  db: Db,
  organizationId: InternationalOrganizationId,
  amountLocal: number
): Promise<void> {
  if (!(amountLocal > 0)) return;
  const col = await getOrganizationFundsCollection(db);
  const currencyCountryId = await resolveOrgFundCurrencyCountry(db, organizationId);
  await col.updateOne(
    { organizationId },
    {
      $inc: { balanceLocal: Math.round(amountLocal) },
      $set: { updatedAt: new Date() },
      $setOnInsert: {
        _id: new ObjectId(),
        organizationId,
        duesRateAnnual: DEFAULT_ORG_DUES_RATE_ANNUAL,
        currencyCountryId,
      },
    },
    { upsert: true }
  );
}

/**
 * Disburse `amountLocal` (in the fund's currency) only if the balance covers it
 * (atomic guarded update — the fund never goes negative). Returns whether it paid.
 */
export async function disburseFromOrganizationFund(
  db: Db,
  organizationId: InternationalOrganizationId,
  amountLocal: number
): Promise<boolean> {
  const amount = Math.round(amountLocal);
  if (!(amount > 0)) return false;
  const col = await getOrganizationFundsCollection(db);
  const res = await col.updateOne(
    { organizationId, balanceLocal: { $gte: amount } },
    { $inc: { balanceLocal: -amount }, $set: { updatedAt: new Date() } }
  );
  return res.modifiedCount > 0;
}
