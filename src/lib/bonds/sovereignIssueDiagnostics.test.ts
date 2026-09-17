import { describe, expect, it } from "vitest";
import type { Bond } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  consolidateSovereignTranches,
  planSovereignTranches,
  SOVEREIGN_MIN_TRANCHE_UNITS,
  summarizeSovereignIssuanceByCountry,
  summarizeSovereignIssue,
} from "./sovereignIssueDiagnostics";
import { SOVEREIGN_RECONCILE_DISTRIBUTION } from "./sovereign";

function bond(input: {
  countryId?: "US" | "UK";
  issuerType?: Bond["issuerType"];
  maturityTurn?: number;
  issuedAtTurn?: number;
  couponRate?: number;
  marketPrice?: number;
  totalIssued?: number;
  publicFloat?: number;
  holders?: Bond["holders"];
  primaryFillRatio?: number;
  matured?: boolean;
}): Bond {
  return {
    issuerType: input.issuerType ?? "sovereign",
    countryId: input.countryId ?? "US",
    maturityTurn: input.maturityTurn ?? 288,
    issuedAtTurn: input.issuedAtTurn ?? 240,
    couponRate: input.couponRate ?? 5,
    marketPrice: input.marketPrice ?? 1,
    totalIssued: input.totalIssued ?? 2_000 * BOND_UNIT_FACE_VALUE,
    publicFloat: input.publicFloat ?? 0,
    holders: input.holders ?? [],
    primaryFillRatio: input.primaryFillRatio,
    matured: input.matured ?? false,
  } as Bond;
}

function holder(units: number): Bond["holders"][number] {
  return { units } as Bond["holders"][number];
}

describe("summarizeSovereignIssue", () => {
  it("reports holders, subscription, spread, and the stamped primary fill", () => {
    const summary = summarizeSovereignIssue(
      bond({
        holders: [holder(600), holder(400)],
        publicFloat: 1000,
        marketPrice: 0.97,
        primaryFillRatio: 0.5,
      })
    );
    expect(summary.holderCount).toBe(2);
    expect(summary.heldUnits).toBe(1000);
    expect(summary.floatUnits).toBe(1000);
    expect(summary.subscriptionRate).toBe(0.5);
    expect(summary.spreadToParPct).toBeCloseTo(3);
    expect(summary.primaryFillRatio).toBe(0.5);
    expect(summary.countryId).toBe("US");
  });

  it("ignores zero-balance holder rows", () => {
    const summary = summarizeSovereignIssue(
      bond({ holders: [holder(100), holder(0)], publicFloat: 100 })
    );
    expect(summary.holderCount).toBe(1);
    expect(summary.subscriptionRate).toBe(0.5);
  });

  it("treats a fully placed issue as fully subscribed", () => {
    const summary = summarizeSovereignIssue(bond({ holders: [holder(50)], publicFloat: 0 }));
    expect(summary.subscriptionRate).toBe(1);
  });

  it("reports zero subscription when nothing is outstanding", () => {
    const summary = summarizeSovereignIssue(bond({ holders: [], publicFloat: 0 }));
    expect(summary.subscriptionRate).toBe(0);
    expect(summary.holderCount).toBe(0);
  });

  it("leaves the primary fill null when the market never stamped one", () => {
    expect(summarizeSovereignIssue(bond({})).primaryFillRatio).toBeNull();
  });

  it("flags legs below the tranche floor as thin, at the boundary as not", () => {
    expect(
      summarizeSovereignIssue(bond({ totalIssued: 999 * BOND_UNIT_FACE_VALUE })).thinIssue
    ).toBe(true);
    expect(
      summarizeSovereignIssue(
        bond({ totalIssued: SOVEREIGN_MIN_TRANCHE_UNITS * BOND_UNIT_FACE_VALUE })
      ).thinIssue
    ).toBe(false);
  });
});

describe("summarizeSovereignIssuanceByCountry", () => {
  it("groups live sovereign issues and skips corporate and matured paper", () => {
    const rows = summarizeSovereignIssuanceByCountry([
      bond({ countryId: "US", holders: [holder(10)], publicFloat: 10 }),
      bond({ countryId: "US", holders: [], publicFloat: 500 }),
      bond({ countryId: "UK", holders: [], publicFloat: 300 }),
      bond({ countryId: "US", issuerType: "corporate", holders: [], publicFloat: 700 }),
      bond({ countryId: "UK", holders: [holder(5)], publicFloat: 0, matured: true }),
    ]);
    expect(rows.map((row) => row.countryId)).toEqual(["UK", "US"]);
    const us = rows.find((row) => row.countryId === "US")!;
    expect(us.issueCount).toBe(2);
    expect(us.unheldIssueCount).toBe(1);
    expect(us.noHolderShare).toBe(0.5);
    expect(us.medianHolders).toBe(0.5);
    const uk = rows.find((row) => row.countryId === "UK")!;
    expect(uk.issueCount).toBe(1);
    expect(uk.unheldIssueCount).toBe(1);
  });

  it("concentrates a single maturity rung at maximum HHI", () => {
    const rows = summarizeSovereignIssuanceByCountry([
      bond({ countryId: "US", maturityTurn: 288 }),
      bond({ countryId: "US", maturityTurn: 288 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.maturityHhi).toBe(10_000);
  });

  it("returns no rows for an empty book", () => {
    expect(summarizeSovereignIssuanceByCountry([])).toEqual([]);
  });
});

describe("planSovereignTranches", () => {
  it("splits the default ladder exactly like the scheduler", () => {
    const tranches = planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, 225_000_000_000);
    expect(tranches).toHaveLength(3);
    expect(tranches.map((tranche) => tranche.maturityTurns)).toEqual([48, 96, 240]);
    expect(tranches.map((tranche) => tranche.amount)).toEqual([
      Math.floor((225_000_000_000 * 0.25) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE,
      Math.floor((225_000_000_000 * 0.35) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE,
      Math.floor((225_000_000_000 * 0.4) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE,
    ]);
  });

  it("skips dust rungs below one face unit and empty fractions", () => {
    const tranches = planSovereignTranches({ 48: 0.99, 96: 0, 240: 0.01 }, 1500);
    expect(tranches).toEqual([{ maturityTurns: 48, amount: 1000 }]);
  });
});

describe("consolidateSovereignTranches", () => {
  it("returns the ladder untouched when the floor is off", () => {
    const tranches = planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, 3_000_000);
    expect(consolidateSovereignTranches(tranches, 0)).toEqual(tranches);
  });

  it("returns the ladder untouched when every rung clears the floor", () => {
    const tranches = planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, 225_000_000_000);
    expect(consolidateSovereignTranches(tranches, SOVEREIGN_MIN_TRANCHE_UNITS)).toEqual(tranches);
  });

  it("folds a dust rung into the largest rung and preserves the total", () => {
    // 3M quarterly: 750k / 1.05M / 1.2M face; the 750-unit 1yr leg is dust.
    const tranches = planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, 3_000_000);
    expect(tranches).toHaveLength(3);
    const merged = consolidateSovereignTranches(tranches, SOVEREIGN_MIN_TRANCHE_UNITS);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.maturityTurns).toBe(240);
    expect(merged[0]!.amount).toBe(tranches.reduce((sum, tranche) => sum + tranche.amount, 0));
  });

  it("breaks largest-rung ties toward the longest maturity", () => {
    const merged = consolidateSovereignTranches(
      [
        { maturityTurns: 48, amount: 100 * BOND_UNIT_FACE_VALUE },
        { maturityTurns: 96, amount: 2000 * BOND_UNIT_FACE_VALUE },
        { maturityTurns: 240, amount: 2000 * BOND_UNIT_FACE_VALUE },
      ],
      SOVEREIGN_MIN_TRANCHE_UNITS
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.maturityTurns).toBe(240);
    expect(merged[0]!.amount).toBe(4100 * BOND_UNIT_FACE_VALUE);
  });
});
