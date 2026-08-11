/**
 * Tests for GET /api/elections/composition.
 *
 * The point of these is the country parameter. This route used to hardcode
 * `countryId: "US"` and return `currentHouse`/`currentSenate` with the frontend
 * dividing by a hardcoded 435/100, so a UK or German player looking at their own
 * chamber panel was shown US seat numbers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

async function setup({
  officials = [] as unknown[],
  parties = [] as unknown[],
  elections = [] as unknown[],
} = {}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: 1,
    isPaused: false,
  } as unknown as Awaited<ReturnType<typeof getGameTime>>);

  db.collection("electedOfficials");
  db.collection("politicalParties");
  db.collection("elections");
  db.collection("electionVoteTallies");
  db.collection("electionCandidates");

  db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
    toArray: async () => officials,
  });
  db.collectionMocks["politicalParties"]!.find.mockReturnValue({
    toArray: async () => parties,
  });
  db.collectionMocks["elections"]!.find.mockReturnValue({
    toArray: async () => elections,
  });
}

async function call(url: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request(url));
  return { status: res.status, body: await res.json() };
}

const BASE = "http://localhost/api/elections/composition";

describe("GET /api/elections/composition", () => {
  it("rejects an unknown country code", async () => {
    await setup();
    const { status, body } = await call(`${BASE}?country=ZZ`);
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid country code");
  });

  it("defaults to the US when no country is given, keeping old callers working", async () => {
    await setup();
    const { status, body } = await call(BASE);
    expect(status).toBe(200);
    expect(body.countryId).toBe("US");
  });

  it("returns the requested country's own chambers, not the US ones", async () => {
    await setup();
    const { body } = await call(`${BASE}?country=UK`);

    expect(body.countryId).toBe("UK");
    expect(body.lower.key).toBe(COUNTRY_CONFIGS.UK.legislature.lowerChamber.key);
    expect(body.lower.name).toBe(COUNTRY_CONFIGS.UK.legislature.lowerChamber.name);
    // The seat total comes from config, not from a hardcoded 435.
    expect(body.lower.totalSeats).toBe(COUNTRY_CONFIGS.UK.legislature.lowerChamber.seats);
    expect(body.lower.totalSeats).not.toBe(COUNTRY_CONFIGS.US.legislature.lowerChamber.seats);
  });

  it("omits an appointed upper chamber, which is never contested", async () => {
    await setup();
    // UK Lords and the DE Bundesrat are appointed, so there is no election to
    // project and no panel to show.
    expect((await call(`${BASE}?country=UK`)).body.upper).toBeNull();
    expect((await call(`${BASE}?country=DE`)).body.upper).toBeNull();
  });

  it("includes an elected upper chamber", async () => {
    await setup();
    const { body } = await call(`${BASE}?country=US`);
    expect(body.upper).not.toBeNull();
    expect(body.upper.key).toBe(COUNTRY_CONFIGS.US.legislature.upperChamber!.key);
    expect(body.upper.totalSeats).toBe(COUNTRY_CONFIGS.US.legislature.upperChamber!.seats);
  });

  it("returns null for both chambers of a unicameral legislature's upper tier", async () => {
    await setup();
    const { body } = await call(`${BASE}?country=FI`);
    expect(body.lower.key).toBe(COUNTRY_CONFIGS.FI.legislature.lowerChamber.key);
    expect(body.upper).toBeNull();
  });

  it("tallies seated officials into the matching chamber", async () => {
    await setup({
      officials: [
        { officeType: "senate", party: "1", characterId: "a", state: "CT", senateClass: 1 },
        { officeType: "senate", party: "1", characterId: "b", state: "DE", senateClass: 1 },
        { officeType: "senate", party: "2", characterId: "c", state: "NY", senateClass: 2 },
        // A lower-chamber member must not leak into the upper tally.
        { officeType: "house", party: "2", characterId: "d", state: "CA", seatsHeld: 3 },
      ],
      parties: [
        { sequentialId: 1, name: "First", color: "#111111", economicPosition: -2 },
        { sequentialId: 2, name: "Second", color: "#222222", economicPosition: 2 },
      ],
    });

    const { body } = await call(`${BASE}?country=US`);
    const upperByParty = Object.fromEntries(
      body.upper.current.map((p: { party: string; seats: number }) => [p.party, p.seats])
    );
    expect(upperByParty).toEqual({ "1": 2, "2": 1 });

    const lowerByParty = Object.fromEntries(
      body.lower.current.map((p: { party: string; seats: number }) => [p.party, p.seats])
    );
    // The House is multi-seat, so seatsHeld counts.
    expect(lowerByParty).toEqual({ "2": 3 });
  });

  it("sorts parties left to right by economic position", async () => {
    await setup({
      officials: [
        { officeType: "senate", party: "right", characterId: "a", state: "CT" },
        { officeType: "senate", party: "left", characterId: "b", state: "DE" },
      ],
      parties: [
        { sequentialId: "left", name: "Left", color: "#111111", economicPosition: -4 },
        { sequentialId: "right", name: "Right", color: "#222222", economicPosition: 4 },
      ],
    });
    const { body } = await call(`${BASE}?country=US`);
    expect(body.upper.current.map((p: { party: string }) => p.party)).toEqual(["left", "right"]);
  });

  it("reports no chamber as in-general when nothing has reached its general phase", async () => {
    await setup();
    const { body } = await call(`${BASE}?country=US`);
    expect(body.lower.inGeneral).toBe(false);
    expect(body.upper.inGeneral).toBe(false);
    expect(body.activeUpperClass).toBeNull();
  });

  it("stamps the requested country onto every party seat row for logo lookup", async () => {
    await setup({
      officials: [{ officeType: "commons", party: "1", characterId: "a", state: "LON" }],
      parties: [{ sequentialId: 1, name: "Labour", color: "#DC241f", economicPosition: -2 }],
    });
    const { body } = await call(`${BASE}?country=UK`);
    expect(body.lower.current[0].countryId).toBe("UK");
  });
});
