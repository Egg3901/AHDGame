import { describe, it, expect } from "vitest";
import { resolveInfraEnvelope } from "./infraEnvelope";
import {
  INFRA_DISCRETIONARY_FRACTION,
  INFRA_DISCRETIONARY_BASELINE,
  INFRA_DISCRETIONARY_CAP,
  INFRA_UPKEEP_UNIT,
} from "@/lib/constants/cabinetInfra";

function fakeDb(budget: unknown) {
  return { collection: () => ({ findOne: async () => budget }) } as never;
}
const baselineAbs = INFRA_DISCRETIONARY_BASELINE * INFRA_UPKEEP_UNIT;
const capAbs = INFRA_DISCRETIONARY_CAP * INFRA_UPKEEP_UNIT;

describe("resolveInfraEnvelope", () => {
  it("returns the slice (transportation preferred) when it falls inside the band", async () => {
    const approp = 350_000_000_000; // slice = 4,200M ∈ (baseline 3,000M, cap 5,000M)
    expect(
      await resolveInfraEnvelope(
        fakeDb({ spending: { byCategory: { transportation: approp } } }),
        "US"
      )
    ).toBeCloseTo(approp * INFRA_DISCRETIONARY_FRACTION, 5);
  });

  it("caps a huge (large-currency) budget at the cap", async () => {
    expect(
      await resolveInfraEnvelope(
        fakeDb({ spending: { byCategory: { transportation: 5_000_000_000_000 } } }),
        "JP"
      )
    ).toBe(capAbs);
  });

  it("floors at the baseline allowance for a small budget", async () => {
    expect(
      await resolveInfraEnvelope(
        fakeDb({ spending: { byCategory: { transportation: 10_000_000_000 } } }),
        "US"
      )
    ).toBe(baselineAbs);
  });

  it("floors at the baseline when only a tiny gdp fallback applies", async () => {
    expect(await resolveInfraEnvelope(fakeDb({ gdp: 1_000_000 }), "US")).toBe(baselineAbs);
  });

  it("returns 0 when there is no budget at all", async () => {
    expect(await resolveInfraEnvelope(fakeDb(null), "US")).toBe(0);
  });

  // DE's actual budgetCategory for its rail/reconstruction laws is "transport"
  // (deLegislationTypes.ts: de_rail_transport, de_digital_infrastructure), not
  // "transportation"/"infrastructure" — the 1953 baseline was renamed
  // "infrastructure" → "transport" to match it (fiscal-scale audit,
  // 2026-07-28). Without this fallback, DE's envelope would silently drop to
  // the bare GDP fallback once "infrastructure" stopped being an authored key.
  it("falls back to 'transport' (DE's actual category) when transportation/infrastructure are absent", async () => {
    const approp = 350_000_000_000;
    expect(
      await resolveInfraEnvelope(fakeDb({ spending: { byCategory: { transport: approp } } }), "DE")
    ).toBeCloseTo(approp * INFRA_DISCRETIONARY_FRACTION, 5);
  });

  it("prefers enacted 'transportation'/'infrastructure' over 'transport' when both are present", async () => {
    const approp = 350_000_000_000;
    expect(
      await resolveInfraEnvelope(
        fakeDb({ spending: { byCategory: { infrastructure: approp, transport: 1 } } }),
        "DE"
      )
    ).toBeCloseTo(approp * INFRA_DISCRETIONARY_FRACTION, 5);
  });

  it("falls back to baselineSpendingByCategory.transport when no law is enacted yet", async () => {
    const approp = 350_000_000_000;
    expect(
      await resolveInfraEnvelope(
        fakeDb({ baselineSpendingByCategory: { transport: approp } }),
        "DE"
      )
    ).toBeCloseTo(approp * INFRA_DISCRETIONARY_FRACTION, 5);
  });
});
