/** Deterministic production-rule and journal profile for issue 3103. */
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { legsNet, moneyMoveValuationError } from "@/lib/banking/rules/invariants";
import {
  applyPoliticalMediaOrderEffect,
  fundPoliticalMediaOrder,
  loadPoliticalMediaOrdersForClearing,
  savePoliticalMediaSettlementPlan,
  settlePoliticalMediaOrder,
} from "@/lib/politicalMedia/journal";
import { settlePoliticalAdMarket } from "@/lib/politicalMedia/market";
import type { PoliticalMediaPayer } from "@/lib/politicalMedia/journal";
import type { SectorClearingInput, SectorClearingResult } from "@/lib/market/clearing";

type Command = {
  collection: string;
  operation: string;
  requestBytes: number;
  responseBytes: number;
  requestText: string;
};
const jsonBytes = (value: unknown) =>
  Buffer.byteLength(
    JSON.stringify(value, (_key, item) =>
      item &&
      typeof item === "object" &&
      "toHexString" in item &&
      typeof item.toHexString === "function"
        ? item.toHexString()
        : item
    )
  );

function instrument(memory: ReturnType<typeof createInMemoryDb>, commands: Command[]) {
  const observed = new Set<string>();
  const originalCollection = memory.collection.bind(memory);
  (memory as unknown as { collection: typeof memory.collection }).collection = ((name: string) => {
    const collection = originalCollection(name) as unknown as Record<
      string,
      (...args: never[]) => unknown
    >;
    if (observed.has(name)) return collection as never;
    observed.add(name);
    for (const operation of ["findOne", "find", "insertOne", "updateOne"] as const) {
      const original = collection[operation].bind(collection);
      collection[operation] = ((...args: unknown[]) => {
        const entry: Command = {
          collection: name,
          operation,
          requestBytes: jsonBytes(args),
          responseBytes: 0,
          requestText: JSON.stringify(args),
        };
        commands.push(entry);
        const result = original(...(args as never[])) as unknown;
        if (operation === "find") {
          const cursor = result as { toArray: () => Promise<unknown[]> };
          const toArray = cursor.toArray.bind(cursor);
          cursor.toArray = async () => {
            const rows = await toArray();
            entry.responseBytes = jsonBytes(rows);
            return rows;
          };
          return cursor;
        }
        return Promise.resolve(result).then((value) => {
          entry.responseBytes = jsonBytes(value);
          return value;
        });
      }) as never;
    }
    return collection as never;
  }) as typeof memory.collection;
}

const payer = (
  collection: "characters" | "campaigns",
  documentId: string,
  path: string,
  currencyCode: string,
  localPerAnchor: number,
  amountAnchor: number,
  actionCost = 0
): PoliticalMediaPayer => ({
  collection,
  documentId,
  path,
  currencyCode,
  localPerAnchor,
  amountLocal: amountAnchor * localPerAnchor,
  ...(actionCost ? { actionCost, currentActions: 4 } : {}),
});

export async function buildPoliticalAdMarketReport() {
  const memory = createInMemoryDb();
  const commands: Command[] = [];
  memory.seed("characters", [
    { _id: "advertiser", currencyBalances: { campaign: 26 }, actions: 4 },
    { _id: "targeted-buyer", funds: 28, actions: 4 },
  ]);
  memory.seed("campaigns", [{ _id: "campaign", funds: 140 }]);
  memory.seed("corporations", [
    { _id: "seller-a", liquidCapital: 0 },
    { _id: "seller-b", liquidCapital: 0 },
  ]);
  memory.seed("electionCandidates", [{ _id: "candidate", favorability: 40, targetedAds: [] }]);
  instrument(memory, commands);
  const db = memory as unknown as Db;

  const orderSpecs = [
    {
      orderId: "advertise-1",
      source: "advertise" as const,
      payer: payer("characters", "advertiser", "currencyBalances.campaign", "EUR", 1.3, 20, 1),
      effect: {
        kind: "favorability",
        targetCollection: "electionCandidates",
        targetDocumentId: "candidate",
        targetDocumentIdIsObjectId: false,
        amount: 1,
      },
    },
    {
      orderId: "targeted-1",
      source: "targeted_ad" as const,
      createdTurn: 13,
      payer: payer("characters", "targeted-buyer", "funds", "USD", 0.8, 35, 2),
      effect: {
        kind: "targeted_ad",
        targetCollection: "electionCandidates",
        targetDocumentId: "candidate",
        targetDocumentIdIsObjectId: false,
        ad: {
          stateId: "CA",
          dimension: "economy",
          bucket: "industrial",
          bonus: 0.6,
          lastPurchaseTurn: 14,
        },
      },
    },
    {
      orderId: "campaign-1",
      source: "campaign_maintenance" as const,
      createdTurn: 14,
      payer: payer("campaigns", "campaign", "funds", "GBP", 1.4, 100, 0),
      effect: {
        kind: "favorability",
        targetCollection: "electionCandidates",
        targetDocumentId: "candidate",
        targetDocumentIdIsObjectId: false,
        amount: 1,
      },
    },
  ];
  for (const order of orderSpecs) {
    const result = await fundPoliticalMediaOrder(db, {
      ...order,
      createdTurn: order.createdTurn ?? 12,
      countryId: "US",
      targetStateId: "CA",
      details: { effect: order.effect },
    });
    if (result.status !== "applied") throw new Error(`Funding failed: ${order.orderId}`);
  }

  const inputFor = (sectorId: string): SectorClearingInput => ({
    sectorId,
    revenue: 100,
    supplyRates: { advertising: 0.5, entertainment_services: 0.5 },
    posture: 0,
  });
  const commercialA: SectorClearingResult = {
    factor: 0.25,
    soldFraction: 0.25,
    soldByCommodity: { advertising: 0.5, entertainment_services: 0 },
    effectivePosture: 0,
  };
  const commercialB: SectorClearingResult = {
    factor: 0.1,
    soldFraction: 0.1,
    soldByCommodity: { advertising: 0.2, entertainment_services: 0 },
    effectivePosture: 0,
  };
  const offers = [
    {
      input: inputFor("sector-a"),
      clearing: commercialA,
      corporationId: "seller-a",
      countryId: "US",
      stateId: "CA",
      basePrice: 96,
      priceRatio: 1,
      sellerCurrencyCode: "EUR",
      sellerLocalPerAnchor: 1.25,
      offeredUnits: 20,
    },
    {
      input: inputFor("sector-b"),
      clearing: commercialB,
      corporationId: "seller-b",
      countryId: "US",
      stateId: "CA",
      basePrice: 144,
      priceRatio: 1,
      sellerCurrencyCode: "GBP",
      sellerLocalPerAnchor: 0.8,
      offeredUnits: 10,
    },
  ];
  const loaded = await loadPoliticalMediaOrdersForClearing(db, 14);
  const market = settlePoliticalAdMarket({
    orders: loaded.map((order) => ({
      orderId: order.orderId,
      countryId: order.identity.countryId,
      stateId: order.identity.targetStateId,
      createdTurn: order.identity.createdTurn,
      budgetAnchor: order.identity.requestedAnchor,
    })),
    offers,
    clearingBySectorId: new Map([
      ["sector-a", commercialA],
      ["sector-b", commercialB],
    ]),
    clearingEnabled: true,
    qualityPremiumEnabled: false,
    turn: 14,
  });
  for (const settlement of market.settlementPlans) {
    await savePoliticalMediaSettlementPlan(db, settlement.orderId, settlement.plan);
  }
  for (const order of orderSpecs) {
    const settlement = market.settlementPlans.find((item) => item.orderId === order.orderId);
    if (!settlement) throw new Error(`Missing allocation: ${order.orderId}`);
    await settlePoliticalMediaOrder(db, order.orderId, 14);
    if (!(await applyPoliticalMediaOrderEffect(db, order.orderId))) {
      throw new Error(`Effect was not applied: ${order.orderId}`);
    }
  }

  const settlements = market.allocations.map((allocation) => {
    const order = orderSpecs.find((spec) => spec.orderId === allocation.orderId)!;
    const deliveredRatio = allocation.deliveredAnchor / allocation.requestedAnchor;
    const sellerNative = allocation.sellers.reduce(
      (sum, seller) => sum + seller.sellerLocalAmount,
      0
    );
    return {
      source: order.source,
      requestedAnchor: allocation.requestedAnchor,
      deliveredAnchor: allocation.deliveredAnchor,
      refundedAnchor: allocation.unfilledAnchor,
      paidEffectShare: deliveredRatio,
      sellerNativeReceipt: sellerNative,
    };
  });
  const accounting = [
    ...orderSpecs.flatMap((order) => {
      const allocation = market.allocations.find((row) => row.orderId === order.orderId)!;
      return [
        [
          {
            kind: "debit" as const,
            amount: order.payer.amountLocal,
            valuation: {
              currencyCode: order.payer.currencyCode,
              localPerAnchor: order.payer.localPerAnchor,
            },
          },
          {
            kind: "credit" as const,
            amount: order.payer.amountLocal / order.payer.localPerAnchor,
            valuation: { currencyCode: "AHD", localPerAnchor: 1 },
          },
        ],
        [
          {
            kind: "debit" as const,
            amount: allocation.unfilledAnchor,
            valuation: { currencyCode: "AHD", localPerAnchor: 1 },
          },
          {
            kind: "credit" as const,
            amount: allocation.unfilledAnchor * order.payer.localPerAnchor,
            valuation: {
              currencyCode: order.payer.currencyCode,
              localPerAnchor: order.payer.localPerAnchor,
            },
          },
        ],
        ...allocation.sellers.map((seller) => [
          {
            kind: "debit" as const,
            amount: seller.amountAnchor,
            valuation: { currencyCode: "AHD", localPerAnchor: 1 },
          },
          {
            kind: "credit" as const,
            amount: seller.sellerLocalAmount,
            valuation: {
              currencyCode: offers.find((offer) => offer.input.sectorId === seller.sectorId)!
                .sellerCurrencyCode,
              localPerAnchor: seller.sellerLocalPerAnchor,
            },
          },
        ]),
      ];
    }),
  ];
  const accountingErrors = accounting.flatMap((legs) => {
    const valuationError = moneyMoveValuationError(legs);
    const net = legsNet(legs);
    return valuationError || Math.abs(net) >= 1e-6
      ? [{ valuationError: valuationError ?? null, net }]
      : [];
  });
  const candidate = memory.collection("electionCandidates").docs[0];
  const commandsByOrder = orderSpecs.map((order) => {
    const key = order.orderId;
    const related = commands.filter((command) => command.requestText.includes(key));
    return {
      orderId: key,
      observedCommands: related.length,
      observedRequestAndResponseBytes: related.reduce(
        (sum, row) => sum + row.requestBytes + row.responseBytes,
        0
      ),
    };
  });

  return {
    report: "issue-3103-political-ad-market",
    method: "production market allocator plus in-memory durable money-move journal",
    turn: 14,
    commercial: {
      offeredUnits: 30,
      commerciallySoldUnits: 12,
      residualUnits: 18,
      politicalUnitsDelivered: market.allocations.reduce((sum, row) => sum + row.deliveredUnits, 0),
      residualUnitsRemaining:
        18 - market.allocations.reduce((sum, row) => sum + row.deliveredUnits, 0),
    },
    orders: settlements,
    accounting: {
      allFundingPayoutAndRefundLegSetsBalanceAtFrozenAnchorRates: accountingErrors.length === 0,
      accountingErrors,
      measuredJournalCommands: commands.length,
      measuredJsonRequestAndResponseBytes: commands.reduce(
        (sum, row) => sum + row.requestBytes + row.responseBytes,
        0
      ),
      perOrder: commandsByOrder,
      profilingNote:
        "Counts are calls through the in-memory Mongo-compatible driver; byte counts are JSON-encoded arguments and returned values, used as a deterministic payload-size proxy rather than BSON wire measurements.",
    },
    effects: {
      applyOnlyAfterSettlement: true,
      candidateFavorabilityAfterOrders: candidate?.favorability,
      targetedAdBonusAfterOrders: Array.isArray(candidate?.targetedAds)
        ? (candidate.targetedAds[0] as { bonus?: number } | undefined)?.bonus
        : null,
      sumPaidEffectShares: settlements.reduce((sum, row) => sum + row.paidEffectShare, 0),
      unfundedOrRefundedShareApplied: 0,
    },
    phaseBudget: {
      corporationTurnMongoCommandBudget: 4500,
      observedPoliticalMediaMongoCompatibleCalls: commands.length,
      observedShareOfBudgetPercent: Number(((commands.length / 4500) * 100).toFixed(2)),
      budgetChanged: false,
      reason:
        "The sample covers three persisted orders and three seller allocations. Calls scale with durable orders and seller receipts, so higher-volume real-turn telemetry remains the qualification source. This in-memory command profile does not justify a budget change.",
    },
  };
}

if (process.argv[1]?.endsWith("politicalAdMarketReport.ts")) {
  buildPoliticalAdMarketReport().then((report) => console.log(JSON.stringify(report, null, 2)));
}
