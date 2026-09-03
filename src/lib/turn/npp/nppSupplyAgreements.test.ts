import { describe, it, expect } from "vitest";
import {
  decideNppSupplyAgreements,
  nppContractPremium,
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
