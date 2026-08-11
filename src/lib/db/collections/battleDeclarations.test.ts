import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  getPendingDeclaration,
  listDeclarationHistory,
  listPendingDeclarations,
  listPendingForCountry,
} from "./battleDeclarations";

describe("battleDeclarations queries", () => {
  it("getPendingDeclaration filters by country + theater + pending", async () => {
    const db = createMockDb();
    db.collection("battleDeclarations");
    db.collectionMocks.battleDeclarations.findOne.mockResolvedValue(null);
    await getPendingDeclaration(db as unknown as Db, "US", "afghan");
    expect(db.collectionMocks.battleDeclarations.findOne).toHaveBeenCalledWith({
      declarerCountry: "US",
      theaterId: "afghan",
      status: "pending",
    });
  });

  it("listPendingDeclarations filters by pending status", async () => {
    const db = createMockDb();
    db.collection("battleDeclarations");
    const toArray = vi.fn().mockResolvedValue([{ theaterId: "afghan" }]);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({ toArray });
    const r = await listPendingDeclarations(db as unknown as Db);
    expect(db.collectionMocks.battleDeclarations.find).toHaveBeenCalledWith({ status: "pending" });
    expect(r).toHaveLength(1);
  });

  it("listPendingForCountry filters by declarer + pending", async () => {
    const db = createMockDb();
    db.collection("battleDeclarations");
    const toArray = vi.fn().mockResolvedValue([]);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({ toArray });
    await listPendingForCountry(db as unknown as Db, "US");
    expect(db.collectionMocks.battleDeclarations.find).toHaveBeenCalledWith({
      declarerCountry: "US",
      status: "pending",
    });
  });

  it("lists the latest completed declarations for a theater", async () => {
    const db = createMockDb();
    db.collection("battleDeclarations");
    const toArray = vi.fn().mockResolvedValue([{ theaterId: "afghan", status: "resolved" }]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit });
    db.collectionMocks.battleDeclarations.find.mockReturnValue({ sort });

    const result = await listDeclarationHistory(db as unknown as Db, "afghan", 3);

    expect(db.collectionMocks.battleDeclarations.find).toHaveBeenCalledWith({
      theaterId: "afghan",
      status: { $in: ["resolved", "fizzled"] },
    });
    expect(sort).toHaveBeenCalledWith({ declaredTurn: -1 });
    expect(limit).toHaveBeenCalledWith(3);
    expect(result).toHaveLength(1);
  });
});
