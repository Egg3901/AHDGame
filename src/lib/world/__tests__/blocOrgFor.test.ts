import { describe, it, expect } from "vitest";
import { allianceNameFor, blocOrgFor } from "@/lib/world/blocMembership";

describe("blocOrgFor", () => {
  it("returns WARSAW_PACT for a 1953 preset", () => {
    // The direct regression test for the year-derivation defect. `resolveAlignmentEra`
    // flips to a post-Cold-War era at 1991 whose only accession channels are
    // WASHINGTON ones — Moscow and Beijing have no surviving bloc org there — so a
    // year-derived lookup returns nothing for the East and admits nobody, silently.
    // A 1953 world has a Warsaw Pact in its year 2050.
    expect(blocOrgFor("1953-default", "east")).toBe("WARSAW_PACT");
  });

  it("returns NATO for the West under the same preset", () => {
    expect(blocOrgFor("1953-default", "west")).toBe("NATO");
  });

  it("still answers for a modern preset", () => {
    expect(blocOrgFor("2019-default", "west")).toBe("NATO");
  });

  it("returns null for a bloc with no accession channel in that world", () => {
    // The modern era has no eastern accession org. Null, not a wrong guess: admitting
    // a country into an organisation that does not exist is the failure this avoids.
    expect(blocOrgFor("2019-default", "east")).toBeNull();
  });
});

describe("allianceNameFor", () => {
  // A war refusal names the treaty a player can read on the organisation page, not the
  // internal bloc token. "east" is not a thing anyone has heard of; the Warsaw Pact is.
  it("names the treaty a refusal should cite", () => {
    expect(allianceNameFor("1953-default", "east")).toBe("Warsaw Pact");
    expect(allianceNameFor("1953-default", "west")).toBe("North Atlantic Treaty Organization");
  });

  it("returns null where the bloc has no accession org in that world", () => {
    expect(allianceNameFor("2019-default", "east")).toBeNull();
  });

  it("returns null for non-alignment, which is not an alliance", () => {
    expect(allianceNameFor("1953-default", "nonAligned")).toBeNull();
  });
});
