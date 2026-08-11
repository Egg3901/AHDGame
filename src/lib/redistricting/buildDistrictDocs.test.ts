import { describe, it, expect } from "vitest";
import { buildDistrictDocs } from "./buildDistrictDocs";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("buildDistrictDocs", () => {
  it("creates n docs with stable ids, cached fields, and conserved squares", () => {
    const docs = buildDistrictDocs({
      countryId: "US",
      stateId: "CA",
      n: 4,
      poolPercents: { left: 45, right: 35, grey: 20 },
      pvis: [20, 5, -5, -20],
      now,
    });

    expect(docs).toHaveLength(4);
    expect(docs[0]._id).toBe("US_CA_1");
    expect(docs[3]._id).toBe("US_CA_4");
    expect(docs.map((d) => d.index)).toEqual([1, 2, 3, 4]);

    docs.forEach((d) => {
      expect(d.squares.left + d.squares.right + d.squares.grey).toBe(16);
      expect(d.netLean).toBe(d.squares.right - d.squares.left);
      expect(d.greyShare).toBeCloseTo(d.squares.grey / 16, 5);
      expect(d.holderCharacterId).toBeNull();
      expect(d.holderParty).toBeNull();
      expect(d.lastRedrawnCensus).toBeNull();
      expect(d.createdAt).toEqual(now);
    });
    expect(docs[0].source).toBe("cookpvi");
  });

  it("tags source 'registration' when PVI is absent", () => {
    const docs = buildDistrictDocs({
      countryId: "US",
      stateId: "WY",
      n: 1,
      poolPercents: { left: 26, right: 62, grey: 12 },
      pvis: null,
      now,
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].source).toBe("registration");
    expect(docs[0].squares.left + docs[0].squares.right + docs[0].squares.grey).toBe(16);
  });
});
