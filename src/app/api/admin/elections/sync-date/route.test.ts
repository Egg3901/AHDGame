/**
 * sync-date route — RU (Soviet) bootstrap section.
 *
 * Covers the Cold-War-only RU block: the four election families spawn with
 * their canonical anchors and seat totals when RU is runtime-live under a
 * Cold-War preset, and stay absent when RU is coming-soon or the preset has
 * null RU anchors (2019-default).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/countryAccess", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCountryAccessFromDb: vi.fn(),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const RU_STATES = [
  { _id: "CEN", countryId: "RU", houseDistricts: 120, stateSenateSeats: 575 },
  { _id: "TRA", countryId: "RU", houseDistricts: 40, stateSenateSeats: 440 },
];

async function setup(db: MockDb, opts: { preset: string; startingYear: number; ruStatus: string }) {
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 500,
    startingYear: opts.startingYear,
    preset: opts.preset,
  });
  db.collectionMocks.elections!.find.mockReturnValue(cursor([]));
  db.collectionMocks.states!.find.mockReturnValue(cursor(RU_STATES));
  db.collectionMocks.electedOfficials!.find.mockReturnValue(cursor([]));

  const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({ status: opts.ruStatus } as never);
}

async function callPost() {
  const { POST } = await import("./route");
  return POST();
}

function insertedElections(db: MockDb): Election[] {
  const call = db.collectionMocks.elections!.insertMany.mock.calls[0];
  return (call?.[0] ?? []) as Election[];
}

describe("POST sync-date — RU Soviet bootstrap", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-touch every collection the route reads so collectionMocks entries exist.
    for (const name of ["gameState", "elections", "states", "electedOfficials"]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);
  });

  it("1953 preset + live RU: spawns all four families with canonical anchors and totals", async () => {
    await setup(db, { preset: "1953-default", startingYear: 1953, ruStatus: "beta" });

    const res = await callPost();
    expect(res.status).toBe(200);

    const ru = insertedElections(db).filter((e) => e.countryId === "RU");
    // 2 regions × (union + nationalities + republic soviet + governor)
    expect(ru).toHaveLength(8);

    // Union + Nationalities fire same-day on the ruSupremeSoviet anchor
    // (1954 → turn 1 + 96 = 97).
    const unionTra = ru.find((e) => e.electionType === "supremeSovietDeputy" && e.state === "TRA");
    expect(unionTra).toMatchObject({ cycle: 1, status: "active", totalSeats: 40, endTurn: 97 });

    const natTra = ru.find((e) => e.electionType === "nationalitiesDeputy" && e.state === "TRA");
    // Nationalities totals come from the D11 map, not houseDistricts.
    expect(natTra).toMatchObject({ totalSeats: 108, endTurn: 97 });
    const natCen = ru.find((e) => e.electionType === "nationalitiesDeputy" && e.state === "CEN");
    expect(natCen).toMatchObject({ totalSeats: 25, endTurn: 97 });

    // Republic soviets seat each region's authored stateSenateSeats and share
    // the ruRepublicSoviet anchor (1955 → turn 1 + 144 = 145).
    const repCen = ru.find((e) => e.electionType === "republicSupremeSoviet" && e.state === "CEN");
    expect(repCen).toMatchObject({ totalSeats: 575, endTurn: 145 });
    const repTra = ru.find((e) => e.electionType === "republicSupremeSoviet" && e.state === "TRA");
    expect(repTra).toMatchObject({ totalSeats: 440, endTurn: 145 });

    // First Secretaries ride the same republic anchor as single-seat races.
    const govTra = ru.find((e) => e.electionType === "governor" && e.state === "TRA");
    expect(govTra).toMatchObject({ totalSeats: 1, endTurn: 145 });

    // Every RU doc gets a seatId and a baked LARP election year.
    for (const e of ru) {
      expect(e.seatId).toBeTruthy();
      expect(typeof e.electionYear).toBe("number");
    }
  });

  it("coming-soon RU spawns nothing even under a Cold-War preset", async () => {
    await setup(db, { preset: "1953-default", startingYear: 1953, ruStatus: "coming-soon" });

    const res = await callPost();
    expect(res.status).toBe(200);
    expect(insertedElections(db).filter((e) => e.countryId === "RU")).toHaveLength(0);
  });

  it("2019 preset has null RU anchors → no RU elections regardless of status", async () => {
    await setup(db, { preset: "2019-default", startingYear: 2019, ruStatus: "beta" });

    const res = await callPost();
    expect(res.status).toBe(200);
    expect(insertedElections(db).filter((e) => e.countryId === "RU")).toHaveLength(0);
  });
});
