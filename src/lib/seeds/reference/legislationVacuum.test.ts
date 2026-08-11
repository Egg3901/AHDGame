import { describe, expect, it } from "vitest";
import { generateDefaultEnactedLaws } from "./budgets";
import { getBasePolicies } from "./basePolicies";
import { LEGISLATION_ERA } from "@/lib/era/legislationCatalog";

describe("policy-vacuum seeding — national enacted laws (budgets.ts)", () => {
  it("a 1991 preset seeds no law whose type window postdates 1991", () => {
    const laws = generateDefaultEnactedLaws("1991-default");
    for (const law of laws) {
      const from = LEGISLATION_ERA[law.legislationTypeId];
      if (typeof from !== "number") continue; // always-type
      // enactedYear is the config fiscalYear; the law must not predate its window.
      expect(from, `${law.legislationTypeId} seeded at ${law.enactedYear}`).toBeLessThanOrEqual(
        law.enactedYear as number
      );
    }
  });

  it("a 2019 preset still seeds broadly but drops post-2019 windows (cn_common_prosperity 2021)", () => {
    const laws2019 = generateDefaultEnactedLaws("2019-default");
    expect(laws2019.length).toBeGreaterThan(0);
    expect(laws2019.some((l) => l.legislationTypeId === "cn_common_prosperity")).toBe(false);
  });
});

describe("policy-vacuum seeding — default policies (basePolicies.ts)", () => {
  it("a 1991 preset seeds no base policy whose type window postdates 1991", async () => {
    const records = await getBasePolicies("1991-default");
    for (const r of records) {
      const from = LEGISLATION_ERA[r.legislationTypeId];
      if (typeof from !== "number") continue;
      expect(from, `${r.legislationTypeId} (${r.scope})`).toBeLessThanOrEqual(1991);
    }
  });

  it("drops the CN post-2013 windowed types at 1991 (belt&road/cyber/AI/common-prosperity)", async () => {
    const records = await getBasePolicies("1991-default");
    const ids = new Set(records.map((r) => r.legislationTypeId));
    expect(ids.has("cn_belt_and_road")).toBe(false);
    expect(ids.has("cn_common_prosperity")).toBe(false);
    // A pre-1991 CN windowed type IS present (hukou 1958, gaokao 1977).
    expect(ids.has("cn_gaokao_reform")).toBe(true);
  });

  it("2019-default drops cn_common_prosperity (windowed 2021) from base policies", async () => {
    const ids2019 = new Set(
      (await getBasePolicies("2019-default")).map((r) => r.legislationTypeId)
    );
    expect(ids2019.has("cn_common_prosperity")).toBe(false);
    // A pre-2019 CN windowed type is still present (gaokao 1977).
    expect(ids2019.has("cn_gaokao_reform")).toBe(true);
  });
});
