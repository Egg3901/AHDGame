import { describe, it, expect, beforeEach } from "vitest";
import { inferCountryIdFromStateId, resolveBillCountryId } from "./resolveBillCountryId";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Bill } from "@/lib/db/types";
import type { Db } from "mongodb";

describe("inferCountryIdFromStateId", () => {
  it("maps federal and uk_national", () => {
    expect(inferCountryIdFromStateId("federal")).toBe("US");
    expect(inferCountryIdFromStateId("uk_national")).toBe("UK");
  });

  it("maps de_national and jp_national", () => {
    expect(inferCountryIdFromStateId("de_national")).toBe("DE");
    expect(inferCountryIdFromStateId("jp_national")).toBe("JP");
  });
});

describe("resolveBillCountryId", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    // Ensure states mock exists before tests configure findOne.
    db.collection("states");
  });

  it("uses persisted bill.countryId", async () => {
    const bill = { countryId: "DE" as const, stateId: "NW" } as Pick<Bill, "countryId" | "stateId">;
    await expect(resolveBillCountryId(db as unknown as Db, bill)).resolves.toBe("DE");
  });

  it("resolves UK from uk_national without states lookup", async () => {
    const bill = { stateId: "uk_national" } as Pick<Bill, "countryId" | "stateId">;
    await expect(resolveBillCountryId(db as unknown as Db, bill)).resolves.toBe("UK");
  });

  it("loads country from states collection when needed", async () => {
    db.collectionMocks["states"]!.findOne.mockResolvedValue({ _id: "TX", countryId: "US" });
    const bill = { stateId: "TX" } as Pick<Bill, "countryId" | "stateId">;
    await expect(resolveBillCountryId(db as unknown as Db, bill)).resolves.toBe("US");
  });

  it("falls back to US when state is unknown (legacy congress bills)", async () => {
    db.collectionMocks["states"]!.findOne.mockResolvedValue(null);
    const bill = { stateId: "ZZ" } as Pick<Bill, "countryId" | "stateId">;
    await expect(resolveBillCountryId(db as unknown as Db, bill)).resolves.toBe("US");
  });
});
