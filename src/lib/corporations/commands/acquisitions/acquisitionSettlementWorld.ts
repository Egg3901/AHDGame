/**
 * Shared in-memory world for agreed-acquisition settlement tests.
 *
 * Pre-forex corps (no `liquidCurrencyCode`) plus a mocked-empty FX map keep
 * every conversion at identity, so conservation assertions are exact without
 * mocking the conversion math itself. Share slices divide the price evenly on
 * purpose; the dust corner has its own named test.
 */

import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";

export const PRICE = 1_000_000;
export const SHELL_CASH = 5_000_000;
export const ACQUIRER_CASH = 50_000_000;

export interface AcquisitionWorld {
  memory: InMemoryDb;
  db: Db;
  acq: ObjectId;
  tgt: ObjectId;
  offerId: ObjectId;
  offer: {
    _id: ObjectId;
    acquirerCorporationId: ObjectId;
    targetCorporationId: ObjectId;
    proposedByCharacterId: ObjectId;
    priceAnchor: number;
    targetValuationAnchor: number;
    status: "pending";
    createdAtTurn: number;
    expiresAtTurn: number;
    createdAt: Date;
    updatedAt: Date;
  };
  charA: ObjectId;
  charB: ObjectId;
  imperial: ObjectId;
  corpHolder: ObjectId;
  fund: ObjectId;
  price: number;
  shellCash: number;
}

export interface WorldOpts {
  price?: number;
  shellCash?: number;
  acquirerCash?: number;
  /** Active bank charter on the target plus one satellite row per re-key set. */
  charter?: boolean;
  /** Acquirer starts with its own active charter (conflict path). */
  acquirerCharter?: boolean;
  sectorCount?: number;
  /** Extra corporation shareholders fragment the corp slice (partial tests). */
  extraCorpHolders?: number;
}

function activeCharter(charteredTurn: number) {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: 10_000_000,
    npcDeposits: 5_000_000,
  };
}

export function buildAcquisitionWorld(opts: WorldOpts = {}): AcquisitionWorld {
  const price = opts.price ?? PRICE;
  const shellCash = opts.shellCash ?? SHELL_CASH;
  const memory = createInMemoryDb();

  const acq = new ObjectId();
  const tgt = new ObjectId();
  const offerId = new ObjectId();
  const charA = new ObjectId();
  const charB = new ObjectId();
  const imperial = new ObjectId();
  const corpHolder = new ObjectId();
  const fund = new ObjectId();
  const tgtHex = tgt.toHexString();

  const corpShareholders: Array<{ corporationId: ObjectId; shares: number }> = [
    { corporationId: corpHolder, shares: 200 },
  ];
  for (let i = 0; i < (opts.extraCorpHolders ?? 0); i += 1) {
    const extra = new ObjectId();
    corpShareholders.push({ corporationId: extra, shares: 0 });
    memory.seed("corporations", [
      { _id: extra, name: `ExtraHolder${i}`, liquidCapital: 0, countryId: "US" },
    ]);
  }

  memory.seed("corporations", [
    {
      _id: acq,
      name: "AcquireCo",
      liquidCapital: opts.acquirerCash ?? ACQUIRER_CASH,
      countryId: "US",
      ...(opts.acquirerCharter ? { bankCharter: activeCharter(100) } : {}),
    },
    {
      _id: tgt,
      name: "TargetCo",
      liquidCapital: shellCash,
      countryId: "US",
      sequentialId: 42,
      totalShares: 1000,
      shareholders: [
        { characterId: charA, shares: 300 },
        { characterId: charB, shares: 200 },
        { imperialCharacterId: imperial, shares: 100 },
        ...corpShareholders,
        { fundId: fund, shares: 100 },
      ],
      publicFloat: 100,
      ...(opts.charter ? { bankCharter: activeCharter(150) } : {}),
    },
    { _id: corpHolder, name: "HolderCo", liquidCapital: 1_000, countryId: "US" },
  ]);
  memory.seed("characters", [
    { _id: charA, countryId: "US", cashOnHand: 0 },
    { _id: charB, countryId: "US", cashOnHand: 0 },
  ]);
  memory.seed("imperialCharacters", [{ _id: imperial, countryId: "US", cashOnHand: 0 }]);
  memory.seed("indexFunds", [
    { _id: fund, cashAnchor: 0, holdings: [{ corporationId: tgt, shares: 100 }] },
  ]);
  memory.seed("federalBudget", [{ _id: new ObjectId(), countryId: "US", treasuryBalance: 0 }]);

  const sectorCount = opts.sectorCount ?? 1;
  for (let i = 0; i < sectorCount; i += 1) {
    memory.seed("corporateSectors", [
      {
        _id: new ObjectId(),
        corporationId: tgt,
        stateId: `ST${i}`,
        sectorType: "agriculture",
        revenue: 100,
        workers: 10,
        currentGrowthCost: 5,
      },
    ]);
  }

  if (opts.charter) {
    memory.seed("bankLoans", [{ _id: new ObjectId(), bankCorporationId: tgt }]);
    memory.seed("interbankLoans", [
      { _id: new ObjectId(), lenderCorporationId: tgt, borrowerCorporationId: acq },
      { _id: new ObjectId(), lenderCorporationId: acq, borrowerCorporationId: tgt },
    ]);
    memory.seed("savingsAccounts", [{ _id: new ObjectId(), holder: tgtHex, status: "open" }]);
    memory.seed("characters", [
      {
        _id: new ObjectId(),
        countryId: "US",
        cashOnHand: 0,
        currencyBalances: { savingsHolder: { USD: tgtHex } },
      },
    ]);
  }

  const offer = {
    _id: offerId,
    acquirerCorporationId: acq,
    targetCorporationId: tgt,
    proposedByCharacterId: new ObjectId(),
    priceAnchor: price,
    targetValuationAnchor: price,
    status: "pending" as const,
    createdAtTurn: 100,
    expiresAtTurn: 999,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  memory.seed("acquisitionOffers", [{ ...offer }]);
  memory.seed("acquisitionSettlements", []);

  return {
    memory,
    db: memory as unknown as Db,
    acq,
    tgt,
    offerId,
    offer,
    charA,
    charB,
    imperial,
    corpHolder,
    fund,
    price,
    shellCash,
  };
}

/** Pinned per-bucket slices for the default world (price 1M, even split). */
export function defaultSlices(price: number) {
  const unit = price / 1000;
  return {
    charA: 300 * unit,
    charB: 200 * unit,
    imperial: 100 * unit,
    corp: 200 * unit,
    fund: 100 * unit,
    float: 100 * unit,
  };
}

export interface WorldBalances {
  acquirer: number;
  charA: number;
  charB: number;
  imperial: number;
  corpHolder: number;
  fundCash: number;
  fundHoldings: number;
  treasury: number;
  targetGone: boolean;
  acquirerSectors: number;
}

export async function readBalances(w: AcquisitionWorld): Promise<WorldBalances> {
  const acquirer = await w.memory.collection("corporations").findOne({ _id: w.acq });
  const charA = await w.memory.collection("characters").findOne({ _id: w.charA });
  const charB = await w.memory.collection("characters").findOne({ _id: w.charB });
  const imperial = await w.memory.collection("imperialCharacters").findOne({ _id: w.imperial });
  const corpHolder = await w.memory.collection("corporations").findOne({ _id: w.corpHolder });
  const fund = await w.memory.collection("indexFunds").findOne({ _id: w.fund });
  const treasury = await w.memory.collection("federalBudget").findOne({ countryId: "US" });
  const target = await w.memory.collection("corporations").findOne({ _id: w.tgt });
  const acquirerSectors = await w.memory
    .collection("corporateSectors")
    .countDocuments({ corporationId: w.acq });
  return {
    acquirer: (acquirer?.liquidCapital as number) ?? NaN,
    charA: (charA?.cashOnHand as number) ?? NaN,
    charB: (charB?.cashOnHand as number) ?? NaN,
    imperial: (imperial?.cashOnHand as number) ?? NaN,
    corpHolder: (corpHolder?.liquidCapital as number) ?? NaN,
    fundCash: (fund?.cashAnchor as number) ?? NaN,
    fundHoldings: ((fund?.holdings as unknown[]) ?? []).length,
    treasury: (treasury?.treasuryBalance as number) ?? NaN,
    targetGone: target == null,
    acquirerSectors,
  };
}
