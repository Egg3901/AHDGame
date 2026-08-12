import type { Db, AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { SentimentPulse } from "@/lib/db/types/sentimentPulse";
import { computeSentimentMultiplier, getHqConfidenceSentiment } from "./sentimentEngine";
import { computeOrderFlowMultiplier } from "./orderFlowEngine";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";

export interface ApplyPriceMultipliersResult {
  updated: number;
  pulseCount: number;
}

/**
 * Applies sentiment and order-flow multipliers to each corp's fundamentalSharePrice
 * and writes the result to sharePrice. Called by the 5-minute stock-exchange-refresh
 * cron before rebuilding snapshots so both share the same price state.
 */
// The TTL index only needs creating once per process, not on every 5-minute
// cron run. createIndex is a no-op server-side when the index exists, but it
// still costs a round-trip; memo it per process.
let sentimentTtlEnsured = false;
async function ensureSentimentPulseTtlIndex(database: Db): Promise<void> {
  if (sentimentTtlEnsured) return;
  await database
    .collection("sentimentPulses")
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400, name: "ttl_createdAt" });
  sentimentTtlEnsured = true;
}

export async function applyPriceMultipliers(db?: Db): Promise<ApplyPriceMultipliersResult> {
  const database = db ?? (await getDb());
  const now = new Date();

  await ensureSentimentPulseTtlIndex(database);

  const pulses = await database.collection<SentimentPulse>("sentimentPulses").find({}).toArray();

  // Per-state investor confidence (0–100) → HQ-state share-price sentiment. One
  // batched projection; corps join on `headquartersState`.
  const confidenceDocs = await database
    .collection("macroMetrics")
    .find({}, { projection: { "economic.investorConfidence.value": 1 } })
    .toArray();
  const investorConfidenceByState = new Map<string, number>();
  for (const doc of confidenceDocs) {
    const value = (doc as { economic?: { investorConfidence?: { value?: number } } }).economic
      ?.investorConfidence?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      investorConfidenceByState.set(String(doc._id), value);
    }
  }

  const [corps, sectors, activeFtaPairs] = await Promise.all([
    database
      .collection<Corporation>("corporations")
      .find(
        { fundamentalSharePrice: { $exists: true } },
        {
          projection: {
            _id: 1,
            countryId: 1,
            headquartersState: 1,
            type: 1,
            secondaryType: 1,
            fundamentalSharePrice: 1,
            sharePrice: 1,
            publicFloat: 1,
            totalShares: 1,
            orderFlowMultiplier: 1,
            orderFlowWindowBuyValue: 1,
            orderFlowWindowSellValue: 1,
          },
        }
      )
      .toArray(),
    database
      .collection<CorporateSector>("corporateSectors")
      .find({}, { projection: { corporationId: 1, countryId: 1, sectorType: 1 } })
      .toArray(),
    loadActiveFtaPairs(database),
  ]);

  if (corps.length === 0) return { updated: 0, pulseCount: pulses.length };

  const operatingSectorKeysByCorpId = new Map<string, Set<string>>();
  const operatingSectorTypesByCorpId = new Map<string, Set<string>>();
  for (const sector of sectors) {
    const corpId = sector.corporationId.toString();
    const sectorKeys = operatingSectorKeysByCorpId.get(corpId) ?? new Set<string>();
    sectorKeys.add(`${sector.countryId}:${sector.sectorType}`);
    operatingSectorKeysByCorpId.set(corpId, sectorKeys);
    const sectorTypes = operatingSectorTypesByCorpId.get(corpId) ?? new Set<string>();
    sectorTypes.add(sector.sectorType);
    operatingSectorTypesByCorpId.set(corpId, sectorTypes);
  }

  const ops: AnyBulkWriteOperation<Corporation>[] = [];

  for (const corp of corps) {
    const corpId = corp._id.toString();
    const sectorTypes = [
      ...(operatingSectorTypesByCorpId.get(corpId) ?? new Set<string>()),
      ...(corp.type ? [corp.type] : []),
      ...(corp.secondaryType ? [corp.secondaryType] : []),
    ];
    const operatingSectorKeys = operatingSectorKeysByCorpId.get(corpId) ?? new Set<string>();

    const fundamentalPrice = corp.fundamentalSharePrice ?? 0;
    if (fundamentalPrice <= 0) continue;

    const sentimentMultiplier = computeSentimentMultiplier(
      pulses,
      now,
      corpId,
      corp.countryId,
      sectorTypes,
      operatingSectorKeys,
      activeFtaPairs
    );

    const prevOrderFlowMultiplier = corp.orderFlowMultiplier ?? 1.0;
    const newOrderFlowMultiplier = computeOrderFlowMultiplier(
      corp.orderFlowWindowBuyValue ?? 0,
      corp.orderFlowWindowSellValue ?? 0,
      corp.publicFloat ?? 0,
      corp.sharePrice ?? fundamentalPrice,
      corp.totalShares ?? 10_000_000,
      prevOrderFlowMultiplier
    );

    // HQ-state investor confidence: heavy for the home state, bounded (±12%).
    const hqConfidenceMultiplier = getHqConfidenceSentiment(
      corp.headquartersState != null
        ? investorConfidenceByState.get(corp.headquartersState)
        : undefined
    );

    const newPrice =
      Math.round(
        fundamentalPrice *
          sentimentMultiplier *
          hqConfidenceMultiplier *
          newOrderFlowMultiplier *
          100
      ) / 100;

    ops.push({
      updateOne: {
        // CAS on fundamentalSharePrice: if a writer (e.g. the consolidate
        // route's reverse/forward split) updated the fundamental between this
        // pass's read and write, skip the update so we don't clobber the
        // fresh price with a multiplier derived from the stale fundamental.
        // See bug #0449 — deterministic clobber was fixed at the consolidate
        // route; this CAS closes the residual sub-second race window.
        filter: { _id: corp._id, fundamentalSharePrice: fundamentalPrice },
        update: {
          $set: {
            sharePrice: newPrice,
            orderFlowMultiplier: newOrderFlowMultiplier,
            orderFlowWindowBuyValue: 0,
            orderFlowWindowSellValue: 0,
            updatedAt: now,
          },
        },
      },
    });
  }

  if (ops.length > 0) {
    await database.collection<Corporation>("corporations").bulkWrite(ops);
  }

  return { updated: ops.length, pulseCount: pulses.length };
}
