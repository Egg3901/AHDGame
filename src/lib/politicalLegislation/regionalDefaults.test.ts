import { describe, expect, it } from "vitest";
import { getCatalog } from "./catalog";
import { projectLawToLegislationType } from "./project";
import { LAW_COUNTRY_IDS } from "./types";
import { lawTargets } from "./dynamics";
import {
  REGIONAL_DEFAULT_LEVEL,
  regionalDefaultLaws,
  regionalDefaultLevel,
} from "./regionalDefaults";

describe("regionalDefaultLaws", () => {
  it("returns every non-tax `both` law of a country", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const expected = getCatalog(countryId)
        .filter((law) => law.kind !== "tax" && law.allowedScope === "both")
        .map((law) => law.id)
        .sort();
      expect(
        regionalDefaultLaws(countryId)
          .map((law) => law.id)
          .sort()
      ).toEqual(expected);
    }
  });

  it("excludes national-only laws and regional sidecars", () => {
    const dd = regionalDefaultLaws("DD");
    expect(dd.some((law) => law.allowedScope === "national")).toBe(false);
    // DD Land laws are `regional` — they already seed their own baseline.
    expect(dd.some((law) => law.id === "dd.sec.landPolytechnicEducation")).toBe(false);
  });

  it("filters by era window when a year is given", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const all = regionalDefaultLaws(countryId).map((law) => law.id);
      const at1953 = regionalDefaultLaws(countryId, 1953).map((law) => law.id);
      expect(new Set(all)).toEqual(
        new Set([...at1953, ...all.filter((id) => !at1953.includes(id))])
      );
      expect(at1953.every((id) => all.includes(id))).toBe(true);
    }
  });

  it("returns an empty list for a country with no new-generation catalog", () => {
    expect(regionalDefaultLaws("IE")).toEqual([]);
  });
});

describe("regionalDefaultLevel", () => {
  it("is 0 for every `both` law — a region starts with no program on top of the national one", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      for (const law of regionalDefaultLaws(countryId)) {
        expect(regionalDefaultLevel(law.id)).toBe(REGIONAL_DEFAULT_LEVEL);
      }
    }
    expect(REGIONAL_DEFAULT_LEVEL).toBe(0);
  });

  it("is undefined for national-only laws, tax laws, regional sidecars and unknown ids", () => {
    const nationalOnly = getCatalog("UK").find((law) => law.allowedScope === "national")!;
    expect(regionalDefaultLevel(nationalOnly.id)).toBeUndefined();

    const tax = getCatalog("RU").find((law) => law.kind === "tax")!;
    expect(regionalDefaultLevel(tax.id)).toBeUndefined();

    // Regional sidecars seed their OWN authored baseline; never override it with 0.
    expect(regionalDefaultLevel("dd.sec.landPolytechnicEducation")).toBeUndefined();

    expect(regionalDefaultLevel("us_state_transportation")).toBeUndefined();
    expect(regionalDefaultLevel("")).toBeUndefined();
  });
});

describe("regional default coverage — every state-proposable new-gen law has one", () => {
  /**
   * The bug this guards: `/api/game/legislation-types?scope=state` offers
   * `allowedScope` "state" and "both", but the baseline seeder only wrote
   * regional rows for the `regional` sidecars. Every `both` law was therefore
   * proposable in a region with no current law, which blanks the whole
   * "Current law -> Proposed" comparison block (metric chips included).
   */
  it("covers every projected law the region picker offers", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const offeredAtState = getCatalog(countryId)
        .map((law) => ({ law, doc: projectLawToLegislationType(law) }))
        .filter(({ doc }) => doc.allowedScope === "state" || doc.allowedScope === "both")
        .filter(({ law }) => law.kind !== "tax");

      for (const { law } of offeredAtState) {
        const seededBySidecarPath = law.allowedScope === "regional";
        const seededByDefaultPath = regionalDefaultLevel(law.id) !== undefined;
        expect(
          seededBySidecarPath || seededByDefaultPath,
          `${law.id} is proposable at region scope with no regional default law`
        ).toBe(true);
      }
    }
  });
});

describe("residual neutrality", () => {
  /**
   * The whole reason the seeded level is 0. The turn dynamics phase
   * (politicalMetricsDynamics) reads EVERY non-tax catalog law out of the
   * region's statePolicies rows and feeds the level map to `lawTargets`, so
   * adding ~2,200 regional rows to a live world must compose the SAME target
   * it did when those rows did not exist. `lawTargets` documents "missing law
   * = level 0" and skips `level <= 0`; this asserts it rather than trusting it.
   */
  it("composes an identical regional supplement with and without the level-0 rows", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      const withoutRows = lawTargets(countryId, new Map<string, number>());
      const withRows = lawTargets(
        countryId,
        new Map(regionalDefaultLaws(countryId).map((law) => [law.id, REGIONAL_DEFAULT_LEVEL]))
      );
      expect(withRows).toEqual(withoutRows);
    }
  });

  it("a region that actually legislates one still moves its target", () => {
    const law = regionalDefaultLaws("RU")[0]!;
    const enacted = lawTargets("RU", new Map([[law.id, 4]]));
    const idle = lawTargets("RU", new Map([[law.id, REGIONAL_DEFAULT_LEVEL]]));
    expect(enacted[law.targets[0].metricId]).toBeGreaterThan(idle[law.targets[0].metricId]);
  });
});

describe("projected docs stay inside the picker conditions the coverage test checks", () => {
  /**
   * `/api/game/legislation-types?scope=state` has a THIRD branch —
   * `{ allowedScope: { $exists: false }, nationalOnly: { $ne: true } }`. The
   * coverage test above only mirrors the first two, which is sound only while
   * every projected doc carries an explicit allowedScope. Pin that.
   */
  it("every projected law declares an explicit allowedScope", () => {
    for (const countryId of LAW_COUNTRY_IDS) {
      for (const law of getCatalog(countryId)) {
        expect(projectLawToLegislationType(law).allowedScope).toBeDefined();
      }
    }
  });
});
