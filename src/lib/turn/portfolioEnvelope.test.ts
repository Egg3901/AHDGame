import { describe, it, expect } from "vitest";
import { resolvePortfolioEnvelope } from "./portfolioEnvelope";
import {
  ESTATE_DISCRETIONARY_FRACTION,
  ESTATE_DISC_FLOOR,
  ESTATE_DISC_CAP,
  ESTATE_UPKEEP_UNIT,
} from "@/lib/constants/cabinetEstates";

function fakeDb(budget: unknown) {
  return { collection: () => ({ findOne: async () => budget }) } as never;
}
const floorAbs = ESTATE_DISC_FLOOR * ESTATE_UPKEEP_UNIT;
const capAbs = ESTATE_DISC_CAP * ESTATE_UPKEEP_UNIT;

describe("resolvePortfolioEnvelope", () => {
  it("returns the sliced category appropriation when it falls inside the band", async () => {
    // pick an appropriation whose slice lands between floor and cap
    const approp = (floorAbs / ESTATE_DISCRETIONARY_FRACTION) * 1.1;
    const db = fakeDb({ spending: { byCategory: { education: approp } }, gdp: 100_000_000_000 });
    expect(await resolvePortfolioEnvelope(db, "US", "education")).toBeCloseTo(
      approp * ESTATE_DISCRETIONARY_FRACTION,
      5
    );
  });

  it("caps a huge department at the band cap", async () => {
    const db = fakeDb({ spending: { byCategory: { education: 10_000_000_000_000 } } });
    expect(await resolvePortfolioEnvelope(db, "US", "education")).toBe(capAbs);
  });

  it("floors a tiny department (and an unmapped portfolio) at the band floor", async () => {
    expect(
      await resolvePortfolioEnvelope(
        fakeDb({ spending: { byCategory: { education: 1_000_000 } } }),
        "US",
        "education"
      )
    ).toBe(floorAbs);
    // foreign is unmapped → gdp fallback; a small gdp slice floors at the band floor
    expect(await resolvePortfolioEnvelope(fakeDb({ gdp: 1_000_000_000 }), "US", "foreign")).toBe(
      floorAbs
    );
  });

  it("returns 0 when there is no budget at all", async () => {
    expect(await resolvePortfolioEnvelope(fakeDb(null), "US", "education")).toBe(0);
  });

  // BR/CN/DE/IE/JP/UK key their health line `health`, not the canonical
  // `healthcare` — without the alias chain those six silently fell through to the
  // gdp fraction while only the US resolved a real appropriation.
  it("resolves an aliased spending key when the canonical one is absent", async () => {
    const approp = (floorAbs / ESTATE_DISCRETIONARY_FRACTION) * 1.1;
    const db = fakeDb({ spending: { byCategory: { health: approp } }, gdp: 1_000_000_000 });
    expect(await resolvePortfolioEnvelope(db, "UK", "health")).toBeCloseTo(
      approp * ESTATE_DISCRETIONARY_FRACTION,
      5
    );
  });

  it("prefers the canonical key over its alias", async () => {
    const canonical = (floorAbs / ESTATE_DISCRETIONARY_FRACTION) * 1.1;
    const db = fakeDb({
      spending: { byCategory: { healthcare: canonical, health: canonical * 2 } },
    });
    expect(await resolvePortfolioEnvelope(db, "US", "health")).toBeCloseTo(
      canonical * ESTATE_DISCRETIONARY_FRACTION,
      5
    );
  });

  it("falls back to the alias baseline before the gdp fraction", async () => {
    const approp = (floorAbs / ESTATE_DISCRETIONARY_FRACTION) * 1.1;
    const db = fakeDb({ baselineSpendingByCategory: { health: approp }, gdp: 1_000_000_000 });
    expect(await resolvePortfolioEnvelope(db, "UK", "health")).toBeCloseTo(
      approp * ESTATE_DISCRETIONARY_FRACTION,
      5
    );
  });
});
