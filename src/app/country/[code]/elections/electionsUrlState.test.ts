import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  electionsHref,
  parseElectionsParams,
  toElectionsParams,
  type ElectionsFilters,
} from "./electionsUrlState";

const parse = (qs: string) => parseElectionsParams(new URLSearchParams(qs));

describe("parseElectionsParams", () => {
  it("defaults to an unfiltered list view", () => {
    expect(parse("")).toEqual(DEFAULT_FILTERS);
  });

  it("reads senate class via the existing ?type=senate&class=N shape", () => {
    expect(parse("type=senate&class=2").race).toBe("senate-2");
    expect(parse("type=senate&class=3").race).toBe("senate-3");
  });

  it("defaults a classless senate link to class I, preserving prior behavior", () => {
    expect(parse("type=senate").race).toBe("senate-1");
  });

  it("reads non-senate race types", () => {
    expect(parse("type=governor").race).toBe("governor");
    expect(parse("type=president").race).toBe("president");
    expect(parse("type=dail").race).toBe("dail");
  });

  it("ignores unknown race types rather than filtering everything out", () => {
    expect(parse("type=bogus").race).toBe("");
  });

  it("accepts a chamber-keyed race type so non-US countries can deep-link", () => {
    // The old hand-written union silently dropped these, leaving most countries
    // with no working ?type= link at all.
    expect(parse("type=cameraDeputati").race).toBe("cameraDeputati");
    expect(parse("type=riksdag").race).toBe("riksdag");
    expect(parse("type=supremeSovietDeputy").race).toBe("supremeSovietDeputy");
    expect(parse("type=volkskammerDeputy").race).toBe("volkskammerDeputy");
  });

  it("treats a missing ?open= as unset so the page picks its own default", () => {
    expect(parse("").open).toBeNull();
  });

  it("reads expanded sections from ?open=", () => {
    expect(parse("open=senate,house").open).toEqual(["senate", "house"]);
  });

  it("keeps an explicit all-collapsed choice distinct from unset", () => {
    expect(parse("open=").open).toEqual([]);
  });

  it("reads view, state, and toggles", () => {
    const f = parse("view=map&state=NE&competitive=1&active=1");
    expect(f.view).toBe("map");
    expect(f.state).toBe("NE");
    expect(f.competitive).toBe(true);
    expect(f.hideUpcoming).toBe(true);
  });

  it("ignores a legacy ?page= from an old bookmark", () => {
    // The grouped list replaced 15-per-page pagination, so the param is inert.
    expect(parse("page=3")).toEqual(DEFAULT_FILTERS);
  });

  it("falls back to list for an unknown view", () => {
    expect(parse("view=globe").view).toBe("list");
  });
});

describe("toElectionsParams", () => {
  it("omits defaults so a clean view has a clean URL", () => {
    expect(toElectionsParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("writes senate class back as type=senate&class=N", () => {
    const qs = toElectionsParams({ ...DEFAULT_FILTERS, race: "senate-2" });
    expect(qs.get("type")).toBe("senate");
    expect(qs.get("class")).toBe("2");
  });

  it("omits class for non-senate races", () => {
    expect(toElectionsParams({ ...DEFAULT_FILTERS, race: "governor" }).get("class")).toBeNull();
  });

  it("omits ?open= when unset but writes it when collapsed to nothing", () => {
    expect(toElectionsParams({ ...DEFAULT_FILTERS, open: null }).get("open")).toBeNull();
    expect(toElectionsParams({ ...DEFAULT_FILTERS, open: [] }).get("open")).toBe("");
    expect(toElectionsParams({ ...DEFAULT_FILTERS, open: ["senate", "house"] }).get("open")).toBe(
      "senate,house"
    );
  });

  it("omits false toggles", () => {
    const qs = toElectionsParams({ ...DEFAULT_FILTERS, race: "governor" });
    expect(qs.get("competitive")).toBeNull();
    expect(qs.get("active")).toBeNull();
  });
});

describe("round trip", () => {
  const cases: ElectionsFilters[] = [
    DEFAULT_FILTERS,
    { ...DEFAULT_FILTERS, race: "governor", view: "map" },
    { ...DEFAULT_FILTERS, race: "senate-2", state: "NE", view: "list" },
    { ...DEFAULT_FILTERS, race: "commons", competitive: true, hideUpcoming: true },
    { ...DEFAULT_FILTERS, race: "cameraDeputati", open: ["deputy"] },
    { ...DEFAULT_FILTERS, open: [] },
    { ...DEFAULT_FILTERS, primary: "in" as const },
    { ...DEFAULT_FILTERS, primary: "out" as const, contest: "uncontested" as const },
    { ...DEFAULT_FILTERS, race: "governor", contest: "contested" as const },
  ];

  it("parse(toParams(f)) is identity", () => {
    for (const f of cases) {
      expect(parseElectionsParams(toElectionsParams(f))).toEqual(f);
    }
  });

  it("falls back to no constraint on a junk primary/contest param", () => {
    const f = parseElectionsParams(new URLSearchParams("primary=maybe&contest=sort-of"));
    expect(f.primary).toBe("");
    expect(f.contest).toBe("");
  });
});

describe("electionsHref", () => {
  it("builds a bare path when nothing is filtered", () => {
    expect(electionsHref("/country/us/elections", DEFAULT_FILTERS)).toBe("/country/us/elections");
  });

  it("builds a deep link for a specific state's races", () => {
    expect(
      electionsHref("/country/us/elections", {
        ...DEFAULT_FILTERS,
        race: "governor",
        state: "NE",
      })
    ).toBe("/country/us/elections?type=governor&state=NE");
  });
});
