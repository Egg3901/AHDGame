import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types/corporation";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { State } from "@/lib/db/types/state";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { convertCorpCurrency } from "@/lib/corporations/convertCorpCurrency";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";
import {
  FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION,
  type FederationPrivateFirmHold,
} from "./materializePrivateFirms";
import {
  FEDERATION_FACILITY_CLAIMS_COLLECTION,
  activateFederationFacilityClaim,
  type FederationFacilityClaimRecord,
} from "./facilityClaimLedger";
import {
  FEDERATION_RELOCATIONS_COLLECTION,
  type FederationRelocationRecord,
} from "./relocationLedger";

export interface ChosenFederationHeadquarters {
  countryId: CountryId;
  stateId: string;
}

function sameDestination(
  a: ChosenFederationHeadquarters | undefined,
  b: ChosenFederationHeadquarters
): boolean {
  return a?.countryId === b.countryId && a.stateId === b.stateId;
}

async function lockConversion(
  db: Db,
  hold: FederationPrivateFirmHold,
  corporation: Corporation,
  destination: ChosenFederationHeadquarters
): Promise<FederationPrivateFirmHold> {
  if (hold.selectedDestination && !sameDestination(hold.selectedDestination, destination))
    throw new Error("Federation headquarters choice conflicts with an earlier choice");
  if (hold.lockedConversion) return hold;
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ $or: [{ _id: destination.countryId }, { countryId: destination.countryId }] })
    .toArray();
  if (budgets.length !== 1 || !budgets[0].currencyCode)
    throw new Error("Federation headquarters has no unambiguous live currency");
  const toCurrency = budgets[0].currencyCode;
  const fromCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? null;
  if (fromCurrency === toCurrency) {
    await db
      .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
      .updateOne(
        { _id: hold._id, lockedConversion: { $exists: false } },
        {
          $set: {
            selectedDestination: destination,
            lockedConversion: { fromCurrency, toCurrency, fromRate: 1, toRate: 1 },
          },
        }
      );
    const saved = await db
      .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
      .findOne({ _id: hold._id });
    if (
      !saved ||
      !sameDestination(saved.selectedDestination, destination) ||
      !saved.lockedConversion
    )
      throw new Error("Federation headquarters choice conflicted with another writer");
    return saved;
  }
  const needed = [
    ...new Set([fromCurrency, toCurrency].filter((code): code is CurrencyCode => !!code)),
  ];
  const rates = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({ currencyCode: { $in: needed } })
    .toArray();
  const byCode = new Map(rates.map((rate) => [rate.currencyCode, rate.rate]));
  if (
    needed.some((code) => !Number.isFinite(byCode.get(code)) || (byCode.get(code) ?? 0) <= 0) ||
    byCode.size !== needed.length ||
    rates.length !== needed.length
  )
    throw new Error("Federation headquarters needs prevailing exchange rates");
  const lockedConversion = {
    fromCurrency,
    toCurrency,
    fromRate: fromCurrency ? byCode.get(fromCurrency)! : 1,
    toRate: byCode.get(toCurrency as CurrencyCode)!,
  };
  await db
    .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
    .updateOne(
      { _id: hold._id, lockedConversion: { $exists: false } },
      { $set: { selectedDestination: destination, lockedConversion } }
    );
  const saved = await db
    .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
    .findOne({ _id: hold._id });
  if (!saved || !sameDestination(saved.selectedDestination, destination) || !saved.lockedConversion)
    throw new Error("Federation headquarters choice conflicted with another writer");
  return saved;
}

/** Complete an explicit owner choice. The destination and prevailing rates are
 * locked before conversion, so a retry cannot redirect the firm or change its
 * value. Every later step is idempotent: conversion, HQ move, claim activation,
 * and completion marker can be reconciled after an interrupted request. */
export async function chooseFederationFirmHeadquarters(input: {
  db: Db;
  applicationId: string;
  corporationId: string;
  ownerUserId: string;
  destination: ChosenFederationHeadquarters;
  now: Date;
}): Promise<FederationPrivateFirmHold> {
  const { db, applicationId, corporationId, ownerUserId, destination, now } = input;
  if (
    !applicationId ||
    !/^[a-f\d]{24}$/i.test(corporationId) ||
    !ownerUserId ||
    !destination.stateId ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Federation headquarters choice needs a firm, owner and destination");
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied" });
  if (!application) throw new Error("Federation headquarters choice awaits settlement");
  const state = await db
    .collection<State>("states")
    .findOne({ _id: destination.stateId, countryId: destination.countryId });
  if (!state || !(await getRegisteredCountryIds(db)).includes(destination.countryId))
    throw new Error("Federation headquarters destination is not playable");
  const holdCollection = db.collection<FederationPrivateFirmHold>(
    FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION
  );
  let hold = await holdCollection.findOne({ _id: `${applicationId}:${corporationId}` });
  const corporations = db.collection<Corporation>("corporations");
  let corporation = await corporations.findOne({ _id: new ObjectId(corporationId) });
  if (
    !hold ||
    hold.applicationId !== applicationId ||
    !corporation ||
    corporation.userId?.toString() !== ownerUserId ||
    (corporation.federationPendingHeadquartersId !== applicationId &&
      !(
        corporation.federationPendingHeadquartersId == null &&
        corporation.countryId === destination.countryId &&
        corporation.headquartersState === destination.stateId
      ))
  )
    throw new Error("Federation headquarters choice is not owned or pending");
  hold = await lockConversion(db, hold, corporation, destination);
  const conversion = hold.lockedConversion!;
  if (corporation.federationPendingHeadquartersId === applicationId) {
    if (conversion.fromCurrency !== conversion.toCurrency) {
      const fxByCurrency = new Map<CurrencyCode, number>();
      if (conversion.fromCurrency)
        fxByCurrency.set(conversion.fromCurrency as CurrencyCode, conversion.fromRate);
      fxByCurrency.set(conversion.toCurrency as CurrencyCode, conversion.toRate);
      const result = await convertCorpCurrency(
        db,
        corporation,
        conversion.toCurrency as CurrencyCode,
        fxByCurrency,
        now,
        await isForexEnabled()
      );
      if (!result.ok) throw new Error(result.error);
      corporation = (await corporations.findOne({ _id: corporation._id }))!;
    }
    const moved = await corporations.updateOne(
      {
        _id: corporation._id,
        federationPendingHeadquartersId: applicationId,
      },
      {
        $set: {
          countryId: destination.countryId,
          headquartersState: destination.stateId,
          suspended: hold.wasSuspended,
          updatedAt: now,
        },
        $unset: { federationPendingHeadquartersId: "" },
      }
    );
    if (moved.matchedCount !== 1)
      throw new Error("Federation firm changed while applying headquarters choice");
  }
  const claims = await db
    .collection<FederationFacilityClaimRecord>(FEDERATION_FACILITY_CLAIMS_COLLECTION)
    .find({ applicationId, corporationId })
    .toArray();
  for (const claim of claims) {
    await activateFederationFacilityClaim(
      db,
      applicationId,
      claim.claimId,
      corporationId,
      destination.countryId
    );
  }
  const relocationId = `${applicationId}:firm:${corporationId}`;
  const relocations = db.collection<FederationRelocationRecord>(FEDERATION_RELOCATIONS_COLLECTION);
  const relocation = await relocations.findOne({ _id: relocationId });
  if (
    !relocation ||
    (relocation.destination && !sameDestination(relocation.destination, destination))
  )
    throw new Error("Federation firm relocation record is missing or conflicted");
  await relocations.updateOne({ _id: relocationId }, { $set: { status: "selected", destination } });
  await holdCollection.updateOne(
    { _id: hold._id },
    { $set: { status: "completed", completedAt: hold.completedAt ?? now } }
  );
  const completed = await holdCollection.findOne({ _id: hold._id });
  if (!completed || completed.status !== "completed")
    throw new Error("Federation headquarters completion was not recorded");
  return completed;
}
