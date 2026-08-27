import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("publicApi world queries", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  describe("queryCountryHistory", () => {
    it("returns found:false when there are no events", async () => {
      const { queryCountryHistory } = await import("./world");
      const result = await queryCountryHistory(db as unknown as Db, "US");
      expect(result.found).toBe(false);
      expect(result.events).toEqual([]);
    });

    it("maps event documents to the public shape", async () => {
      const { queryCountryHistory } = await import("./world");
      const ts = new Date("2026-01-01T00:00:00Z");
      const col = db.collection("countryHistory");
      col.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            countryId: "US",
            turn: 120,
            timestamp: ts,
            eventType: "leader_change",
            title: "New president takes office",
            characterId: new ObjectId(),
            characterName: "Jane Doe",
            party: "1",
          },
        ]),
      } as never);

      const result = await queryCountryHistory(db as unknown as Db, "us");
      expect(result.found).toBe(true);
      expect(result.events).toHaveLength(1);
      const ev = (result.events as Record<string, unknown>[])[0];
      expect(ev.eventType).toBe("leader_change");
      expect(ev.turn).toBe(120);
      expect(ev.characterName).toBe("Jane Doe");
      expect(ev.timestamp).toBe(ts.toISOString());
    });
  });

  describe("queryConflicts", () => {
    it("filters by country across host and both sides", async () => {
      const { queryConflicts } = await import("./world");
      const col = db.collection("conflicts");
      col.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      } as never);

      await queryConflicts(db as unknown as Db, { country: "us" });
      const filter = col.find.mock.calls[0][0] as Record<string, unknown>;
      expect(filter.$or).toEqual([
        { hostCountry: "US" },
        { "sideA.countries": "US" },
        { "sideB.countries": "US" },
      ]);
    });

    it("maps conflict docs to the public shape", async () => {
      const { queryConflicts } = await import("./world");
      const col = db.collection("conflicts");
      col.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "theater-1",
            conflictId: 3,
            name: "Test War",
            hostCountry: "VN",
            region: "SEA",
            type: "cold_war",
            status: "active",
            bloc: "contested",
            terrain: "jungle",
            severity: "MEDIUM",
            intensity: 42,
            control: 30,
            supplyA: 80,
            supplyB: 60,
            sideA: { label: "Government", countries: ["VN"], kind: "state" },
            sideB: { label: "Insurgents", countries: [], kind: "generated" },
          },
        ]),
      } as never);

      const result = await queryConflicts(db as unknown as Db);
      expect(result.found).toBe(true);
      const c = (result.conflicts as Record<string, unknown>[])[0];
      expect(c.conflictId).toBe(3);
      expect((c.sideA as Record<string, unknown>).countries).toEqual(["VN"]);
      expect((c.sideB as Record<string, unknown>).backer).toBeNull();
    });
  });

  describe("queryBattleReports", () => {
    it("queries reports involving the country and maps fields", async () => {
      const { queryBattleReports } = await import("./world");
      const col = db.collection("battleReports");
      const id = new ObjectId();
      col.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            _id: id,
            theaterId: "theater-1",
            declarerCountry: "US",
            targetCountry: "VN",
            turn: 200,
            result: null,
            noContact: true,
            unopposedAdvance: true,
          },
        ]),
      } as never);

      const result = await queryBattleReports(db as unknown as Db, "US");
      expect(col.find.mock.calls[0][0]).toEqual({
        $or: [{ declarerCountry: "US" }, { targetCountry: "US" }],
      });
      expect(result.found).toBe(true);
      const b = (result.battles as Record<string, unknown>[])[0];
      expect(b.attackers).toEqual(["US"]);
      expect(b.noContact).toBe(true);
      expect(b.controlBefore).toBeNull();
    });
  });
});
