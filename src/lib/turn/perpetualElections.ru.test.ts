/**
 * Unit tests for the RU (Soviet Union) delegate election spawners.
 * Covers the two D10 gates (runtime status + era anchors) and the three
 * seat sources (houseDistricts / RU_NATIONALITIES_SEATS / stateSenateSeats).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";

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

// Representative subset — seat sourcing is under test, not the 17-region roster
// (that invariant lives in sovietSeatMap.test.ts).
// UKR and BLT left the RSFSR when Ukraine and the Baltics became their own
// countries, so the fixture uses regions RU still owns. KAZ and TRA are the
// non-RSFSR union republics that remain, which is what this suite is about:
// the delegate spawners must seat a republic differently from a macro-region.
const RU_REGIONS = [
  { _id: "CEN", houseDistricts: 80, stateSenateSeats: 575 },
  { _id: "KAZ", houseDistricts: 30, stateSenateSeats: 400 },
  { _id: "TRA", houseDistricts: 39, stateSenateSeats: 450 },
];

function makeRUMockDb(currentTurn: number, gameState: Record<string, unknown> = {}) {
  const insertCalls: Omit<Election, "_id">[][] = [];
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(RU_REGIONS),
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

async function mountRU(
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

describe("RU delegate spawners (1953-default, status active)", () => {
  it("union chamber seats each region at its houseDistricts", async () => {
    const mock = makeRUMockDb(1);
    await mountRU(mock);
    const { ensureRUSupremeSovietElections } = await import("./perpetualElections");
    await ensureRUSupremeSovietElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(RU_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.countryId).toBe("RU");
      expect(doc.electionType).toBe("supremeSovietDeputy");
      expect(doc.totalSeats).toBe(RU_REGIONS.find((r) => r._id === doc.state)?.houseDistricts);
      expect(doc.electionYear).toBe(1954);
    }
  });

  it("nationalities chamber seats from RU_NATIONALITIES_SEATS", async () => {
    const mock = makeRUMockDb(1);
    await mountRU(mock);
    const { ensureRUNationalitiesElections } = await import("./perpetualElections");
    await ensureRUNationalitiesElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(RU_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("nationalitiesDeputy");
      expect(doc.totalSeats).toBe(RU_NATIONALITIES_SEATS[doc.state!]);
    }
  });

  it("republic soviets seat each region at its authored stateSenateSeats", async () => {
    const mock = makeRUMockDb(1);
    await mountRU(mock);
    const { ensureRURepublicSovietElections } = await import("./perpetualElections");
    await ensureRURepublicSovietElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(RU_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("republicSupremeSoviet");
      expect(doc.totalSeats).toBe(RU_REGIONS.find((r) => r._id === doc.state)?.stateSenateSeats);
    }
  });
});

describe("D10 gates", () => {
  it("status gate: coming-soon (not NPP-governed) spawns nothing in any family", async () => {
    const mock = makeRUMockDb(1);
    await mountRU(mock, "coming-soon");
    const {
      ensureRUSupremeSovietElections,
      ensureRUNationalitiesElections,
      ensureRURepublicSovietElections,
      ensureRUGovernorElections,
    } = await import("./perpetualElections");
    const now = new Date("2026-04-01T00:00:00Z");
    await ensureRUSupremeSovietElections(now);
    await ensureRUNationalitiesElections(now);
    await ensureRURepublicSovietElections(now);
    await ensureRUGovernorElections(now);
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("NPP-governed gate (#3386): coming-soon + nppGoverned spawns all families read-only", async () => {
    // RU stays coming-soon (never player-enabled) but the NPP governing brain
    // runs its Supreme Soviet, so the legislature re-elects instead of freezing.
    const mock = makeRUMockDb(1);
    await mountRU(mock, "coming-soon", /* nppGoverned */ true);
    const {
      ensureRUSupremeSovietElections,
      ensureRUNationalitiesElections,
      ensureRURepublicSovietElections,
      ensureRUGovernorElections,
    } = await import("./perpetualElections");
    const now = new Date("2026-04-01T00:00:00Z");
    await ensureRUSupremeSovietElections(now);
    await ensureRUNationalitiesElections(now);
    await ensureRURepublicSovietElections(now);
    await ensureRUGovernorElections(now);
    // Each of the 4 families spawns one election per seeded region.
    expect(mock.insertCalls.flat()).toHaveLength(RU_REGIONS.length * 4);
  });

  it("era gate: null anchors under 2019-default spawn nothing even when active", async () => {
    const mock = makeRUMockDb(1, { startingYear: 2019, preset: "2019-default" });
    await mountRU(mock);
    const { ensureRUSupremeSovietElections, ensureRURepublicSovietElections } =
      await import("./perpetualElections");
    const now = new Date("2026-04-01T00:00:00Z");
    await ensureRUSupremeSovietElections(now);
    await ensureRURepublicSovietElections(now);
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("first secretaries spawn on the republic-soviet cycle when active", async () => {
    const mock = makeRUMockDb(1);
    await mountRU(mock);
    const { ensureRUGovernorElections } = await import("./perpetualElections");
    await ensureRUGovernorElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(RU_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("governor");
      expect(doc.countryId).toBe("RU");
      expect(doc.endTurn).toBe(144); // ruRepublicSoviet anchor, 1955
      expect(doc.electionYear).toBe(1955);
    }
  });
});
