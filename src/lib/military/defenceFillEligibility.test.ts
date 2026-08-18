import { describe, expect, it } from "vitest";
import { canSupply, resolveFillEligibility, deliveredGrade } from "./defenceFillEligibility";
import { DEFENCE_FACTORY_SLOTS_PER_PLANT } from "./defenceLotEconomics";
import { rawLotsFromSector } from "./arsenal";

/**
 * The regression suite for the ticket cluster this resolver exists to close.
 *
 * Every one of #1076 / #1083 / #1087 / #1099 / #1108 / #1127 has the same shape: the award
 * picker, the award route and the delivery sweep each carried their own version of "can this
 * plant fill this order", and they disagreed, so a minister could award a contract that then
 * never delivered a lot. These tests pin the ONE resolver all three now call - the invariant is
 * AWARDABLE MEANS DELIVERABLE, and it only holds while there is exactly one function.
 */

const plant = (over: Record<string, unknown> = {}) => ({
  strategyId: "heavy_armor",
  revenue: 10_000_000,
  ...over,
});
const company = (over: Record<string, unknown> = {}) =>
  ({ countryId: "US", liquidCurrencyCode: "USD", unlockedTechNodeIds: [], ...over }) as never;

describe("canSupply", () => {
  it("accepts a domestic corp whose currency matches its country", () => {
    expect(canSupply({ countryId: "US", liquidCurrencyCode: "USD" }, "US")).toBe(true);
  });

  it("refuses a foreign corp", () => {
    expect(canSupply({ countryId: "UK", liquidCurrencyCode: "GBP" }, "US")).toBe(false);
  });

  // Ticket #1087. A missing `liquidCurrencyCode` was read as USD, which hid every non-US
  // domestic plant - including Soviet state industry - from the award picker entirely.
  it("infers a missing currency from the corp's country rather than assuming USD", () => {
    expect(canSupply({ countryId: "UK" }, "UK")).toBe(true);
    expect(canSupply({ countryId: "RU" }, "RU")).toBe(true);
    expect(canSupply({ countryId: "US" }, "US")).toBe(true);
  });

  it("still refuses an explicit currency that does not match the buyer", () => {
    expect(canSupply({ countryId: "RU", liquidCurrencyCode: "USD" }, "RU")).toBe(false);
  });
});

describe("resolveFillEligibility", () => {
  const base = { countryId: "US", currentYear: 1953 };

  it("accepts a domestic plant on a materiel line", () => {
    const r = resolveFillEligibility({ ...base, corp: company(), sector: plant() });
    expect(r.eligible).toBe(true);
    expect(r.components).toEqual(["ground"]);
    expect(r.projectedLotsPerTurn).toBeGreaterThan(0);
  });

  // #1087 again, from the other end: a state-owned Soviet plant paid in roubles is a
  // FIRST-CLASS supplier, not an exception the picker has to special-case. State ownership
  // changes only who clicks Accept.
  it("accepts a non-USD state-owned supplier on exactly the same terms", () => {
    const r = resolveFillEligibility({
      countryId: "RU",
      currentYear: 1953,
      corp: company({
        countryId: "RU",
        liquidCurrencyCode: undefined,
        ownershipState: "stateOwned",
      }),
      sector: plant(),
    });
    expect(r.eligible).toBe(true);
  });

  it("refuses a foreign supplier and says which rule it broke", () => {
    const r = resolveFillEligibility({
      ...base,
      corp: company({ countryId: "UK", liquidCurrencyCode: "GBP" }),
      sector: plant(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("foreign_supplier");
  });

  it("refuses a domestic supplier banking in the wrong currency", () => {
    const r = resolveFillEligibility({
      ...base,
      corp: company({ liquidCurrencyCode: "GBP" }),
      sector: plant(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("currency_mismatch");
  });

  // `cyber` supplies electronics and software, not materiel. It has always been refused by the
  // route; the picker used to work it out separately.
  it("refuses a line that builds no materiel", () => {
    const r = resolveFillEligibility({
      ...base,
      corp: company(),
      sector: plant({ strategyId: "cyber" }),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("no_materiel_line");
  });

  // The frozen-component rule. A CEO who re-tools mid-contract makes the order undeliverable
  // rather than silently shipping tanks against an order for submarines.
  it("refuses a plant re-tooled off the component it was contracted for", () => {
    const r = resolveFillEligibility({
      ...base,
      corp: company(),
      sector: plant({ strategyId: "naval_systems" }),
      component: "ground",
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("retooled_off_component");
  });

  // Ticket #1099's sibling: a plant between production turns is a plant a minister may
  // legitimately contract. Refusing the award presents a dead button; the reason rides along
  // so both order books can warn instead.
  it("stays awardable but flags a plant producing nothing", () => {
    const r = resolveFillEligibility({ ...base, corp: company(), sector: plant({ revenue: 0 }) });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe("no_output");
    expect(r.projectedLotsPerTurn).toBe(0);
  });

  // Ticket #1108's shape: throughput must follow the lines a contract actually holds, or a
  // budget-scaled order and the plant behind it describe different rates of delivery.
  it("scales the projection with the lines assigned to the order", () => {
    const full = resolveFillEligibility({
      ...base,
      corp: company(),
      sector: plant(),
      assignedFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
    });
    const half = resolveFillEligibility({
      ...base,
      corp: company(),
      sector: plant(),
      assignedFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT / 2,
    });
    expect(half.projectedLotsPerTurn).toBeCloseTo(full.projectedLotsPerTurn / 2, 9);
  });

  // #1083: a plant serving two domains splits its output. The default allocation must keep
  // reproducing that split exactly, or every live two-domain contract changes rate on deploy.
  it("splits a two-domain plant's default projection between its domains", () => {
    const sector = plant({ strategyId: "standard" });
    const twoDomain = resolveFillEligibility({ ...base, corp: company(), sector });
    expect(twoDomain.components).toHaveLength(2);
    // Half the plant, because a contract is written against ONE of its two domains. Compared
    // against the plant's own output rather than another strategy's: the recipes differ, so a
    // cross-strategy comparison would pass or fail on the recipe, not on the split.
    expect(twoDomain.projectedLotsPerTurn).toBeCloseTo(rawLotsFromSector(sector) / 2, 6);
  });
});

describe("deliveredGrade", () => {
  // The era gate that stops a 1953 world fielding modern kit must beat both the corp's
  // research and the minister's order.
  it("takes the tightest ceiling of the three", () => {
    expect(deliveredGrade({ corpGradeCeiling: 3, contractGradeCeiling: 3, eraMaxGrade: 1 })).toBe(
      1
    );
    expect(deliveredGrade({ corpGradeCeiling: 1, contractGradeCeiling: 3, eraMaxGrade: 3 })).toBe(
      1
    );
    expect(deliveredGrade({ corpGradeCeiling: 3, contractGradeCeiling: 0, eraMaxGrade: 3 })).toBe(
      0
    );
  });

  it("treats an unset contract ceiling as whatever the supplier can build", () => {
    expect(deliveredGrade({ corpGradeCeiling: 2, eraMaxGrade: 3 })).toBe(2);
  });
});
