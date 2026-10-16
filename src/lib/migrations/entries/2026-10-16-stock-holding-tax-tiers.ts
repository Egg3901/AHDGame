/**
 * Stock holding rollout. Existing direct shares become long term, keeping recorded
 * or reconstructed costs. New capital-gains tier rates inherit current income tax.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type {
  Corporation,
  ExchangeRate,
  FederalBudget,
  GameState,
  LegislationType,
  ShareListing,
  ShareOrder,
  Shareholder,
  StateBudget,
  StatePolicy,
} from "@/lib/db/types";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import { expandIncomeTaxTypes } from "@/lib/budget/incomeTaxCatalog";
import {
  CAPITAL_GAINS_TAX_KEYS,
  initializeCapitalGainsTaxRates,
} from "@/lib/budget/rules/capitalGainsTax";
import { INCOME_TIERS } from "@/lib/budget/rules/incomeTaxTiers";
import {
  holdingCostBasis,
  validateHoldingTerms,
  type ShareHoldingTerms,
} from "@/lib/corporations/rules/holdingTerms";
import {
  reconstructLegacyHoldingBasis,
  allocateLegacyUnknownBasis,
  type LegacyHoldingEvent,
} from "@/lib/corporations/rules/legacyHoldingBasis";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { Migration, MigrationContext, MigrationResult } from "../types";

export const STOCK_HOLDING_MIGRATION_ID = "2026-10-16-stock-holding-tax-tiers";
function ownerKey(
  holder: Pick<Shareholder, "characterId" | "imperialCharacterId">
): string | undefined {
  return holder.characterId
    ? "character:" + holder.characterId.toHexString()
    : holder.imperialCharacterId
      ? "imperial:" + holder.imperialCharacterId.toHexString()
      : undefined;
}
function historyEvents(rows: readonly ShareTradeHistory[], owner: string): LegacyHoldingEvent[] {
  const events: LegacyHoldingEvent[] = [];
  for (const row of rows) {
    if (row.kind === "stock_split" || row.kind === "reverse_split") {
      const snapshotKey = owner;
      const before = row.structureChange?.before.find(
        (holder) => holder.kind + ":" + holder.ownerId === snapshotKey
      );
      const after = row.structureChange?.after.find(
        (holder) => holder.kind + ":" + holder.ownerId === snapshotKey
      );
      if (before || after)
        events.push({
          kind: "structure",
          beforeShares: before?.shares ?? 0,
          afterShares: after?.shares ?? 0,
        });
      else if (!row.structureChange) events.push({ kind: "unknown" });
      continue;
    }
    const bought = row.to && ownerKey(row.to) === owner;
    const sold = row.from && ownerKey(row.from) === owner;
    if (!bought && !sold) continue;
    if (row.kind === "correction" || (bought && sold)) events.push({ kind: "unknown" });
    else if (bought) events.push({ kind: "buy", shares: row.shares, totalAnchor: row.totalAnchor });
    else events.push({ kind: "sell", shares: row.shares });
  }
  return events;
}

async function migrate(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  if (
    await db
      .collection<ShareOrder>("shareOrders")
      .countDocuments({ activeShareFillKey: { $exists: true } })
  )
    throw new Error("Recover pending share fills before migrating stock holdings");
  if (
    await db
      .collection<ShareListing>("shareListings")
      .countDocuments({ activeShareFillKey: { $exists: true } })
  )
    throw new Error("Recover pending listing fills before migrating stock holdings");
  const [state, corps, orders, listings, history, exchange, national, regional, types, policies] =
    await Promise.all([
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db
        .collection<Corporation>("corporations")
        .find(
          {},
          {
            projection: {
              shareholders: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
              sharePrice: 1,
              stockHoldingRolloutAnchorPrice: 1,
              stockHoldingRolloutTurn: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<ShareOrder>("shareOrders")
        .find({
          type: "sell",
          status: "open",
          sharesDebitedAtCreation: true,
          placerCorporationId: { $exists: false },
          placerFundId: { $exists: false },
        })
        .toArray(),
      db
        .collection<ShareListing>("shareListings")
        .find({ status: "open", sellerCorporationId: { $exists: false } })
        .toArray(),
      db
        .collection<ShareTradeHistory>("shareTradeHistory")
        .find({})
        .sort({ turn: 1, createdAt: 1, _id: 1 })
        .toArray(),
      db
        .collection<ExchangeRate>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      db
        .collection<FederalBudget>("federalBudget")
        .find({}, { projection: { countryId: 1, taxRates: 1 } })
        .toArray(),
      db
        .collection<StateBudget>("stateBudgets")
        .find({}, { projection: { countryId: 1, taxRates: 1 } })
        .toArray(),
      db
        .collection<LegislationType>("legislationTypes")
        .find({
          $or: [{ "taxRateChange.taxType": "incomeTax" }, { "taxSlider.taxType": "incomeTax" }],
        })
        .toArray(),
      db.collection<StatePolicy>("statePolicies").find({}).toArray(),
    ]);
  if (!state) throw new Error("Stock holding migration requires a world");
  const turn = state.currentTurn;
  const fx = new Map(exchange.map((row) => [row.currencyCode, row.rate]));
  const byCorp = new Map<string, ShareTradeHistory[]>();
  for (const row of history) {
    const key = row.corporationId.toHexString();
    const rows = byCorp.get(key) ?? [];
    rows.push(row);
    byCorp.set(key, rows);
  }
  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  const orderOps: AnyBulkWriteOperation<ShareOrder>[] = [];
  const listingOps: AnyBulkWriteOperation<ShareListing>[] = [];
  const quoteOps: AnyBulkWriteOperation<Corporation>[] = [];
  const sources = { recorded: 0, history: 0, mixed: 0, rollout: 0 };
  let reconstructedShares = 0,
    fallbackShares = 0;
  for (const corp of corps) {
    const currency = resolveCorpLiquidCurrencyCode(corp) ?? "USD";
    const rate = fx.get(currency);
    const hasPersonal =
      corp.shareholders?.some((holder) => ownerKey(holder)) ||
      orders.some((order) => order.corporationId.equals(corp._id)) ||
      listings.some((listing) => listing.corporationId.equals(corp._id));
    if (!hasPersonal) continue;
    if (!rate || !Number.isFinite(rate) || rate <= 0)
      throw new Error("Legacy stock basis requires an exchange rate for " + currency);
    if (
      corp.stockHoldingRolloutAnchorPrice === undefined &&
      (!Number.isFinite(corp.sharePrice) || corp.sharePrice < 0)
    )
      throw new Error("Missing rollout share price");
    const rolloutPrice = corp.stockHoldingRolloutAnchorPrice ?? corp.sharePrice / rate;
    if (!Number.isFinite(rolloutPrice) || rolloutPrice < 0)
      throw new Error("Invalid rollout share price");
    quoteOps.push({
      updateOne: {
        filter: { _id: corp._id, stockHoldingRolloutAnchorPrice: { $exists: false } },
        update: {
          $set: { stockHoldingRolloutAnchorPrice: rolloutPrice, stockHoldingRolloutTurn: turn },
        },
      },
    });
    const corpOrders = orders.filter((order) => order.corporationId.equals(corp._id));
    const corpListings = listings.filter((listing) => listing.corporationId.equals(corp._id));
    const owners = new Set<string>();
    for (const holder of corp.shareholders ?? []) {
      const key = ownerKey(holder);
      if (key) owners.add(key);
    }
    for (const order of corpOrders)
      if (order.characterId) owners.add("character:" + order.characterId.toHexString());
    for (const listing of corpListings)
      owners.add("character:" + listing.sellerCharacterId.toHexString());
    const updated = (corp.shareholders ?? []).map((holder) => ({ ...holder }));
    let changed = false;
    for (const owner of owners) {
      const holder = updated.find((holder) => ownerKey(holder) === owner);
      const reservedOrders = corpOrders.filter(
        (order) => order.characterId && "character:" + order.characterId.toHexString() === owner
      );
      const reservedListings = corpListings.filter(
        (listing) => "character:" + listing.sellerCharacterId.toHexString() === owner
      );
      const shares =
        (holder?.shares ?? 0) +
        reservedOrders.reduce((sum, row) => sum + row.sharesRemaining, 0) +
        reservedListings.reduce((sum, row) => sum + row.sharesRemaining, 0);
      const recordedAverage =
        holder?.avgCostPerShare !== undefined
          ? holder.avgCostPerShare /
            (holder.avgCostBasisUnit === "anchor" || holder.holdingTerms ? 1 : rate)
          : undefined;
      if (
        recordedAverage !== undefined &&
        (!Number.isFinite(recordedAverage) || recordedAverage < 0)
      )
        throw new Error("Invalid recorded share cost");
      if (holder?.holdingTerms) validateHoldingTerms(holder.holdingTerms, holder.shares);
      const reserved = [...reservedOrders, ...reservedListings];
      for (const row of reserved)
        if (row.holdingTerms) validateHoldingTerms(row.holdingTerms, row.sharesRemaining);
      const knownRegisterBasis = holder?.holdingTerms
        ? holdingCostBasis(holder.holdingTerms)
        : recordedAverage !== undefined
          ? recordedAverage * (holder?.shares ?? 0)
          : undefined;
      const knownReservedBasis = reserved.reduce(
        (sum, row) => sum + (row.holdingTerms ? holdingCostBasis(row.holdingTerms) : 0),
        0
      );
      const unknownShares =
        (knownRegisterBasis === undefined ? (holder?.shares ?? 0) : 0) +
        reserved.reduce((sum, row) => sum + (row.holdingTerms ? 0 : row.sharesRemaining), 0);
      const basis = reconstructLegacyHoldingBasis({
        shares,
        rolloutAnchorPrice: rolloutPrice,
        events: historyEvents(byCorp.get(corp._id.toHexString()) ?? [], owner),
      });
      const knownBasis = (knownRegisterBasis ?? 0) + knownReservedBasis;
      const hasKnownPosition =
        knownRegisterBasis !== undefined || reserved.some((row) => row.holdingTerms);
      const allocation = allocateLegacyUnknownBasis({
        basis,
        shares,
        unknownShares,
        knownBasis,
        hasKnownPosition,
        rolloutPrice,
      });
      const perShare = allocation.perShare;
      if (hasKnownPosition) sources.recorded++;
      if (unknownShares) {
        sources[allocation.source]++;
        reconstructedShares += allocation.reconstructedShares;
        fallbackShares += allocation.fallbackShares;
      }
      const termsFor = (count: number): ShareHoldingTerms => ({
        longTermShares: count,
        longTermCostBasisAnchor: count * perShare,
        shortTermLots: [],
      });
      if (holder) {
        if (holder.holdingTerms) validateHoldingTerms(holder.holdingTerms, holder.shares);
        else {
          holder.holdingTerms = {
            longTermShares: holder.shares,
            longTermCostBasisAnchor: knownRegisterBasis ?? holder.shares * perShare,
            shortTermLots: [],
          };
          holder.avgCostPerShare = holder.shares
            ? holdingCostBasis(holder.holdingTerms) / holder.shares
            : 0;
          holder.avgCostBasisUnit = "anchor";
          changed = true;
        }
      }
      for (const order of reservedOrders) {
        if (order.holdingTerms) {
          validateHoldingTerms(order.holdingTerms, order.sharesRemaining);
          continue;
        }
        orderOps.push({
          updateOne: {
            filter: {
              _id: order._id,
              status: "open",
              sharesRemaining: order.sharesRemaining,
              holdingTerms: { $exists: false },
            },
            update: { $set: { holdingTerms: termsFor(order.sharesRemaining) } },
          },
        });
      }
      for (const listing of reservedListings) {
        if (listing.holdingTerms) {
          validateHoldingTerms(listing.holdingTerms, listing.sharesRemaining);
          continue;
        }
        listingOps.push({
          updateOne: {
            filter: {
              _id: listing._id,
              status: "open",
              sharesRemaining: listing.sharesRemaining,
              holdingTerms: { $exists: false },
            },
            update: { $set: { holdingTerms: termsFor(listing.sharesRemaining) } },
          },
        });
      }
    }
    if (changed)
      corpOps.push({
        updateOne: {
          filter: { _id: corp._id, shareholders: corp.shareholders ?? [] },
          update: { $set: { shareholders: updated } },
        },
      });
  }
  const clones = expandIncomeTaxTypes(types).filter((type) => type._id.includes("__capital_"));
  for (const budget of [...national, ...regional])
    if (budget.taxRates) initializeCapitalGainsTaxRates(budget.taxRates);
  const notes = [
    "Cost basis sources (positions): " + JSON.stringify(sources),
    "Reconstructed shares: " + reconstructedShares + "; rollout-price shares: " + fallbackShares,
    "Existing direct holdings and escrow become long term. Index-fund units are unchanged.",
  ];
  const scanned =
    corps.length +
    orders.length +
    listings.length +
    history.length +
    national.length +
    regional.length +
    types.length +
    policies.length;
  if (ctx.dryRun)
    return {
      documentsScanned: scanned,
      documentsUpdated: 0,
      notes: [
        ...notes,
        "Would initialize " +
          clones.length +
          " capital-gains provisions. Activation occurs only after all writes succeed.",
      ],
    };
  if (quoteOps.length) await db.collection<Corporation>("corporations").bulkWrite(quoteOps);
  for (const [collection, ops] of [
    ["corporations", corpOps],
    ["shareOrders", orderOps],
    ["shareListings", listingOps],
  ] as const) {
    if (!ops.length) continue;
    const result = await db.collection(collection).bulkWrite(ops as AnyBulkWriteOperation[]);
    if (result.matchedCount !== ops.length)
      throw new Error("Stock inventory changed during migration: " + collection);
  }
  for (const collection of ["federalBudget", "stateBudgets"] as const)
    await db.collection(collection).updateMany({ taxRates: { $exists: true } }, [
      {
        $set: Object.fromEntries(
          INCOME_TIERS.map((tier) => [
            "taxRates." + CAPITAL_GAINS_TAX_KEYS[tier],
            {
              $ifNull: [
                "$taxRates." + CAPITAL_GAINS_TAX_KEYS[tier],
                {
                  $ifNull: [
                    "$taxRates." +
                      { low: "incomeTaxLow", middle: "incomeTaxMiddle", high: "incomeTaxHigh" }[
                        tier
                      ],
                    { $ifNull: ["$taxRates.incomeTax", 0] },
                  ],
                },
              ],
            },
          ])
        ),
      },
    ]);
  if (clones.length)
    await db.collection<LegislationType>("legislationTypes").bulkWrite(
      clones.map((type) => ({
        updateOne: { filter: { _id: type._id }, update: { $setOnInsert: type }, upsert: true },
      }))
    );
  const policyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const typeMap = new Map(types.map((type) => [type._id, type]));
  for (const policy of policies) {
    const type = typeMap.get(policy.legislationTypeId);
    if (!type) continue;
    const scope = (type.taxSlider ?? type.taxRateChange)!.scope;
    const budget =
      scope === "federal"
        ? national.find((budget) => budget.countryId.toLowerCase() === (type.countryScope ?? "us"))
        : regional.find((budget) => budget._id === policy.stateId);
    if (!budget?.taxRates) continue;
    const { _id: ignored, ...fields } = policy;
    void ignored;
    const rates = initializeCapitalGainsTaxRates(budget.taxRates);
    for (const tier of INCOME_TIERS) {
      const clone = {
        ...fields,
        legislationTypeId: type._id + "__capital_" + tier,
        policyOptionId: "rate:" + rates[CAPITAL_GAINS_TAX_KEYS[tier]],
      };
      policyOps.push({
        updateOne: {
          filter: {
            scope: clone.scope,
            stateId: clone.stateId,
            legislationTypeId: clone.legislationTypeId,
          },
          update: { $setOnInsert: clone },
          upsert: true,
        },
      });
    }
  }
  if (policyOps.length) await db.collection<StatePolicy>("statePolicies").bulkWrite(policyOps);
  const activation = await db.collection<GameState>("gameState").updateOne(
    {
      _id: "current",
      currentTurn: turn,
      isProcessing: true,
      processingKind: "stockTaxMigration",
    },
    { $set: { stockHoldingTaxStartTurn: state.stockHoldingTaxStartTurn ?? turn } }
  );
  if (!activation.matchedCount) throw new Error("Stock tax migration lost its activation lock");
  return {
    documentsScanned: scanned,
    documentsUpdated:
      corpOps.length + orderOps.length + listingOps.length + national.length + regional.length,
    notes,
  };
}

export const migration: Migration = {
  id: STOCK_HOLDING_MIGRATION_ID,
  description:
    "Grandfather direct shares, reconstruct cost basis, and initialize tiered capital gains taxes.",
  idempotent: true,
  async execute(db, ctx) {
    if (ctx.dryRun) return migrate(db, ctx);
    const acquiredAt = new Date();
    const lock = await db.collection<GameState>("gameState").updateOne(
      { _id: "current", isActive: false, isProcessing: { $ne: true } },
      {
        $set: {
          isProcessing: true,
          processingKind: "stockTaxMigration",
          processingStartedAt: acquiredAt,
          processingHeartbeatAt: acquiredAt,
        },
      }
    );
    if (!lock.matchedCount)
      throw new Error(
        "Pause the world and finish the active turn before applying stock holding taxes"
      );
    const timer = setInterval(() => {
      void db
        .collection<GameState>("gameState")
        .updateOne(
          { _id: "current", processingKind: "stockTaxMigration", processingStartedAt: acquiredAt },
          { $set: { processingHeartbeatAt: new Date() } }
        )
        .catch(() => undefined);
    }, 30_000);
    let completed = false;
    try {
      const result = await migrate(db, ctx);
      completed = true;
      return result;
    } finally {
      clearInterval(timer);
      await db.collection<GameState>("gameState").updateOne(
        { _id: "current", processingKind: "stockTaxMigration", processingStartedAt: acquiredAt },
        {
          $set: {
            isProcessing: false,
            // Keep maintenance intent durable after partial failure. Retrying
            // this migration is allowed, while player mutations and turns wait.
            processingKind: completed ? null : "stockTaxMigration",
            processingStartedAt: null,
            processingHeartbeatAt: null,
          },
        }
      );
    }
  },
};
