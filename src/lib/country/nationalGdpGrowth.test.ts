import { describe, expect, it, vi } from "vitest";
import { loadNationalGdpGrowth } from "./nationalGdpGrowth";

function fakeDb(doc: unknown) {
  return { collection: () => ({ findOne: vi.fn().mockResolvedValue(doc) }) } as never;
}

describe("loadNationalGdpGrowth", () => {
  it("returns the national doc's value", async () => {
    const doc = { economic: { gdpGrowth: { value: 4.068 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "US", 1959)).resolves.toBe(4.068);
  });

  it("returns a genuine negative rate rather than treating it as absent", async () => {
    // CN reads -5.382 live. A `??` chain would keep it, but a truthiness check
    // would not, and 0 is likewise a real rate.
    const doc = { economic: { gdpGrowth: { value: -5.382 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "CN", 1959)).resolves.toBe(-5.382);
  });

  it("returns a zero rate as zero, not as a fallback", async () => {
    const doc = { economic: { gdpGrowth: { value: 0 } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "JP", 1959)).resolves.toBe(0);
  });

  it("falls back to the era trend for a country with no national doc", async () => {
    // FR is not in NATIONAL_SCOPE, so no lookup happens and the authored 1953-era
    // trend stands in. This is the same fallback interestRateSnapshot.ts uses, and
    // it is the leg the budget path got wrong with a flat 2.5.
    await expect(loadNationalGdpGrowth(fakeDb(null), "FR", 1959)).resolves.toBe(4.5);
    await expect(loadNationalGdpGrowth(fakeDb(null), "PL", 1959)).resolves.toBe(4);
  });

  it("returns null when there is neither a stored value nor an era trend", async () => {
    // The two sets are complementary by design: countries carrying a national doc
    // (US, UK) have no era trend authored, so an empty doc has nothing to fall
    // back to and the caller must handle null rather than see an invented rate.
    await expect(loadNationalGdpGrowth(fakeDb({}), "US", 1959)).resolves.toBeNull();
  });

  it("ignores a non-finite stored value and falls through", async () => {
    const doc = { economic: { gdpGrowth: { value: Number.NaN } } };
    await expect(loadNationalGdpGrowth(fakeDb(doc), "US", 1959)).resolves.toBeNull();
  });
});
