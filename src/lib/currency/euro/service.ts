/**
 * Euro monetary settlement preserves each national financial account and ledger
 * denomination. reconcileEuroMonetaryUnion publishes fixed conversion once and
 * refreshes the policy read caches used by national lending and savings books.
 */
import type { AnyBulkWriteOperation, Db, Filter } from "mongodb";
import { COUNTRY_CONFIGS, EU_EUROZONE_MEMBERS, type CountryId } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { GameState } from "@/lib/db/types/gameState";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { resolveGameYear } from "@/lib/era/era";
import { planEuroSettlement, type EuroMonetaryUnion } from "./rules";

export async function loadEuroMonetaryUnion(db: Db): Promise<EuroMonetaryUnion | undefined> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { euroMonetaryUnion: 1 } });
  return state?.euroMonetaryUnion;
}

/** No financial amounts, principal, receipts or account identities are transferred. */
export async function syncEuroMonetaryPolicy(db: Db, union: EuroMonetaryUnion): Promise<void> {
  const banks = db.collection<CentralBank>("centralBanks");
  const authority = await banks.findOne(
    { _id: union.authorityId },
    {
      projection: { primeRate: 1, primeRateSmoothed: 1, bankReserveRequirement: 1 },
    }
  );
  if (!authority || !Number.isFinite(authority.primeRate))
    throw new Error("Euro monetary authority is unavailable");
  const set: Record<string, unknown> = {
    monetaryAuthorityId: union.authorityId,
    primeRate: authority.primeRate,
  };
  const unset: Record<string, ""> = {};
  for (const field of ["primeRateSmoothed", "bankReserveRequirement"] as const) {
    if (typeof authority[field] === "number" && Number.isFinite(authority[field]))
      set[field] = authority[field];
    else unset[field] = "";
  }
  const updates: AnyBulkWriteOperation<CentralBank>[] = [];
  for (const country of Object.keys(union.members) as CountryId[]) {
    const bankId = COUNTRY_CONFIGS[country].centralBank.sharedBankId ?? country;
    if (bankId === union.authorityId) continue;
    updates.push({
      updateOne: {
        filter: { _id: bankId },
        update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      },
    });
  }
  if (updates.length) {
    const result = await banks.bulkWrite(updates);
    if (result.matchedCount !== updates.length)
      throw new Error("A national euro financial account is unavailable");
  }
}

/** Optimistic locking preserves an accession's first conversion quote under retries. */
export async function reconcileEuroMonetaryUnion(
  db: Db,
  turn: number
): Promise<EuroMonetaryUnion | undefined> {
  const states = db.collection<GameState>("gameState");
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await states.findOne(
      { _id: "current" },
      {
        projection: {
          eurozoneEnabled: 1,
          euroAdoptedCountries: 1,
          euroMonetaryUnion: 1,
          europeanIntegration: 1,
          preset: 1,
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
        },
      }
    );
    if (!state) return undefined;
    const consent = state.euroAdoptedCountries ?? [];
    if (
      !state.euroMonetaryUnion &&
      !state.eurozoneEnabled &&
      !EU_EUROZONE_MEMBERS.every((country) => consent.includes(country))
    )
      return undefined;
    if (
      state.euroMonetaryUnion &&
      consent.every((country) => state.euroMonetaryUnion?.members[country])
    ) {
      await syncEuroMonetaryPolicy(db, state.euroMonetaryUnion);
      return state.euroMonetaryUnion;
    }
    const [members, rates, banks] = await Promise.all([
      db
        .collection<OrganizationMembership>("organizationMemberships")
        .find({ organizationId: "EU" }, { projection: { countryId: 1 } })
        .toArray(),
      db
        .collection<ExchangeRate>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      db
        .collection<CentralBank>("centralBanks")
        .find({}, { projection: { _id: 1 } })
        .toArray(),
    ]);
    const plan = planEuroSettlement({
      year: resolveGameYear(state) ?? 0,
      turn,
      preset: state.preset ?? DEFAULT_SEED_PRESET,
      europeanMembers: members.map((member) => member.countryId),
      europeanStage: state?.europeanIntegration?.stage,
      consentedCountries: consent,
      rates: Object.fromEntries(rates.map((rate) => [rate.currencyCode, rate.rate])),
      existing: state.euroMonetaryUnion,
      legacyEnabled: state.eurozoneEnabled,
    });
    if (!plan.union) return undefined;
    const bankIds = new Set(banks.map((bank) => bank._id));
    for (const country of Object.keys(plan.union.members) as CountryId[]) {
      if (!bankIds.has(COUNTRY_CONFIGS[country].centralBank.sharedBankId ?? country)) {
        throw new Error(`Euro accession requires the existing national bank for ${country}`);
      }
    }
    if (plan.addedCountries.length > 0) {
      const filter: Filter<GameState> = {
        _id: "current",
        "euroMonetaryUnion.revision": state.euroMonetaryUnion
          ? state.euroMonetaryUnion.revision
          : { $exists: false },
      };
      const result = await states.updateOne(filter, {
        $set: { euroMonetaryUnion: plan.union, eurozoneEnabled: true },
      });
      if (result.matchedCount !== 1) continue;
    }
    // A failed cache write is retried from the stored conversion, never requoted.
    await syncEuroMonetaryPolicy(db, plan.union);
    return plan.union;
  }
  throw new Error("Euro settlement changed concurrently; retry the decision");
}
