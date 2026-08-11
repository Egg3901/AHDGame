import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getResourceContractAuthority } from "./contractAuthority";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorWithNext(doc: unknown) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    next: vi.fn().mockResolvedValue(doc),
  };
}

function setLaw(db: MockDb, doc: unknown) {
  db.collection("enactedLaws");
  db.collectionMocks["enactedLaws"]!.find.mockReturnValue(cursorWithNext(doc) as never);
}

describe("getResourceContractAuthority", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("defaults to national when no authority law is enacted", async () => {
    setLaw(db, null);
    expect(await getResourceContractAuthority(db as unknown as Db, "US")).toBe("national");
  });

  it("maps policyOptionIndex 0 to national (federal licensing)", async () => {
    setLaw(db, { policyOptionIndex: 0 });
    expect(await getResourceContractAuthority(db as unknown as Db, "US")).toBe("national");
  });

  it("maps policyOptionIndex 1 to both (concurrent licensing)", async () => {
    setLaw(db, { policyOptionIndex: 1 });
    expect(await getResourceContractAuthority(db as unknown as Db, "US")).toBe("both");
  });

  it("maps policyOptionIndex 2 to state (state licensing)", async () => {
    setLaw(db, { policyOptionIndex: 2 });
    expect(await getResourceContractAuthority(db as unknown as Db, "US")).toBe("state");
  });

  it("falls back to national when the enacted option index is missing", async () => {
    setLaw(db, { policyOptionIndex: undefined });
    expect(await getResourceContractAuthority(db as unknown as Db, "US")).toBe("national");
  });
});
