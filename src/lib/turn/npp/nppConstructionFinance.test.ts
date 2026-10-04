import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import type { BankingSnapshot, BorrowerSnapshot } from "@/lib/banking/rules/boundary";
import { BANKING_POLICY_ALL_ON, BANKING_POLICY_OFF } from "@/lib/banking/rules/policy";
import {
  boundNppConstructionFinanceCandidates,
  loadNppConstructionFundingPool,
  selectNppConstructionFundingContext,
  type NppConstructionFinanceCandidate,
  type NppConstructionFundingPool,
  type NppConstructionLender,
} from "./nppConstructionFinance";

function corporation(id: string): Corporation {
  return {
    _id: new ObjectId(id),
    name: `Corp ${id}`,
    countryId: "US",
    type: "manufacturing",
    liquidCurrencyCode: "USD",
    liquidCapital: 100_000,
    ceoType: "npp",
  } as unknown as Corporation;
}

function candidate(
  overrides: Partial<NppConstructionFinanceCandidate> = {}
): NppConstructionFinanceCandidate {
  const corp = corporation("000000000000000000000101");
  const sector = {
    _id: new ObjectId("000000000000000000000201"),
    corporationId: corp._id,
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
  } as unknown as CorporateSector;
  const order: SectorBuildOrder = {
    unitsOrdered: 100,
    strategyId: "standard",
    costPaidAnchor: 100_000,
    startTurn: 19,
    onlineTurn: 23,
    smooth: true,
  };
  return {
    corporation: corp,
    sector,
    currency: "USD",
    order,
    costLocal: 100_000,
    cashContributionLimitLocal: 30_000,
    priority: 1,
    fill: 0.9,
    buildContext: {
      destinationCurrency: "USD",
      bucket: {
        stateId: "US-CA",
        countryId: "US",
        sectorType: "manufacturing",
      },
      eraUnitScale: 1,
      growthUnits: 40,
    },
    ...overrides,
  };
}

function lender(id: string, requireApproval: boolean): NppConstructionLender {
  const bankId = new ObjectId(id);
  const charter = {
    type: "retail" as const,
    status: "active" as const,
    currency: "USD" as const,
    charteredTurn: 5,
    postedCapital: 1_000_000,
    cashReserves: 2_000_000,
    npcDeposits: 1_000_000,
    totalDeposits: 1_000_000,
    totalLoans: 0,
    depositOffset: 0,
    lendingOffset: 0,
    requireApproval,
  };
  const snapshot: BankingSnapshot = {
    turn: 19,
    policy: BANKING_POLICY_ALL_ON,
    bankId: bankId.toHexString(),
    currency: "USD",
    charter,
    corporationLiquidCapital: 0,
    reserveRatio: 0.2,
    playerDepositsAreLiabilities: false,
    primeRate: 3,
    centralBankId: "US",
  };
  return {
    bank: { _id: bankId, bankCharter: charter },
    snapshot,
    fundConstituents: new Map(),
  };
}

function pool(lenders: NppConstructionLender[]): NppConstructionFundingPool {
  const corp = corporation("000000000000000000000101");
  const borrower: BorrowerSnapshot = {
    type: "corporation",
    id: corp._id.toHexString(),
    incomePerTurn: 10_000,
    committedPaymentPerTurn: 0,
    blocked: false,
    currencyMatches: true,
  };
  return {
    turn: 19,
    policy: BANKING_POLICY_ALL_ON,
    lendersByCurrency: new Map([["USD", lenders]]),
    borrowersByCorpAndCurrency: new Map([[`${corp._id.toHexString()}:USD`, borrower]]),
    fxByCurrency: new Map([["USD", 1]]),
  };
}

describe("NPP construction funding cohort", () => {
  it("does no banking reads unless all funding prerequisites are enabled", async () => {
    const collection = vi.fn();
    const db = { collection } as unknown as Db;
    const result = await loadNppConstructionFundingPool({
      db,
      turn: 19,
      corporations: [corporation("000000000000000000000101")],
      policy: BANKING_POLICY_OFF,
      eraUnitScale: 1,
      fxByCurrency: new Map(),
    });
    expect(result).toBeNull();
    expect(collection).not.toHaveBeenCalled();
  });

  it("selects a same-currency lender deterministically and preserves its approval policy", () => {
    const eligible = pool([
      lender("000000000000000000000302", true),
      lender("000000000000000000000301", false),
    ]);
    const selected = selectNppConstructionFundingContext(eligible, candidate());

    expect(selected?.bankId.toHexString()).toBe("000000000000000000000301");
    expect(selected?.principal).toBeCloseTo(75_000);
    expect(selected?.context.turn).toBe(19);
    expect(selected?.context.bankSnapshot.currency).toBe("USD");
    expect(selected?.context.bankCorporation._id).toEqual(selected?.bankId);
  });

  it("keeps approval-required charter policy in the selected request context", () => {
    const selected = selectNppConstructionFundingContext(
      pool([lender("000000000000000000000301", true)]),
      candidate()
    );

    expect(selected?.context.bankCorporation.bankCharter?.requireApproval).toBe(true);
    expect(selected?.context.bankSnapshot.charter?.requireApproval).toBe(true);
  });

  it("limits finance attempts and deterministically reports deferred candidates as backlog", () => {
    const lowerPriority = candidate({
      corporation: corporation("000000000000000000000102"),
      priority: 1,
    });
    const higherPriority = candidate({
      corporation: corporation("000000000000000000000103"),
      priority: 4,
    });
    const result = boundNppConstructionFinanceCandidates(
      [lowerPriority, higherPriority, candidate({ priority: 2 })],
      2
    );

    expect(result.selected.map((row) => row.priority)).toEqual([4, 2]);
    expect(result.backlogCount).toBe(1);
  });
});
