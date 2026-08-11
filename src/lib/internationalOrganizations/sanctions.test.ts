import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildOrganizationSanctionEmbargoes } from "./sanctions";

describe("buildOrganizationSanctionEmbargoes", () => {
  const base = {
    resolutionId: new ObjectId(),
    targetCountryId: "BR" as const,
    commodity: "steel" as const,
    createdBy: new ObjectId(),
    currentTurn: 200,
  };

  it("creates one embargo per member except the target", () => {
    const out = buildOrganizationSanctionEmbargoes({
      ...base,
      members: ["US", "UK", "BR"],
    });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.sourceCountry).sort()).toEqual(["UK", "US"]);
    for (const e of out) {
      expect(e.targetCountry).toBe("BR");
      expect(e.commodity).toBe("steel");
      expect(e.direction).toBe("both");
      expect(e.mode).toBe("block");
      expect(e.origin).toBe("organization");
      expect(e.sourceResolutionId).toBe(base.resolutionId);
      expect(e.expiresTurn).toBeUndefined(); // durable until repealed
    }
  });

  it("returns nothing when the only member is the target", () => {
    expect(buildOrganizationSanctionEmbargoes({ ...base, members: ["BR"] })).toEqual([]);
  });

  it("stamps an expiry turn when given one", () => {
    const out = buildOrganizationSanctionEmbargoes({
      ...base,
      members: ["US", "BR"],
      expiresTurn: 248,
    });
    expect(out[0].expiresTurn).toBe(248);
  });
});
