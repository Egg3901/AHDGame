import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import { describe, it, expect, vi } from "vitest";
import {
  NPP_SUPPLY_AGREEMENT_PROJECTION,
  NPP_SUPPLY_SECTOR_PROJECTION,
  toExistingNppAgreement,
  toParty,
  decideNppSupplyAgreements,
  indexLiveAgreements,
  nppContractPremium,
  decideAiSupplyListings,
  buildTradeBlocked,
  aiListingId,
  processNppSupplyAgreements,
  AI_LISTINGS_PER_SIDE,
  NPP_CONTRACT_GLUT_PREMIUM,
  NPP_CONTRACT_SHORTAGE_PREMIUM,
  type NppAgreementParty,
  type ExistingNppAgreement,
} from "./nppSupplyAgreements";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeSupplierCommodityCapacityUnits } from "@/lib/corporations/supplyAgreementCapacity";
import { CONTRACT_OVERCOMMIT_TOLERANCE } from "@/lib/db/types/supplyAgreement";

const TURN = 10;
const always = () => true;
const never = () => false;

function mill(over: Partial<NppAgreementParty> = {}): NppAgreementParty {
  return {
    corpId: "buyer1",
    countryId: "US",
    isNatcorp: false,
    sectors: [
      {
        sectorType: "manufacturing",
        capitalStock: 10_000,
        strategyId: "standard",
        throughputFactor: 0.8,
        productionPolicyLevel: 0,
      },
    ],
    ...over,
  };
}

function miner(over: Partial<NppAgreementParty> = {}): NppAgreementParty {
  return {
    corpId: "seller1",
    countryId: "US",
    isNatcorp: false,
    sectors: [
      {
        sectorType: "extraction",
        capitalStock: 10_000,
        strategyId: "iron_mining",
        soldFraction: 0.3,
        productionPolicyLevel: 0,
      },
    ],
    ...over,
  };
}

function prices(map: Partial<Record<CommodityType, number>>) {
  return (commodity: CommodityType) => map[commodity] ?? null;
}

describe("nppContractPremium", () => {
  it("discounts a glutted seller and premia a shortage", () => {
    expect(nppContractPremium(0.2, 1)).toBe(NPP_CONTRACT_GLUT_PREMIUM);
    expect(nppContractPremium(0.95, 1.3)).toBe(NPP_CONTRACT_SHORTAGE_PREMIUM);
    expect(nppContractPremium(0.9, 1)).toBe(0);
  });
});

describe("decideNppSupplyAgreements", () => {
  it("activates a pending inbound proposal the NPP buyer uses", () => {
    const pending: ExistingNppAgreement = {
      id: "ag1",
      supplierCorpId: "player-miner",
      buyerCorpId: "buyer1",
      commodity: "iron",
      volumeCap: 100,
      pricePremium: 0.05,
      status: "pending",
    };
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill()],
      agreements: [pending],
      priceRatioOf: prices({ iron: 1.2 }),
      staggerEligible: always,
    });
    expect(d).toContainEqual({ action: "activate", agreementId: "ag1" });
  });

  it("refuses a gouging inbound premium", () => {
    const pending: ExistingNppAgreement = {
      id: "ag1",
      supplierCorpId: "player-miner",
      buyerCorpId: "buyer1",
      commodity: "iron",
      volumeCap: 100,
      pricePremium: 0.3,
      status: "pending",
    };
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill()],
      agreements: [pending],
      priceRatioOf: prices({ iron: 1.2 }),
      staggerEligible: always,
    });
    expect(d.filter((x) => x.action === "activate")).toHaveLength(0);
  });

  it("serves cancel notice when the supplier has mothballed every plant of that commodity", () => {
    const active: ExistingNppAgreement = {
      id: "ag2",
      supplierCorpId: "seller1",
      buyerCorpId: "buyer1",
      commodity: "iron",
      volumeCap: 100,
      pricePremium: 0,
      status: "active",
    };
    const cold = miner({
      sectors: [
        {
          sectorType: "extraction",
          capitalStock: 10_000,
          strategyId: "iron_mining",
          mothballed: true,
          productionPolicyLevel: 0,
        },
      ],
    });
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [cold],
      agreements: [active],
      priceRatioOf: prices({}),
      staggerEligible: always,
    });
    expect(d).toContainEqual({ action: "cancelNotice", agreementId: "ag2" });
  });

  it("proposes a same-country NPP-NPP iron contract into a starved mill", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill(), miner()],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: always,
    });
    const propose = d.find((x) => x.action === "propose");
    expect(propose).toMatchObject({
      action: "propose",
      supplierCorpId: "seller1",
      buyerCorpId: "buyer1",
      commodity: "iron",
    });
    if (propose?.action === "propose") {
      expect(propose.volumeCap).toBeGreaterThan(0);
      expect(propose.pricePremium).toBe(NPP_CONTRACT_GLUT_PREMIUM);
    }
  });

  it("does not propose to a player-run buyer", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill({ corpId: "player-mill", isPlayer: true }), miner()],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: always,
    });
    expect(d.filter((x) => x.action === "propose")).toHaveLength(0);
  });

  it("does not cross countries (1953 iron-curtain)", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill(), miner({ countryId: "RU" })],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: always,
    });
    expect(d.filter((x) => x.action === "propose")).toHaveLength(0);
  });

  it("does not propose when the stagger slot misses", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill(), miner()],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: never,
    });
    expect(d).toHaveLength(0);
  });

  it("skips SOE suppliers", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill(), miner({ isNatcorp: true })],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: always,
    });
    expect(d.filter((x) => x.action === "propose")).toHaveLength(0);
  });

  it("does not propose below plants (no physical volumeCap basis)", () => {
    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: false,
      parties: [mill(), miner()],
      agreements: [],
      priceRatioOf: prices({ iron: 1.4 }),
      staggerEligible: always,
    });
    expect(d.filter((x) => x.action === "propose")).toHaveLength(0);
  });

  it("proposes freight per host state to a buyer starved in that same state", () => {
    const haulier: NppAgreementParty = {
      corpId: "haulier",
      countryId: "US",
      isNatcorp: false,
      sectors: [
        {
          sectorType: "logistics",
          capitalStock: 10_000,
          strategyId: "standard",
          soldFraction: 0.2,
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ],
    };
    const texasMine = mill({
      corpId: "tx-mine",
      sectors: [
        {
          sectorType: "extraction",
          capitalStock: 10_000,
          strategyId: "standard",
          throughputFactor: 0.5,
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ],
    });
    const newYorkMine = mill({
      corpId: "ny-mine",
      sectors: [
        {
          sectorType: "extraction",
          capitalStock: 10_000,
          strategyId: "standard",
          throughputFactor: 0.5,
          productionPolicyLevel: 0,
          stateId: "NY",
        },
      ],
    });

    const acrossStates = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [newYorkMine, haulier],
      agreements: [],
      priceRatioOf: prices({ freight: 1.4 }),
      staggerEligible: always,
    });
    expect(acrossStates.filter((x) => x.action === "propose")).toHaveLength(0);

    const sameState = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [texasMine, haulier],
      agreements: [],
      priceRatioOf: prices({ freight: 1.4 }),
      staggerEligible: always,
    });
    expect(sameState).toContainEqual(
      expect.objectContaining({
        action: "propose",
        supplierCorpId: "haulier",
        buyerCorpId: "tx-mine",
        commodity: "freight",
        stateId: "TX",
      })
    );
  });

  it("activates a state-scoped freight proposal the buyer uses in that state", () => {
    const texasMine = mill({
      corpId: "tx-mine",
      sectors: [
        {
          sectorType: "extraction",
          capitalStock: 10_000,
          strategyId: "standard",
          throughputFactor: 0.5,
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ],
    });
    const pending: ExistingNppAgreement = {
      id: "freight-tx",
      supplierCorpId: "player-haulier",
      buyerCorpId: "tx-mine",
      commodity: "freight",
      stateId: "TX",
      volumeCap: 100,
      pricePremium: 0,
      status: "pending",
    };
    const wrongState: ExistingNppAgreement = { ...pending, id: "freight-ny", stateId: "NY" };

    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [texasMine],
      agreements: [pending, wrongState],
      priceRatioOf: prices({ freight: 1.4 }),
      staggerEligible: always,
    });
    expect(d).toContainEqual({ action: "activate", agreementId: "freight-tx" });
    expect(d).not.toContainEqual({ action: "activate", agreementId: "freight-ny" });
  });

  it("does not activate or propose corporation-wide freight agreements", () => {
    const freightSupplier: NppAgreementParty = {
      corpId: "haulier",
      countryId: "US",
      isNatcorp: false,
      sectors: [
        {
          sectorType: "logistics",
          capitalStock: 10_000,
          strategyId: "standard",
          soldFraction: 0.2,
          productionPolicyLevel: 0,
        },
      ],
    };
    const pending: ExistingNppAgreement = {
      id: "freight-pending",
      supplierCorpId: "player-haulier",
      buyerCorpId: "buyer1",
      commodity: "freight",
      volumeCap: 100,
      pricePremium: 0,
      status: "pending",
    };

    const d = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [mill(), freightSupplier],
      agreements: [pending],
      priceRatioOf: prices({ freight: 1.4 }),
      staggerEligible: always,
    });

    expect(d).not.toContainEqual({ action: "activate", agreementId: "freight-pending" });
    expect(d).not.toContainEqual(
      expect.objectContaining({ action: "propose", commodity: "freight" })
    );
  });
});

describe("decideNppSupplyAgreements — media capacity parity", () => {
  // A proposed volumeCap the supplier can never fill is a standing damages
  // bill, so the matcher has to size media on the derated figure the
  // production sink credits.
  function broadcaster(over: Partial<NppAgreementParty> = {}): NppAgreementParty {
    return {
      corpId: "seller-media",
      countryId: "US",
      isNatcorp: false,
      sectors: [
        {
          sectorType: "media",
          capitalStock: 10_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          countryId: "US",
        },
      ],
      ...over,
    };
  }

  it("sizes an advertising contract on the derated media figure", () => {
    const adBuyer: NppAgreementParty = {
      corpId: "buyer-ads",
      countryId: "US",
      isNatcorp: false,
      sectors: [
        {
          sectorType: "retail",
          capitalStock: 10_000,
          strategyId: "standard",
          throughputFactor: 0.8,
          productionPolicyLevel: 0,
          countryId: "US",
        },
      ],
    };

    const proposals = decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [adBuyer, broadcaster()],
      agreements: [],
      priceRatioOf: prices({ advertising: 1.4 }),
      staggerEligible: always,
    }).flatMap((x) => (x.action === "propose" && x.commodity === "advertising" ? [x] : []));

    const capacity = computeSupplierCommodityCapacityUnits({
      sectors: broadcaster().sectors,
      commodity: "advertising",
      isNatcorp: false,
      turn: TURN,
    });
    for (const p of proposals) {
      expect(p.volumeCap).toBeLessThanOrEqual(capacity * CONTRACT_OVERCOMMIT_TOLERANCE + 1e-6);
    }
  });
});

describe("NPP supply pass projections", () => {
  // Keep only the projected keys, as the server does for an inclusion projection.
  const project = <T extends Record<string, unknown>>(doc: T, projection: Record<string, 1>) =>
    Object.fromEntries(
      Object.entries(doc).filter(([key]) => key === "_id" || key in projection)
    ) as unknown as T;

  it("loads every sector field the matcher reads", () => {
    const sector = {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      sectorType: "steel_mill",
      capitalStock: 1200,
      producedUnits: { steel: 40 },
      soldFraction: 0.8,
      throughputFactor: 0.9,
      mothballed: false,
      strategyId: "volume",
      transitionFromStrategyId: "premium",
      retoolRescaleApplied: true,
      transitionStartTurn: 9,
      productionPolicyLevel: 2,
      embargoSuspended: false,
      embargoExportExposure: 0.1,
      countryId: "US",
      stateId: "US_PA",
      plants: [{ id: "p1" }],
      buildQueue: [{ id: "b1" }],
      plantsPnl: { p1: 1 },
      soldByCommodity: { steel: 30 },
    } as unknown as CorporateSector;
    const corp = { _id: new ObjectId(), countryId: "US", ceoType: "npp" } as unknown as Corporation;

    expect(
      toParty(corp, [
        project(
          sector as unknown as Record<string, unknown>,
          NPP_SUPPLY_SECTOR_PROJECTION
        ) as unknown as CorporateSector,
      ])
    ).toEqual(toParty(corp, [sector]));
  });

  it("loads every agreement field the matcher reads", () => {
    const agreement = {
      _id: new ObjectId(),
      supplierCorpId: new ObjectId(),
      buyerCorpId: new ObjectId(),
      commodity: "steel",
      stateId: "US_PA",
      volumeCap: 50,
      pricePremium: 0.05,
      status: "active",
      lastDeliveredUnits: 40,
      lastShortfallUnits: 10,
      createdAt: new Date(),
    } as unknown as SupplyAgreement;

    expect(
      toExistingNppAgreement(
        project(
          agreement as unknown as Record<string, unknown>,
          NPP_SUPPLY_AGREEMENT_PROJECTION
        ) as unknown as SupplyAgreement
      )
    ).toEqual(toExistingNppAgreement(agreement));
  });
});

describe("indexLiveAgreements", () => {
  // The scanning definitions the proposal step used before the index.
  const live = (status: string) =>
    status === "pending" || status === "active" || status === "cancelling";
  const scanCommitted = (
    agreements: ExistingNppAgreement[],
    supplier: string,
    commodity: CommodityType,
    stateId?: string
  ) => {
    let sum = 0;
    for (const a of agreements) {
      if (a.supplierCorpId !== supplier || a.commodity !== commodity) continue;
      if ((a.stateId ?? undefined) !== stateId) continue;
      if (!live(a.status)) continue;
      sum += a.volumeCap;
    }
    return sum;
  };
  const scanPair = (
    agreements: ExistingNppAgreement[],
    supplier: string,
    buyer: string,
    commodity: CommodityType,
    stateId?: string
  ) =>
    agreements.some(
      (a) =>
        a.supplierCorpId === supplier &&
        a.buyerCorpId === buyer &&
        a.commodity === commodity &&
        (a.stateId ?? undefined) === stateId &&
        live(a.status)
    );

  it("answers every committed-volume and pair question exactly as a full scan", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const corps = ["c1", "c2", "c3", "c4"];
    const commodities = ["steel", "freight", "coal"] as CommodityType[];
    const states = [undefined, "US_PA", "US_OH", ""];
    const statuses = ["pending", "active", "cancelling", "cancelled"];
    const agreements: ExistingNppAgreement[] = Array.from({ length: 400 }, (_, i) => {
      const stateId = pick(states);
      return {
        id: `a${i}`,
        supplierCorpId: pick(corps),
        buyerCorpId: pick(corps),
        commodity: pick(commodities),
        ...(stateId !== undefined ? { stateId } : {}),
        volumeCap: Math.round(rand() * 1000) / 7,
        pricePremium: 0,
        status: pick(statuses) as ExistingNppAgreement["status"],
      };
    });
    const index = indexLiveAgreements(agreements);
    for (const supplier of corps)
      for (const commodity of commodities)
        for (const stateId of states) {
          expect(index.committedVolume(supplier, commodity, stateId)).toBe(
            scanCommitted(agreements, supplier, commodity, stateId)
          );
          for (const buyer of corps) {
            expect(index.pairExists(supplier, buyer, commodity, stateId)).toBe(
              scanPair(agreements, supplier, buyer, commodity, stateId)
            );
          }
        }
  });
});

describe("AI supplier accepts a player buy proposal", () => {
  const proposal = (over: Partial<ExistingNppAgreement> = {}): ExistingNppAgreement => ({
    id: "pb1",
    supplierCorpId: "seller1",
    buyerCorpId: "player1",
    commodity: "iron",
    volumeCap: 10,
    pricePremium: 0,
    status: "pending",
    proposedByCorpId: "player1",
    ...over,
  });
  const run = (
    agreements: ExistingNppAgreement[],
    over: Partial<Parameters<typeof decideNppSupplyAgreements>[0]> = {}
  ) =>
    decideNppSupplyAgreements({
      turn: TURN,
      plantsEnabled: true,
      parties: [miner()],
      agreements,
      priceRatioOf: prices({}),
      staggerEligible: always,
      externalBuyers: new Map([["player1", { countryId: "US" }]]),
      ...over,
    });

  it("accepts with spare capacity at par", () => {
    expect(run([proposal()])).toContainEqual({ action: "activate", agreementId: "pb1" });
  });

  it("accepts a discount at the 10% floor but not deeper", () => {
    expect(run([proposal({ pricePremium: -0.1 })])).toContainEqual({
      action: "activate",
      agreementId: "pb1",
    });
    expect(run([proposal({ pricePremium: -0.11 })])).toEqual([]);
  });

  it("refuses when the volume exceeds spare capacity", () => {
    expect(run([proposal({ volumeCap: 1e12 })])).toEqual([]);
  });

  it("refuses when settled contracts already use the capacity", () => {
    const cap = computeSupplierCommodityCapacityUnits({
      sectors: miner().sectors,
      commodity: "iron",
      isNatcorp: false,
      turn: TURN,
    });
    const full: ExistingNppAgreement = {
      id: "full",
      supplierCorpId: "seller1",
      buyerCorpId: "other",
      commodity: "iron",
      volumeCap: cap * CONTRACT_OVERCOMMIT_TOLERANCE,
      pricePremium: 0,
      status: "active",
    };
    expect(run([full, proposal({ volumeCap: 1 })])).toEqual([]);
  });

  it("does not over-accept two proposals past spare capacity", () => {
    const cap = computeSupplierCommodityCapacityUnits({
      sectors: miner().sectors,
      commodity: "iron",
      isNatcorp: false,
      turn: TURN,
    });
    const half = (cap * CONTRACT_OVERCOMMIT_TOLERANCE * 0.6) | 0;
    const d = run([proposal({ id: "a", volumeCap: half }), proposal({ id: "b", volumeCap: half })]);
    expect(d.filter((x) => x.action === "activate")).toHaveLength(1);
  });

  it("refuses state-owned suppliers", () => {
    expect(run([proposal()], { parties: [miner({ isNatcorp: true })] })).toEqual([]);
  });

  it("ignores proposals the supplier authored itself", () => {
    expect(run([proposal({ proposedByCorpId: "seller1" })])).toEqual([]);
  });

  it("refuses across an embargo lane but accepts same-country", () => {
    const blocked = buildTradeBlocked({
      embargoes: [
        {
          sourceCountry: "US",
          targetCountry: "RU",
          commodity: "all",
          direction: "export",
          mode: "block",
        },
      ],
      turn: TURN,
    });
    const foreign = new Map([["player1", { countryId: "RU" }]]);
    expect(run([proposal()], { externalBuyers: foreign, tradeBlocked: blocked })).toEqual([]);
    expect(run([proposal()], { tradeBlocked: blocked })).toContainEqual({
      action: "activate",
      agreementId: "pb1",
    });
  });
});

describe("buildTradeBlocked", () => {
  it("honours import embargoes from the buyer side and expiry", () => {
    const f = buildTradeBlocked({
      embargoes: [
        {
          sourceCountry: "UK",
          targetCountry: "US",
          commodity: "iron",
          direction: "import",
          mode: "block",
        },
        {
          sourceCountry: "FR",
          targetCountry: "US",
          commodity: "iron",
          direction: "both",
          mode: "block",
          expiresTurn: TURN - 1,
        },
      ],
      turn: TURN,
    });
    expect(f("iron", "US", "UK")).toBe(true);
    expect(f("steel", "US", "UK")).toBe(false);
    expect(f("iron", "US", "FR")).toBe(false);
    expect(f("iron", "US", "US")).toBe(false);
  });
});

describe("decideAiSupplyListings", () => {
  const base = {
    turn: TURN,
    plantsEnabled: true,
    agreements: [] as ExistingNppAgreement[],
    priceRatioOf: prices({ iron: 1.05 }),
  };

  it("posts a capped sell listing from spare capacity, priced from the ratio", () => {
    const out = decideAiSupplyListings({ ...base, parties: [miner()] });
    const sell = out.find((x) => x.side === "sell" && x.commodity === "iron");
    expect(sell).toBeDefined();
    const cap = computeSupplierCommodityCapacityUnits({
      sectors: miner().sectors,
      commodity: "iron",
      isNatcorp: false,
      turn: TURN,
    });
    expect(sell!.volumeCap).toBeGreaterThan(0);
    expect(sell!.volumeCap).toBeLessThanOrEqual(cap * CONTRACT_OVERCOMMIT_TOLERANCE);
    expect(sell!.pricePremium).toBeCloseTo(0.05, 5);
    expect(aiListingId(sell!)).toBe("seller1:ai:sell:iron");
  });

  it("nets contracted volume out of the sell listing", () => {
    const cap = computeSupplierCommodityCapacityUnits({
      sectors: miner().sectors,
      commodity: "iron",
      isNatcorp: false,
      turn: TURN,
    });
    const full: ExistingNppAgreement = {
      id: "x",
      supplierCorpId: "seller1",
      buyerCorpId: "b",
      commodity: "iron",
      volumeCap: cap * CONTRACT_OVERCOMMIT_TOLERANCE,
      pricePremium: 0,
      status: "active",
    };
    const out = decideAiSupplyListings({ ...base, parties: [miner()], agreements: [full] });
    expect(out.find((x) => x.side === "sell" && x.commodity === "iron")).toBeUndefined();
  });

  it("posts a buy listing for starved input demand and clamps premium to the band", () => {
    const out = decideAiSupplyListings({
      ...base,
      parties: [mill()],
      priceRatioOf: prices({ iron: 3 }),
    });
    const buy = out.find((x) => x.side === "buy" && x.commodity === "iron");
    expect(buy).toBeDefined();
    expect(buy!.pricePremium).toBeLessThanOrEqual(0.2);
    expect(buy!.volumeCap).toBeGreaterThan(0);
  });

  it("skips players, planned economies and plants-off worlds, and caps per side", () => {
    expect(decideAiSupplyListings({ ...base, parties: [miner({ isPlayer: true })] })).toEqual([]);
    expect(decideAiSupplyListings({ ...base, plantsEnabled: false, parties: [miner()] })).toEqual(
      []
    );
    const planned = decideAiSupplyListings({
      ...base,
      parties: [miner({ countryId: "RU" })],
      currentYear: 1953,
      commandEconomyEnabled: true,
    });
    expect(planned).toEqual([]);
    const out = decideAiSupplyListings({ ...base, parties: [miner(), mill()] });
    for (const id of ["seller1", "buyer1"]) {
      for (const side of ["sell", "buy"]) {
        expect(out.filter((x) => x.corpId === id && x.side === side).length).toBeLessThanOrEqual(
          AI_LISTINGS_PER_SIDE
        );
      }
    }
  });
});

describe("processNppSupplyAgreements shell", () => {
  function fakeDb(over: {
    agreements: (sellerId: ObjectId) => unknown[];
    listings?: unknown[];
    buyer?: { _id: ObjectId; countryId: string };
  }) {
    const sellerId = new ObjectId();
    const calls = {
      agreementBulk: [] as unknown[],
      listingBulk: [] as unknown[],
      listingDelete: [] as unknown[],
    };
    const cursor = (rows: unknown[]) => ({ toArray: async () => rows });
    const coll = (name: string) => {
      switch (name) {
        case "gameConfig":
          return { findOne: async () => ({ supplyAgreementsEnabled: true }) };
        case "gameState":
          return { findOne: async () => ({ currentYear: 1953 }) };
        case "corporations":
          return {
            find: (q: { ceoType?: string }) =>
              cursor(
                q.ceoType === "npp"
                  ? [{ _id: sellerId, countryId: "US", ceoType: "npp" }]
                  : over.buyer
                    ? [over.buyer]
                    : []
              ),
          };
        case "corporateSectors":
          return {
            find: () =>
              cursor([
                {
                  corporationId: sellerId,
                  sectorType: "extraction",
                  capitalStock: 10_000,
                  strategyId: "iron_mining",
                  productionPolicyLevel: 0,
                },
              ]),
          };
        case "commodityPrices":
        case "tradeEmbargoes":
          return { find: () => cursor([]) };
        case "supplyAgreements":
          return {
            find: () => cursor(over.agreements(sellerId)),
            bulkWrite: async (ops: unknown[]) => {
              calls.agreementBulk.push(...ops);
              return { modifiedCount: ops.length };
            },
            insertMany: vi.fn(),
          };
        case "supplyListings":
          return {
            find: () => cursor(over.listings ?? []),
            bulkWrite: async (ops: unknown[]) => {
              calls.listingBulk.push(...ops);
              return {};
            },
            deleteMany: async (f: unknown) => {
              calls.listingDelete.push(f);
              return {};
            },
          };
        default:
          throw new Error(`unexpected collection ${name}`);
      }
    };
    return { db: { collection: coll } as never, calls, sellerId };
  }

  it("stamps startsAtTurn and expiresAtTurn when auto-accepting a buy proposal", async () => {
    const buyer = { _id: new ObjectId(), countryId: "US" };
    const f = fakeDb({
      buyer,
      agreements: (sellerId) => [
        {
          _id: new ObjectId(),
          supplierCorpId: sellerId,
          buyerCorpId: buyer._id,
          proposedByCorpId: buyer._id,
          commodity: "iron",
          volumeCap: 1,
          pricePremium: 0,
          durationTurns: 48,
          status: "pending",
        },
      ],
    });
    await processNppSupplyAgreements(f.db, 100, new Date(), true);
    const op = f.calls.agreementBulk[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(op.updateOne.update.$set).toMatchObject({
      status: "active",
      startsAtTurn: 100,
      expiresAtTurn: 148,
    });
    expect(f.calls.listingBulk.length).toBeGreaterThan(0);
  });

  it("upserts listings by stable id and deletes stale AI listings", async () => {
    const f = fakeDb({
      agreements: () => [],
      listings: [{ _id: "gone:ai:sell:coal", volumeCap: 1, pricePremium: 0, expiresAtTurn: 999 }],
    });
    await processNppSupplyAgreements(f.db, 100, new Date(), true);
    const op = f.calls.listingBulk[0] as {
      replaceOne: {
        filter: { _id: string };
        replacement: { aiListed: boolean; publishedByUserId?: string };
        upsert: boolean;
      };
    };
    expect(op.replaceOne.filter._id).toBe(`${f.sellerId}:ai:sell:iron`);
    expect(op.replaceOne.upsert).toBe(true);
    expect(op.replaceOne.replacement.aiListed).toBe(true);
    expect(op.replaceOne.replacement.publishedByUserId).toBeUndefined();
    expect(f.calls.listingDelete[0]).toMatchObject({ _id: { $in: ["gone:ai:sell:coal"] } });
  });
});
