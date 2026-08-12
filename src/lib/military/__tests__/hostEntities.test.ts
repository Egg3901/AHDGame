import { describe, it, expect } from "vitest";
import { hostEntitiesOf } from "../hostEntities";

describe("hostEntitiesOf", () => {
  it("returns the explicit roster when present", () => {
    expect(hostEntitiesOf({ hostCountry: "SVN", hostEntities: ["NVN", "SVN"] })).toEqual([
      "NVN",
      "SVN",
    ]);
  });

  it("falls back to the anchor alone when absent", () => {
    // A missing roster must mean "just the anchor", never "no countries change bloc" --
    // the latter makes the whole resolution outcome a silent no-op on every single-host
    // proxy war and on every conflict document that predates the field.
    expect(hostEntitiesOf({ hostCountry: "SVN" })).toEqual(["SVN"]);
  });

  it("falls back for an explicitly empty roster too", () => {
    expect(hostEntitiesOf({ hostCountry: "SVN", hostEntities: [] })).toEqual(["SVN"]);
  });
});
