import { describe, expect, it } from "vitest";
import { buildStateRivals } from "./buildStateRivals";

describe("buildStateRivals", () => {
  const parties = [
    { sequentialId: 10, abbreviation: "RA", color: "#111111" },
    { sequentialId: 11, abbreviation: "RB", color: "#222222" },
  ];

  it("excludes the subject party and sorts by org desc", () => {
    const rivals = buildStateRivals({
      rows: [
        { partyId: "9", organization: 99 }, // subject — excluded
        { partyId: "10", organization: 12 },
        { partyId: "11", organization: 30 },
      ],
      parties,
      excludePartyKey: "9",
    });
    expect(rivals.map((r) => r.partyId)).not.toContain("9");
    expect(rivals.map((r) => r.abbreviation)).toEqual(["RB", "RA"]); // 30 before 12
  });

  it("drops rows with no matching party doc", () => {
    const rivals = buildStateRivals({
      rows: [
        { partyId: "10", organization: 5 },
        { partyId: "404", organization: 50 }, // no party doc
      ],
      parties,
      excludePartyKey: "9",
    });
    expect(rivals.map((r) => r.partyId)).toEqual(["10"]);
  });

  it("returns a hex color for each rival", () => {
    const rivals = buildStateRivals({
      rows: [{ partyId: "10", organization: 5 }],
      parties,
      excludePartyKey: "9",
    });
    expect(rivals[0].color).toMatch(/^#/);
  });
});
