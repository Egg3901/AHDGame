/**
 * Unit tests for the DD (East Germany) Land First Secretary spawner: the
 * status/NPP-governed gate, the era gate (null ddVolkskammer anchor outside
 * the Cold-War presets), and the Volkskammer anchor ride-along. Mirrors
 * perpetualElections.ru.test.ts (the sibling one-party state).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

vi.mock("@/lib/countryAccess", () => ({
  getCountryAccessFromDb: vi.fn(),
}));

// Representative subset — the six-Länder roster invariant lives in
// sovietSeatMap.test.ts / countryCoverage.test.ts.
const DD_REGIONS = [
  { _id: "BEO", houseDistricts: 32 },
  { _id: "SN", houseDistricts: 151 },
  { _id: "MV", houseDistricts: 58 },
];

function makeDDMockDb(currentTurn: number, gameState: Record<string, unknown> = {}) {
  const insertCalls: Omit<Election, "_id">[][] = [];
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(DD_REGIONS),
          }),
        };
      }
      if (name === "gameState") {
        return {
          findOne: vi.fn().mockResolvedValue({
            currentTurn,
            startingYear: 1953,
            preset: "1953-default",
            ...gameState,
          }),
        };
      }
      if (name === "elections") {
        return {
          find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
            if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
            return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
          }),
          insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
            insertCalls.push(docs);
            return Promise.resolve({ insertedIds: {} });
          }),
        };
      }
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    }),
  };
  return { db, insertCalls };
}

async function mountDD(
  mock: { db: unknown },
  status: "active" | "coming-soon" = "active",
  nppGoverned = false
) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mock.db as never);
  const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({ status, nppGoverned } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDDGovernorElections (Land First Secretaries)", () => {
  it("spawns one single-seat race per Land on the Volkskammer cycle when active", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(DD_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("governor");
      expect(doc.countryId).toBe("DD");
      expect(doc.totalSeats).toBe(1);
      // ddVolkskammer anchor (1954) — the Land races ride the chamber's cycle.
      expect(doc.electionYear).toBe(1954);
    }
  });

  it("status gate: coming-soon (not NPP-governed) spawns nothing", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock, "coming-soon");
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("NPP-governed gate: coming-soon + nppGoverned spawns the family", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock, "coming-soon", /* nppGoverned */ true);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(DD_REGIONS.length);
  });

  it("era gate: null ddVolkskammer anchor under 2019-default spawns nothing even when active", async () => {
    const mock = makeDDMockDb(1, { startingYear: 2019, preset: "2019-default" });
    await mountDD(mock);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });
});
