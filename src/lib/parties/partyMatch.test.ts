import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPartyIdResolver,
  normalizePartyRef,
  partiesMatchInCountry,
  stripCountryPartyPrefix,
} from "./partyMatch";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

describe("partyMatch helpers", () => {
  it("strips country prefixes from legacy slugs", () => {
    expect(stripCountryPartyPrefix("cn_ccp")).toBe("ccp");
    expect(stripCountryPartyPrefix("uk_labour")).toBe("labour");
  });

  it("normalizes numeric sequential ids", () => {
    expect(normalizePartyRef("1")).toBe("1");
    expect(normalizePartyRef("01")).toBe("1");
  });
});

describe("buildPartyIdResolver", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: 1, abbreviation: "CCP" },
          { sequentialId: 2, abbreviation: "CDL" },
        ],
      }),
    });
  });

  it("maps sequential id, abbreviation, and cn_ccp slug to the same canonical id", async () => {
    const resolve = await buildPartyIdResolver(db as unknown as Db, "CN");
    expect(resolve("1")).toBe("1");
    expect(resolve("CCP")).toBe("1");
    expect(resolve("ccp")).toBe("1");
    expect(resolve("cn_ccp")).toBe("1");
    expect(resolve("2")).toBe("2");
  });
});

describe("partiesMatchInCountry", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ sequentialId: 1, abbreviation: "CCP" }],
      }),
    });
  });

  it("treats character party sequential id and candidate cn_ccp slug as the same party", async () => {
    const match = await partiesMatchInCountry(db as unknown as Db, "CN", "1", "cn_ccp");
    expect(match).toBe(true);
  });

  it("returns false for different parties", async () => {
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: 1, abbreviation: "CCP" },
          { sequentialId: 2, abbreviation: "CDL" },
        ],
      }),
    });
    const match = await partiesMatchInCountry(db as unknown as Db, "CN", "1", "2");
    expect(match).toBe(false);
  });
});
