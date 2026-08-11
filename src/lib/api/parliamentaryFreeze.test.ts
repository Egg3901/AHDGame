import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

import { checkLegislationFreeze } from "./parliamentaryFreeze";

describe("checkLegislationFreeze", () => {
  it("returns {ok: true} for non-parliamentary countries (US)", async () => {
    const result = await checkLegislationFreeze("US");
    expect(result.ok).toBe(true);
  });

  it("returns {ok: true} for parliamentary country with formed gov", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({ _id: "UK", status: "formed" }),
    } as MockDb["collectionMocks"][string];

    const result = await checkLegislationFreeze("UK");
    expect(result.ok).toBe(true);
  });

  it("returns {ok: false, response} for parliamentary country with pending gov", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue({ _id: "UK", status: "pending" }),
    } as MockDb["collectionMocks"][string];

    const result = await checkLegislationFreeze("UK");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });

  it("returns {ok: true} for parliamentary country with no gov doc (defensive)", async () => {
    db.collectionMocks["governmentFormations"] = {
      ...db.collection("governmentFormations"),
      findOne: vi.fn().mockResolvedValue(null),
    } as MockDb["collectionMocks"][string];

    const result = await checkLegislationFreeze("UK");
    expect(result.ok).toBe(true);
  });
});
