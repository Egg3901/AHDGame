import { describe, expect, it } from "vitest";
import { crisisBoardCounts, crisisListedInScope } from "./boardCounts";

const rows = [
  { status: "active", scope: "global", countryIds: [] },
  { status: "resolved", scope: "global", countryIds: [] },
  { status: "resolved", scope: "global", countryIds: [] },
  // Multi-country national crisis counts once, not once per country group.
  { status: "resolved", scope: "country", countryIds: ["US", "UK"] },
  // Not listable: its only country is outside this world.
  { status: "resolved", scope: "country", countryIds: ["ZZ"] },
  { status: "active", scope: "region", countryIds: ["US"] },
];

describe("crisisBoardCounts", () => {
  it("separates the all-scope header figure from the tab's resolved figure", () => {
    const global = crisisBoardCounts(rows, "global", ["US", "UK"]);
    expect(global.resolvedAllScopes).toBe(4);
    expect(global.resolvedInScope).toBe(2);
    expect(global.activeAllScopes).toBe(2);
    expect(global.activeInScope).toBe(1);
  });

  it("counts only crises the national tab can actually list", () => {
    const national = crisisBoardCounts(rows, "country", ["US", "UK"]);
    expect(national.resolvedInScope).toBe(1);
    expect(national.activeInScope).toBe(0);
  });

  it("has no in-scope figures on a non-crisis tab", () => {
    const debt = crisisBoardCounts(rows, null, ["US"]);
    expect(debt.resolvedInScope).toBe(0);
    expect(debt.resolvedAllScopes).toBe(4);
  });
});

describe("crisisListedInScope", () => {
  it("requires a registered country on grouped tabs", () => {
    expect(crisisListedInScope(rows[4], "country", ["US"])).toBe(false);
    expect(crisisListedInScope(rows[3], "country", ["UK"])).toBe(true);
    expect(crisisListedInScope(rows[3], "region", ["UK"])).toBe(false);
  });
});
