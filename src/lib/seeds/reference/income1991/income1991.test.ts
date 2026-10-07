import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { getStartingIncomeAnchor } from "@/lib/era/metricCatalog";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";
import { ngStateBaselines } from "@/lib/seeds/ng/ngStateBaselines";
import { cnStateBaselines } from "@/lib/seeds/cn/cnStateBaselines";
import { trStateBaselines } from "@/lib/seeds/tr/trStateBaselines";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { trStateMetrics } from "@/lib/seeds/tr/trStateMetrics";
import { applyEra1991BaselineAdjustments } from "@/lib/seeds/reference/stateBaselines1991";
import { NG_1991_NOMINAL_GDP_NGN } from "@/lib/countries/ng/data/ngGdp1991";
import {
  INCOME_1991_REGIONAL,
  apply1991IncomeVintageBaseline,
  gdpPerResident1991,
  nationalHouseholdMedian1991,
  type Income1991CountryId,
} from "./index";
import { nationalHouseholdMedianFromGdp, scaleRegionalIncomes } from "./rules";

// The #3393 countries have their own suite (income1991.westEurope.test.ts).
type Fixed = Extract<Income1991CountryId, "NG" | "CN" | "TR">;
const FIXED: Fixed[] = ["NG", "CN", "TR"];
// The 23 countries in the 1991 opening.
const LIVE_1991: CountryId[] = [
  "AT",
  "BG",
  "BR",
  "CN",
  "CS",
  "DE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "JP",
  "NG",
  "PL",
  "RO",
  "RU",
  "SE",
  "TR",
  "UK",
  "US",
  "YU",
] as CountryId[];
const BASE = { NG: ngStateMetrics, CN: cnStateMetrics, TR: trStateMetrics };
const BASELINES = { NG: ngStateBaselines, CN: cnStateBaselines, TR: trStateBaselines };

describe("income1991 rules", () => {
  it("rejects out-of-bounds proxies", () => {
    expect(() =>
      nationalHouseholdMedianFromGdp(1000, {
        householdSize: 5,
        householdIncomeShare: 0.65,
        medianToMean: 1.2,
      })
    ).toThrow();
  });

  it("hits the national target and preserves regional ratios", () => {
    const out = scaleRegionalIncomes(
      [
        { id: "a", population: 1, baseIncome: 100 },
        { id: "b", population: 3, baseIncome: 300 },
      ],
      500
    );
    expect((out.a + 3 * out.b) / 4).toBeCloseTo(500, 0);
    expect(out.b / out.a).toBeCloseTo(3, 2);
  });
});

describe("1991 income vintages (#3370 #3371 #3376)", () => {
  it("uses the same naira basis as the WDI-sourced 1991 GDP", () => {
    expect(gdpPerResident1991("NG")).toBeCloseTo(NG_1991_NOMINAL_GDP_NGN / 88_992_220, 2);
  });

  for (const c of FIXED) {
    describe(c, () => {
      const seeded = loadSeededStateMetrics(c, "1991-default");
      const popWeighted = () => {
        // regional table carries the pop-weighted target by construction
        return nationalHouseholdMedian1991(c);
      };

      it("seeded regional income equals the vintage table", () => {
        for (const m of seeded) {
          expect(m.economic.medianIncome?.value).toBe(INCOME_1991_REGIONAL[c][String(m._id)]);
        }
        expect(seeded.length).toBe(Object.keys(INCOME_1991_REGIONAL[c]).length);
      });

      it("sits in a bounded household-vs-per-person band, not a fixed ratio", () => {
        const ratio = popWeighted() / gdpPerResident1991(c);
        expect(ratio).toBeGreaterThan(1);
        expect(ratio).toBeLessThan(4);
      });

      it("preserves the authored regional ordering and ratios", () => {
        const base = new Map(
          BASE[c].map((m) => [String(m._id), m.economic.medianIncome!.value] as const)
        );
        const ids = [...base.keys()];
        const [a, b] = [ids[0], ids[ids.length - 1]];
        expect(INCOME_1991_REGIONAL[c][a] / INCOME_1991_REGIONAL[c][b]).toBeCloseTo(
          base.get(a)! / base.get(b)!,
          2
        );
      });

      it("baseline matches the seeded metric, so turn one has no income pressure", () => {
        for (const raw of BASELINES[c]) {
          const adjusted = c === "TR" ? raw : applyEra1991BaselineAdjustments(raw);
          const b = apply1991IncomeVintageBaseline(c, adjusted);
          const metric = seeded.find((m) => String(m._id) === String(raw._id));
          expect(
            (b.baselines as Record<string, Record<string, number>>).economic.medianIncome
          ).toBe(metric!.economic.medianIncome!.value);
        }
      });
    });
  }

  it("start-year income anchors for NG, CN and TR use the derived 1991 level", () => {
    for (const c of FIXED) {
      expect(getStartingIncomeAnchor(c, 1991)).toBe(Math.round(nationalHouseholdMedian1991(c)));
    }
  });

  it("leaves every other country's 1991 income untouched (23-country coverage)", () => {
    expect(LIVE_1991).toHaveLength(23);
    // AT/ES/FI/FR/GR/IT/SE carry vintages too (#3393, income1991.westEurope.test.ts).
    const vintaged: string[] = [...FIXED, "AT", "ES", "FI", "FR", "GR", "IT", "SE"];
    expect(Object.keys(INCOME_1991_REGIONAL).sort()).toEqual([...vintaged].sort());
    for (const c of LIVE_1991) {
      if (vintaged.includes(c)) continue;
      const after = loadSeededStateMetrics(c, "1991-default");
      for (const m of after) {
        expect(INCOME_1991_REGIONAL[c as Income1991CountryId]).toBeUndefined();
        expect(m.economic?.medianIncome?.value ?? 0).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
