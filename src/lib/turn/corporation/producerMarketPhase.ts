/** The corporation host loads real operating cash and settles one complete funded market. */
import { ObjectId, type Db } from "mongodb";
import { ZOD_CURRENCY_ENUM, type CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { ProducerEconomyAccount } from "@/lib/db/types/producerEconomy";
import type { ProducerCashBinding } from "@/lib/market/producerMarket/cashSettlementRules";
import {
  assertProducerTurnFence,
  resumeProducerTurn,
  settleProducerTurn,
} from "@/lib/market/producerMarket/settlement";
import type { prepareProducerSector } from "./producerSectorPlan";

export interface ProducerWalletScope {
  kind: ProducerEconomyAccount["kind"];
  countryId: string;
  stateId?: string;
  currency: CurrencyCode;
}

export function producerWalletId(worldEpoch: string, scope: ProducerWalletScope): string {
  if (
    !worldEpoch ||
    !scope.countryId ||
    !["households", "publicBuyer", "operatingPayee"].includes(scope.kind) ||
    !ZOD_CURRENCY_ENUM.includes(scope.currency)
  )
    throw new Error("Invalid producer wallet scope");
  return JSON.stringify([
    worldEpoch,
    scope.kind,
    scope.countryId,
    scope.stateId ?? null,
    scope.currency,
  ]);
}

type PreparedSector = ReturnType<typeof prepareProducerSector>;
type TurnInput = Parameters<typeof settleProducerTurn>[1];

function observedRate(currency: string, rates: ReadonlyMap<CurrencyCode, number>): number {
  const code = ZOD_CURRENCY_ENUM.find((item) => item === currency);
  const rate = code && rates.get(code);
  if (!rate || !Number.isFinite(rate) || rate <= 0)
    throw new Error("Producer market requires an observed native currency rate");
  return rate;
}

/** Zero-only creation never endows a buyer with imputed wealth or banking deposits. */
async function createProducerWallets(
  db: Db,
  worldEpoch: string,
  scopes: readonly ProducerWalletScope[]
) {
  const unique = new Map(scopes.map((scope) => [producerWalletId(worldEpoch, scope), scope]));
  const entries = [...unique];
  for (let offset = 0; offset < entries.length; offset += 128) {
    await db.collection<ProducerEconomyAccount>("producerEconomyAccounts").bulkWrite(
      entries.slice(offset, offset + 128).map(([_id, scope]) => ({
        updateOne: {
          filter: {
            _id,
            worldEpoch,
            kind: scope.kind,
            countryId: scope.countryId,
            stateId: scope.stateId ?? { $exists: false },
            currency: scope.currency,
          },
          update: { $setOnInsert: { _id, worldEpoch, ...scope, cash: 0 } },
          upsert: true,
        },
      }))
    );
  }
}

/**
 * All participants, including companies whose producing sites closed, keep their
 * unpaid invoices. Cash is read immediately before freezing, never inferred from
 * sales or demographic estimates. The caller owns the whole-turn command fence.
 */
export async function runCorporationProducerMarket(
  db: Db,
  input: {
    worldEpoch: string;
    turn: number;
    corporations: readonly Corporation[];
    prepare: () => readonly PreparedSector[];
    walletScopes: readonly ProducerWalletScope[];
    rates: ReadonlyMap<CurrencyCode, number>;
    demand?: Pick<
      TurnInput["production"],
      | "households"
      | "externalOrders"
      | "externalOffers"
      | "inputReservations"
      | "eligibleOffersByOrder"
    >;
  }
) {
  const resumed = await resumeProducerTurn(db, input);
  if (resumed) return publishHostState(db, input.corporations, resumed);
  await assertProducerTurnFence(db, input.worldEpoch, input.turn);
  const prepared = input.prepare();
  const corporationIds = new Set(input.corporations.map((corp) => corp._id.toHexString()));
  if (corporationIds.size !== input.corporations.length)
    throw new Error("Duplicate producer corporation");
  for (const row of prepared)
    if (
      !corporationIds.has(row.target.corporationId) ||
      row.plan.accountId !== row.target.corporationId
    )
      throw new Error("Unbound corporation producer plan");
  for (const scope of input.walletScopes) observedRate(scope.currency, input.rates);
  await createProducerWallets(db, input.worldEpoch, input.walletScopes);
  const [corporations, wallets] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: [...corporationIds].map((id) => new ObjectId(id)) } },
        { projection: { liquidCapital: 1, liquidCurrencyCode: 1, producerPayables: 1 } }
      )
      .toArray(),
    db
      .collection<ProducerEconomyAccount>("producerEconomyAccounts")
      .find(
        { worldEpoch: input.worldEpoch },
        { projection: { cash: 1, currency: 1, producerPayables: 1 } }
      )
      .toArray(),
  ]);
  if (corporations.length !== corporationIds.size)
    throw new Error("Producer corporation disappeared");
  const bindings: ProducerCashBinding[] = [
    ...corporations.map((corp): ProducerCashBinding => {
      if (!corp.liquidCurrencyCode || !Number.isFinite(corp.liquidCapital))
        throw new Error("Producer corporation requires reconciled native cash");
      const id = corp._id.toHexString();
      return {
        kind: "corporation",
        accountId: id,
        corporationId: id,
        currency: corp.liquidCurrencyCode,
        localPerAnchor: observedRate(corp.liquidCurrencyCode, input.rates),
        openingCashLocal: corp.liquidCapital,
      };
    }),
    ...wallets.map((wallet): ProducerCashBinding => {
      if (!Number.isFinite(wallet.cash) || wallet.cash < 0)
        throw new Error("Invalid producer wallet cash");
      return {
        kind: "economyAccount",
        accountId: wallet._id,
        economyAccountId: wallet._id,
        currency: wallet.currency,
        localPerAnchor: observedRate(wallet.currency, input.rates),
        openingCashLocal: wallet.cash,
      };
    }),
  ];
  const openingAccounts = bindings.map((binding) => ({
    id: binding.accountId,
    cash: Math.max(0, binding.openingCashLocal / binding.localPerAnchor),
  }));
  const targets = prepared.map((row) => row.target);
  const result = await settleProducerTurn(db, {
    worldEpoch: input.worldEpoch,
    production: {
      ...input.demand,
      turn: input.turn,
      accounts: openingAccounts,
      payables: [...corporations, ...wallets].flatMap((row) => row.producerPayables?.claims ?? []),
      producers: prepared.map((row) => row.plan),
    },
    bindings,
    targets,
  });
  return publishHostState(db, input.corporations, { result, bindings, targets, openingAccounts });
}

type SettledContext = NonNullable<Awaited<ReturnType<typeof resumeProducerTurn>>>;

async function publishHostState(
  db: Db,
  corporations: readonly Corporation[],
  settled: SettledContext
) {
  const corporationIds = settled.bindings.flatMap((binding) =>
    binding.kind === "corporation" ? [binding.corporationId] : []
  );
  // Read authoritative post-settlement state even on retry. Applying an old
  // receipt's delta to freshly loaded cash would credit the same proceeds twice.
  const [closingCorporations, closingSectors] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: [...corporationIds].map((id) => new ObjectId(id)) } },
        { projection: { liquidCapital: 1, producerPayables: 1 } }
      )
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { _id: { $in: settled.targets.map((target) => new ObjectId(target.sectorId)) } },
        {
          projection: {
            corporationId: 1,
            producerSettlement: 1,
            producerCapacity: 1,
            producerInventory: 1,
            capitalStock: 1,
            capacityBookAnchor: 1,
            buildQueue: 1,
            constructionInProgressAnchor: 1,
            plantCount: 1,
            plantUnitRemainder: 1,
          },
        }
      )
      .toArray(),
  ]);
  if (
    closingCorporations.length !== corporationIds.length ||
    closingSectors.length !== settled.targets.length
  )
    throw new Error("Producer publication target disappeared");
  const closingByCorp = new Map(closingCorporations.map((corp) => [corp._id.toHexString(), corp]));
  for (const corp of corporations) {
    const closing = closingByCorp.get(corp._id.toHexString())!;
    if (!closing) continue;
    corp.liquidCapital = closing.liquidCapital;
    corp.producerPayables = closing.producerPayables;
  }
  const operatingByCorporation = new Map<
    string,
    { revenue: number; expenses: number; profit: number; cashFlow: number }
  >();
  const opening = new Map(settled.openingAccounts.map((account) => [account.id, account.cash]));
  const closing = new Map(settled.result.accounts.map((account) => [account.id, account.cash]));
  for (const id of corporationIds)
    operatingByCorporation.set(id, {
      revenue: 0,
      expenses: 0,
      profit: 0,
      cashFlow: closing.get(id)! - opening.get(id)!,
    });
  const ownerByProducer = new Map(
    settled.targets.map((target) => [target.producerId, target.corporationId])
  );
  for (const receipt of settled.result.producers) {
    const id = ownerByProducer.get(receipt.id);
    const totals = id && operatingByCorporation.get(id);
    if (!totals) throw new Error("Missing producer accounting owner");
    totals.revenue += receipt.revenue;
    totals.expenses += receipt.revenue - receipt.profit;
    totals.profit += receipt.profit;
  }
  return { result: settled.result, closingSectors, operatingByCorporation };
}
