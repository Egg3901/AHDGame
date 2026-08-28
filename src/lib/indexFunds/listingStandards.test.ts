import { describe, it, expect } from "vitest";
import {
  applyListingRetention,
  LISTING_GRACE_TURNS,
  MIN_FREE_FLOAT_RATIO,
  MIN_RELATIVE_SIZE,
  applyListingStandards,
  isMateriallyInsolvent,
  describeFailure,
  medianMarketCap,
  shouldDropConstituent,
  type ListingCandidate,
  type ListingVerdict,
} from "./listingStandards";

const candidate = (
  over: Partial<ListingCandidate> & { corporationId: string }
): ListingCandidate => ({
  marketCapAnchor: 1_000_000,
  freeFloatRatio: 0.5,
  insolvent: false,
  ...over,
});

describe("medianMarketCap", () => {
  it("takes the middle of an odd pool", () => {
    expect(
      medianMarketCap([
        candidate({ corporationId: "a", marketCapAnchor: 100 }),
        candidate({ corporationId: "b", marketCapAnchor: 300 }),
        candidate({ corporationId: "c", marketCapAnchor: 200 }),
      ])
    ).toBe(200);
  });

  it("averages the middle two of an even pool", () => {
    expect(
      medianMarketCap([
        candidate({ corporationId: "a", marketCapAnchor: 100 }),
        candidate({ corporationId: "b", marketCapAnchor: 300 }),
      ])
    ).toBe(200);
  });

  it("ignores malformed and non-positive caps", () => {
    expect(
      medianMarketCap([
        candidate({ corporationId: "a", marketCapAnchor: 200 }),
        candidate({ corporationId: "b", marketCapAnchor: Number.NaN }),
        candidate({ corporationId: "c", marketCapAnchor: 0 }),
      ])
    ).toBe(200);
  });

  it("is zero for an empty pool", () => {
    expect(medianMarketCap([])).toBe(0);
  });
});

describe("applyListingStandards", () => {
  const pool = () => [
    candidate({ corporationId: "big", marketCapAnchor: 10_000_000 }),
    candidate({ corporationId: "mid", marketCapAnchor: 1_000_000 }),
    candidate({ corporationId: "small", marketCapAnchor: 1_000 }),
  ];

  it("passes an ordinary corporation", () => {
    const verdicts = applyListingStandards(pool());
    expect(verdicts.find((v) => v.corporationId === "mid")!.qualifies).toBe(true);
  });

  it("excludes a corporation that is a rounding error next to its peers", () => {
    // Median is 1,000,000; the floor is 5% of that. `small` is 1,000.
    const verdict = applyListingStandards(pool()).find((v) => v.corporationId === "small")!;
    expect(verdict.qualifies).toBe(false);
    expect(verdict.failures).toContain("size");
  });

  it("measures size against the WHOLE pool, not the survivors", () => {
    // Computing the median over survivors would be circular: drop the small
    // half, the median rises, more fail, it rises again. A pool that is mostly
    // tiny must not have its bar dragged up by its own exclusions.
    const mostlyTiny = [
      candidate({ corporationId: "giant", marketCapAnchor: 100_000_000 }),
      ...Array.from({ length: 8 }, (_, i) =>
        candidate({ corporationId: `tiny-${i}`, marketCapAnchor: 1_000 })
      ),
    ];
    const verdicts = applyListingStandards(mostlyTiny);
    // Median is 1,000, so the floor is 50 — every tiny corp clears it.
    expect(verdicts.filter((v) => v.qualifies).length).toBe(9);
  });

  it("excludes a corporation with too little stock in public hands", () => {
    const verdict = applyListingStandards([
      candidate({ corporationId: "closely-held", freeFloatRatio: MIN_FREE_FLOAT_RATIO - 0.01 }),
      candidate({ corporationId: "other" }),
    ]).find((v) => v.corporationId === "closely-held")!;
    expect(verdict.failures).toContain("free_float");
  });

  it("admits a corporation sitting exactly on the free-float bar", () => {
    const verdict = applyListingStandards([
      candidate({ corporationId: "exactly", freeFloatRatio: MIN_FREE_FLOAT_RATIO }),
      candidate({ corporationId: "other" }),
    ]).find((v) => v.corporationId === "exactly")!;
    expect(verdict.failures).not.toContain("free_float");
  });

  it("excludes an insolvent corporation", () => {
    const verdict = applyListingStandards([
      candidate({ corporationId: "broke", insolvent: true }),
      candidate({ corporationId: "other" }),
    ]).find((v) => v.corporationId === "broke")!;
    expect(verdict.failures).toContain("insolvent");
  });

  it("reports every reason, not just the first", () => {
    const verdict = applyListingStandards([
      candidate({
        corporationId: "hopeless",
        marketCapAnchor: 1,
        freeFloatRatio: 0,
        insolvent: true,
      }),
      candidate({ corporationId: "other", marketCapAnchor: 10_000_000 }),
    ]).find((v) => v.corporationId === "hopeless")!;
    expect(verdict.failures).toEqual(["free_float", "size", "insolvent"]);
  });

  it("fails OPEN on a pool with no usable size data rather than emptying the index", () => {
    const verdicts = applyListingStandards([
      candidate({ corporationId: "a", marketCapAnchor: 0 }),
      candidate({ corporationId: "b", marketCapAnchor: 0 }),
    ]);
    for (const verdict of verdicts) expect(verdict.failures).not.toContain("size");
  });

  it("fails OPEN on unknown free float, so an index is never emptied by missing data", () => {
    // Plenty of corporations carry no recorded float. Reading absent as zero
    // would have excluded all of them on the first rebalance.
    const verdict = applyListingStandards([
      candidate({ corporationId: "unknown-float", freeFloatRatio: undefined }),
      candidate({ corporationId: "other" }),
    ]).find((v) => v.corporationId === "unknown-float")!;
    expect(verdict.qualifies).toBe(true);
  });

  it("treats a malformed free float as a failure, not as a pass", () => {
    const verdict = applyListingStandards([
      candidate({ corporationId: "broken", freeFloatRatio: Number.NaN }),
      candidate({ corporationId: "other" }),
    ]).find((v) => v.corporationId === "broken")!;
    expect(verdict.failures).toContain("free_float");
  });

  it("uses a relative floor, so the bar means the same thing in any era", () => {
    // The same shape of pool, scaled down a thousandfold, produces the same
    // verdicts. No per-era constant to maintain.
    const modern = applyListingStandards(pool());
    const era1953 = applyListingStandards(
      pool().map((c) => ({ ...c, marketCapAnchor: c.marketCapAnchor / 1_000 }))
    );
    expect(era1953.map((v) => v.qualifies)).toEqual(modern.map((v) => v.qualifies));
    expect(MIN_RELATIVE_SIZE).toBeGreaterThan(0);
  });
});

describe("shouldDropConstituent", () => {
  it("does not drop an incumbent on a single bad observation", () => {
    // Otherwise price noise around the bar churns the same position in and out
    // every turn, and the fund's holders pay spread both ways for the
    // volatility of the threshold rather than of the business.
    for (let n = 1; n < LISTING_GRACE_TURNS; n++) {
      expect(shouldDropConstituent(n)).toBe(false);
    }
  });

  it("drops once the failures are sustained", () => {
    expect(shouldDropConstituent(LISTING_GRACE_TURNS)).toBe(true);
  });
});

describe("describeFailure", () => {
  it("explains every failure without falling through", () => {
    for (const failure of ["free_float", "size", "insolvent"] as const) {
      expect(describeFailure(failure).length).toBeGreaterThan(0);
    }
  });
});

describe("applyListingRetention", () => {
  const failing = (id: string): ListingVerdict => ({
    corporationId: id,
    qualifies: false,
    failures: ["size"],
    worstShortfallRatio: 0.8,
  });
  const passing = (id: string): ListingVerdict => ({
    corporationId: id,
    qualifies: true,
    failures: [],
    worstShortfallRatio: null,
  });

  it("keeps a failing incumbent inside the grace period", () => {
    const result = applyListingRetention({
      verdicts: [failing("a")],
      incumbentIds: new Set(["a"]),
      priorStreaks: new Map(),
    });
    expect(result.qualifiedIds.has("a")).toBe(true);
    expect(result.droppedIds).toEqual([]);
    expect(result.streaks).toEqual([
      { corporationId: "a", consecutiveFailures: 1, failures: ["size"] },
    ]);
  });

  it("drops an incumbent on the observation that exhausts grace", () => {
    const result = applyListingRetention({
      verdicts: [failing("a")],
      incumbentIds: new Set(["a"]),
      priorStreaks: new Map([["a", LISTING_GRACE_TURNS - 1]]),
    });
    expect(result.droppedIds).toEqual(["a"]);
    expect(result.qualifiedIds.has("a")).toBe(false);
  });

  it("holds an APPLICANT to the bar immediately, with no grace at all", () => {
    // Grace protects incumbents from noise. It is not three free turns inside
    // the index for a corporation that never qualified.
    const result = applyListingRetention({
      verdicts: [failing("a")],
      incumbentIds: new Set(),
      priorStreaks: new Map(),
    });
    expect(result.qualifiedIds.has("a")).toBe(false);
    expect(result.droppedIds).toEqual([]);
  });

  it("resets the streak on a single passing turn", () => {
    const result = applyListingRetention({
      verdicts: [passing("a")],
      incumbentIds: new Set(["a"]),
      priorStreaks: new Map([["a", LISTING_GRACE_TURNS - 1]]),
    });
    expect(result.qualifiedIds.has("a")).toBe(true);
    // Not carried at all, so the next failure starts from one.
    expect(result.streaks).toEqual([]);
  });

  it("does not let a near-miss streak carry over to an unrelated corporation", () => {
    const result = applyListingRetention({
      verdicts: [failing("a"), passing("b")],
      incumbentIds: new Set(["a", "b"]),
      priorStreaks: new Map([["a", 1]]),
    });
    expect(result.streaks).toEqual([
      { corporationId: "a", consecutiveFailures: 2, failures: ["size"] },
    ]);
  });
});

describe("isMateriallyInsolvent", () => {
  it("does not flag a rounding-error negative against a large market cap", () => {
    // The Atlas case: -$2,657 against a $7.5M cap clears from one turn of revenue.
    expect(isMateriallyInsolvent(-2657, 7_500_000)).toBe(false);
  });
  it("flags a material negative (beyond 1% of market cap)", () => {
    expect(isMateriallyInsolvent(-100_000, 7_500_000)).toBe(true);
  });
  it("treats a positive or zero balance as solvent", () => {
    expect(isMateriallyInsolvent(0, 7_500_000)).toBe(false);
    expect(isMateriallyInsolvent(5, 7_500_000)).toBe(false);
  });
  it("treats negative cash with no market value as insolvent", () => {
    expect(isMateriallyInsolvent(-1, 0)).toBe(true);
    expect(isMateriallyInsolvent(-1, undefined)).toBe(true);
  });
});
