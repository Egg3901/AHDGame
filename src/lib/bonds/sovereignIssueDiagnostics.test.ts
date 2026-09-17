import { describe, expect, it } from "vitest";
import type { Bond } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  classifySovereignDemandGap,
  consolidateSovereignTranches,
  planSovereignTranches,
  SOVEREIGN_MIN_TRANCHE_UNITS,
  summarizeSovereignDemandGapsByCountry,
  summarizeSovereignIssuanceByCountry,
  summarizeSovereignIssue,
} from "./sovereignIssueDiagnostics";
import type { SovereignDemandGapFund, SovereignDemandGapFx } from "./sovereignIssueDiagnostics";
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
      bond({ countryId: "US", issuerType: "corporation", holders: [], publicFloat: 700 }),
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

describe("classifySovereignDemandGap", () => {
  const fx: SovereignDemandGapFx = {
    tradableCurrencies: ["USD", "GBP", "CNY"],
    controlledCurrencies: [],
  };
  const noRatings = new Map<string, string | undefined>();

  function gapFund(overrides: Partial<SovereignDemandGapFund> = {}): SovereignDemandGapFund {
    return {
      key: "us_top_25",
      homeCountryId: "US",
      scope: "country",
      kind: "broad",
      active: true,
      deployableCashAnchor: 1_000_000_000,
      cashAboveBufferAnchor: 1_000_000_000,
      ...overrides,
    };
  }

  function issue(
    overrides: {
      countryId?: string | null;
      currencyCode?: string | null;
      totalIssued?: number;
      publicFloat?: number;
      heldUnitsByFundKey?: Map<string, number>;
    } = {}
  ) {
    return {
      countryId: overrides.countryId ?? "US",
      currencyCode: overrides.currencyCode ?? "USD",
      totalIssued: overrides.totalIssued ?? 2_000 * BOND_UNIT_FACE_VALUE,
      publicFloat: overrides.publicFloat ?? 500,
      heldUnitsByFundKey: overrides.heldUnitsByFundKey,
    };
  }

  it("reports no_float when nothing is left in public float", () => {
    expect(
      classifySovereignDemandGap(issue({ publicFloat: 0 }), [gapFund()], fx, noRatings, false)
    ).toBe("no_float");
  });

  it("reports no_domestic_fund for a country with no homed fund and no foreign channel", () => {
    // The only fund is a US country fund: it never buys foreign paper, and no
    // global fund exists to be blocked, so the honest reason is coverage.
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "FR", currencyCode: "EUR" }),
        [gapFund()],
        fx,
        noRatings,
        false
      )
    ).toBe("no_domestic_fund");
  });

  it("reports cross_border_disabled when opening the flag alone would reach the issue", () => {
    const globalEquity = gapFund({
      key: "global_sector_energy",
      homeCountryId: "US",
      scope: "global",
      kind: "sector",
    });
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "FR", currencyCode: "EUR" }),
        [globalEquity],
        { tradableCurrencies: ["USD", "EUR"], controlledCurrencies: [] },
        noRatings,
        false
      )
    ).toBe("cross_border_disabled");
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "FR", currencyCode: "EUR" }),
        [globalEquity],
        { tradableCurrencies: ["USD", "EUR"], controlledCurrencies: [] },
        noRatings,
        true
      )
    ).toBe("awaiting_demand");
  });

  it("reports capital_controls when a waiting global bond fund is locked out by controls", () => {
    const globalGov = gapFund({
      key: "global_sovereign_ig",
      homeCountryId: "US",
      scope: "global",
      kind: "bond",
      bondUniverse: { issuerType: "sovereign", minRating: "BBB" },
    });
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "CN", currencyCode: "CNY" }),
        [globalGov],
        { tradableCurrencies: ["USD", "CNY"], controlledCurrencies: ["CNY"] },
        new Map([["CN", "A"]]),
        false
      )
    ).toBe("capital_controls");
  });

  it("reports currency_mismatch when no live rate lets a foreign fund price the issue", () => {
    const globalGov = gapFund({
      key: "global_sovereign_ig",
      homeCountryId: "US",
      scope: "global",
      kind: "bond",
      bondUniverse: { issuerType: "sovereign", minRating: "BBB" },
    });
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "XX", currencyCode: "XYZ" }),
        [globalGov],
        { tradableCurrencies: ["USD"], controlledCurrencies: [] },
        noRatings,
        false
      )
    ).toBe("currency_mismatch");
  });

  it("reports ineligible when homed funds hold only a corporate mandate", () => {
    const corpBondFund = gapFund({
      key: "us_corporate_ig",
      kind: "bond",
      bondUniverse: { issuerType: "corporation", minRating: "BBB" },
    });
    expect(classifySovereignDemandGap(issue(), [corpBondFund], fx, noRatings, false)).toBe(
      "ineligible"
    );
  });

  it("reports ineligible when the rating band excludes the issuer", () => {
    const pickyBondFund = gapFund({
      key: "us_sovereign_bonds",
      kind: "bond",
      bondUniverse: { issuerType: "sovereign", homeOnly: true, minRating: "BBB" },
    });
    expect(
      classifySovereignDemandGap(issue(), [pickyBondFund], fx, new Map([["US", "B"]]), false)
    ).toBe("ineligible");
  });

  it("reports cash_buffer when candidate funds keep only the 5% buffer", () => {
    const broke = gapFund({ deployableCashAnchor: 0, cashAboveBufferAnchor: 0 });
    expect(classifySovereignDemandGap(issue(), [broke], fx, noRatings, false)).toBe("cash_buffer");
  });

  it("reports reserve_target_met when funds hold cash above the buffer but want no more bonds", () => {
    const full = gapFund({ deployableCashAnchor: 0, cashAboveBufferAnchor: 500_000 });
    expect(classifySovereignDemandGap(issue(), [full], fx, noRatings, false)).toBe(
      "reserve_target_met"
    );
  });

  it("reports position_limit when every candidate fund is at the holder cap", () => {
    const capped = gapFund({ key: "us_top_25" });
    // 4 units issued: the 25% cap is 1 unit, already held.
    const cappedIssue = issue({
      totalIssued: 4 * BOND_UNIT_FACE_VALUE,
      publicFloat: 3,
      heldUnitsByFundKey: new Map([["us_top_25", 1]]),
    });
    expect(classifySovereignDemandGap(cappedIssue, [capped], fx, noRatings, false)).toBe(
      "position_limit"
    );
  });

  it("reports awaiting_demand when mandate, cash, cap, and float all allow a purchase", () => {
    expect(classifySovereignDemandGap(issue(), [gapFund()], fx, noRatings, false)).toBe(
      "awaiting_demand"
    );
  });

  it("ignores inactive funds when assigning coverage", () => {
    const paused = gapFund({ active: false });
    expect(
      classifySovereignDemandGap(
        issue({ countryId: "FR", currencyCode: "EUR" }),
        [paused],
        fx,
        noRatings,
        false
      )
    ).toBe("no_domestic_fund");
  });

  it("assigns the same reason regardless of fund order", () => {
    const funds = [
      gapFund({ key: "b", homeCountryId: "UK", scope: "country" }),
      gapFund({ key: "a", homeCountryId: "US", scope: "country" }),
    ];
    const usIssue = issue();
    const forward = classifySovereignDemandGap(usIssue, funds, fx, noRatings, false);
    const reversed = classifySovereignDemandGap(
      usIssue,
      [...funds].reverse(),
      fx,
      noRatings,
      false
    );
    expect(forward).toBe("awaiting_demand");
    expect(reversed).toBe(forward);
  });
});

describe("summarizeSovereignDemandGapsByCountry", () => {
  it("counts unheld issues by reason, skipping held ones, in country order", () => {
    expect(
      summarizeSovereignDemandGapsByCountry([
        { countryId: "US", holderCount: 0, gap: "no_domestic_fund" },
        { countryId: "US", holderCount: 0, gap: "cash_buffer" },
        { countryId: "US", holderCount: 2, gap: "awaiting_demand" },
        { countryId: "FR", holderCount: 0, gap: "no_domestic_fund" },
      ])
    ).toEqual([
      { countryId: "FR", unheldIssueCount: 1, byReason: { no_domestic_fund: 1 } },
      {
        countryId: "US",
        unheldIssueCount: 2,
        byReason: { cash_buffer: 1, no_domestic_fund: 1 },
      },
    ]);
  });
});

describe("summarizeSovereignIssuanceByCountry demand gaps", () => {
  it("attaches per-reason counts that sum to the unheld count", () => {
    const rows = summarizeSovereignIssuanceByCountry(
      [
        bond({ countryId: "US", holders: [], publicFloat: 500 }),
        bond({ countryId: "US", holders: [holder(10)], publicFloat: 10 }),
      ],
      () => "no_domestic_fund"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unheldIssueCount).toBe(1);
    expect(rows[0]!.demandGapByReason).toEqual({ no_domestic_fund: 1 });
  });

  it("leaves demandGapByReason absent without a classifier", () => {
    const rows = summarizeSovereignIssuanceByCountry([
      bond({ countryId: "US", holders: [], publicFloat: 500 }),
    ]);
    expect(rows[0]!.unheldIssueCount).toBe(1);
    expect(rows[0]!.demandGapByReason).toBeUndefined();
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
