/** Freeze build fees and market ownership before loan funding is admitted. */
import { ObjectId, type Db, type Document } from "mongodb";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import {
  CURRENCY_ANCHOR_COUNTRY,
  SPREAD_FEE_FOREX_REVENUE_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import { unownedPoolDrawdown, type UnownedPoolBucket } from "@/lib/market/unownedPoolDraw";
import { oid, type BankingTransition, type TransitionLeg } from "./rules/boundary";
import type { ConstructionBuildEffects } from "./rules/constructionBuild";

export async function prepareConstructionBuildEffects(input: {
  db: Db;
  enabled: boolean;
  sector: CorporateSector;
  claimId: string;
  borrowerId: string;
  loanId: string;
  turn: number;
  currency: CurrencyCode;
  feeLocal: number;
  destinationCurrency: CurrencyCode | null;
  bucket: UnownedPoolBucket;
  units: number;
  eraUnitScale: number;
}): Promise<{ ok: true; value: ConstructionBuildEffects } | { ok: false; error: string }> {
  if (!input.enabled) return { ok: false, error: "Construction finance is not enabled" };
  const { db, sector, claimId, feeLocal } = input;
  if (
    input.bucket.stateId !== sector.stateId ||
    input.bucket.sectorType !== sector.sectorType ||
    (input.bucket.industryModel ?? null) !== (sector.industryModel ?? null) ||
    (input.bucket.mediaDiscriminator ?? null) !== (sector.mediaDiscriminator ?? null)
  )
    return { ok: false, error: "The construction market identity changed" };
  const countryId = COUNTRY_ORDER.find((candidate) => candidate === input.bucket.countryId);
  if (!countryId) return { ok: false, error: "Construction market country is unavailable" };
  const industryModel = input.bucket.industryModel ?? null;
  const mediaDiscriminator = input.bucket.mediaDiscriminator ?? null;
  if (industryModel !== null && industryModel !== "vehicles")
    return { ok: false, error: "Construction market model is unavailable" };
  if (!Number.isFinite(feeLocal) || feeLocal < 0 || !ObjectId.isValid(input.borrowerId))
    return { ok: false, error: "Construction fees are invalid" };
  const now = new Date();
  const pipeline = unownedPoolDrawdown(input.bucket, input.units, now, input.eraUnitScale);
  if (!pipeline) return { ok: false, error: "Construction market units are invalid" };
  const legs: TransitionLeg[] = [];
  if (feeLocal > 0) {
    const sourceCountry = CURRENCY_ANCHOR_COUNTRY[input.currency];
    const destinationCountry =
      input.destinationCurrency && CURRENCY_ANCHOR_COUNTRY[input.destinationCurrency];
    if (!sourceCountry || !destinationCountry || input.destinationCurrency === input.currency)
      return { ok: false, error: "Construction fee currencies are unavailable" };
    const sourceBankId = getBankId(sourceCountry);
    const destinationBankId = getBankId(destinationCountry);
    const revenue = Math.round(feeLocal * SPREAD_FEE_FOREX_REVENUE_RATIO);
    const reserve = Math.round(feeLocal * SPREAD_FEE_RESERVE_RATIO);
    const burned = feeLocal - revenue - reserve;
    if (burned < 0) return { ok: false, error: "Construction fee rounding exceeds its cash" };
    const ids = [
      ...new Set([
        ...(revenue > 0 ? [sourceBankId] : []),
        ...(reserve > 0 ? [destinationBankId] : []),
      ]),
    ];
    const banks = await db
      .collection<CentralBank>("centralBanks")
      .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
      .toArray();
    if (banks.length !== ids.length)
      return { ok: false, error: "Construction fee recipients are unavailable" };
    legs.push({
      kind: "debit",
      collection: "corporateSectors",
      filter: {
        _id: oid(String(sector._id)),
        corporationId: oid(input.borrowerId),
        "constructionFinancing.claimId": claimId,
      },
      path: "constructionFinancing.escrowLocal",
      amount: feeLocal,
      note: "Deliver the frozen construction FX fee from actual escrow",
    });
    if (revenue > 0)
      legs.push({
        kind: "credit",
        collection: "centralBanks",
        filter: { _id: sourceBankId },
        path: "forexRevenue",
        amount: revenue,
        note: "Source central-bank native FX revenue",
      });
    if (reserve > 0)
      legs.push({
        kind: "credit",
        collection: "centralBanks",
        filter: { _id: destinationBankId },
        path: `spreadFeeReserveBalances.${input.currency}`,
        amount: reserve,
        note: "Destination central-bank foreign reserve in the source currency",
      });
    if (burned > 0)
      legs.push({
        kind: "burn",
        amount: burned,
        note: "Destroy the remaining construction FX fee",
      });
  }
  const pool = await db.collection<UnownedSector>("unownedSectors").findOneAndUpdate(
    {
      stateId: input.bucket.stateId,
      sectorType: input.bucket.sectorType,
      industryModel,
      mediaDiscriminator,
    },
    {
      $setOnInsert: {
        ...input.bucket,
        countryId,
        industryModel,
        mediaDiscriminator,
        headroomUnits: 0,
        revenue: 0,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!pool) return { ok: false, error: "Construction market bucket is unavailable" };
  const transition: BankingTransition = {
    key: `construction:${claimId}:build-effects`,
    kind: "construction_build_effects",
    turn: input.turn,
    currency: input.currency,
    legs,
    projections: [
      {
        collection: "unownedSectors",
        filter: { _id: oid(String(pool._id)) },
        pipelineUpdate: pipeline as Document[],
        note: "Claim this build's market headroom once",
      },
      {
        collection: "corporateSectors",
        filter: { _id: oid(String(sector._id)), "constructionFinancing.claimId": claimId },
        update: { $set: { "constructionFinancing.effectsPaid": true } },
        note: "Publish fees and pool delivery before paid queue publication",
      },
    ],
    event: { kind: "loan.disbursed", command: "construction.effects", subjectId: input.loanId },
  };
  return {
    ok: true,
    value: {
      transition,
      feeLocal,
      pool: {
        id: String(pool._id),
        bucket: input.bucket,
        eraUnitScale: input.eraUnitScale,
        units: input.units,
      },
      quotedAt: now,
    },
  };
}
