import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => ({
  ...(await vi.importActual<object>("@/lib/db/partyLookup")),
  findPartyBySequentialId: vi.fn(),
}));
vi.mock("@/lib/parties/partyFrontier", () => ({
  getPartyFrontier: vi.fn().mockResolvedValue({ presence: new Set(), frontier: new Set() }),
  isInFrontier: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/parties/antiAbuseGuards", () => ({
  getPartyNppControlStatus: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/npp/partyCapacity", async () => ({
  ...(await vi.importActual<object>("@/lib/npp/partyCapacity")),
  getPartyNppCapacity: vi.fn().mockResolvedValue({ activeMemberCount: 1, maxNpps: 5 }),
}));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn().mockResolvedValue(42) }));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_tx, fallback) => fallback()),
}));

const chairId = new ObjectId();
type RosterRow = {
  countryId?: string;
  party: string;
  homeState: string;
  retiredAt?: Date | null;
};
const endpoints = [
  "national status",
  "regional status",
  "region picker",
  "national recruit",
  "regional recruit",
] as const;
type Endpoint = (typeof endpoints)[number];

async function invoke(endpoint: Endpoint, code: string, stateId: string) {
  const request = new Request("http://localhost/api/recruitment", {
    method: endpoint.endsWith("recruit") ? "POST" : "GET",
    ...(endpoint.endsWith("recruit")
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stateId }) }
      : {}),
  });
  const national = { params: Promise.resolve({ code, id: "10" }) };
  const regional = { params: Promise.resolve({ code, id: stateId, partyId: "10" }) };
  switch (endpoint) {
    case "national status":
      return (await import("./route")).GET(request, national);
    case "region picker":
      return (await import("./states/route")).GET(request, national);
    case "national recruit":
      return (await import("./recruit/route")).POST(request, national);
    case "regional status":
      return (await import("../../../region/[id]/party/[partyId]/recruitment/route")).GET(
        request,
        regional
      );
    case "regional recruit":
      return (await import("../../../region/[id]/party/[partyId]/recruitment/route")).POST(
        request,
        regional
      );
  }
}

describe.each([
  { code: "uk", countryId: "UK", stateId: "SCO" },
  { code: "us", countryId: "US", stateId: "CA" },
])("recruitment country isolation ($countryId)", ({ code, countryId, stateId }) => {
  let db: MockDb;
  let roster: RosterRow[];
  const matchesRow = (row: RosterRow, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, value]) => {
      if (key === "$or") {
        return (value as Record<string, unknown>[]).some((branch) => matchesRow(row, branch));
      }
      if (typeof value === "object" && value !== null && "$exists" in value) {
        return Object.hasOwn(row, key) === value.$exists;
      }
      return value === null
        ? row[key as keyof RosterRow] == null
        : row[key as keyof RosterRow] === value;
    });
  const matches = (filter: Record<string, unknown>) =>
    roster.filter((row) => matchesRow(row, filter));

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getPartyNppCapacity } = await import("@/lib/npp/partyCapacity");
    vi.mocked(getPartyNppCapacity).mockResolvedValue({ activeMemberCount: 1, maxNpps: 5 });
    db = createMockDb();
    // Same party number and even region key in foreign records must not affect capacity.
    roster = [
      { countryId, party: "10", homeState: stateId },
      ...Array.from({ length: 27 }, () => ({ countryId: "DD", party: "10", homeState: stateId })),
      ...Array.from({ length: 5 }, () => ({ countryId: "AT", party: "10", homeState: stateId })),
      { countryId, party: "10", homeState: stateId, retiredAt: new Date("2026-01-01") },
      { countryId, party: "11", homeState: stateId },
    ];
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 900,
      effectiveNow: new Date("2026-09-19T00:00:00Z"),
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair", countryId, homeState: stateId, party: "10" },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 10,
      countryId,
      name: "Test Party",
      chairId,
      treasury: 100_000_000,
      nppActionPoints: 50,
      economicPosition: 0,
      socialPosition: 0,
    } as never);
    const state = { _id: stateId, countryId, name: "Test Region", population: 1000 };
    const org = {
      stateId,
      countryId,
      partyId: "10",
      organization: 10,
      chairId,
      treasury: 100_000_000,
      nppActionPoints: 50,
    };
    db.collection("states").findOne.mockResolvedValue(state);
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([state]),
    } as never);
    db.collection("statePartyOrg").findOne.mockResolvedValue(org);
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([org]),
    } as never);
    for (const name of ["statePartyOrg", "politicalParties"]) {
      db.collection(name).updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    }
    db.collection("npps").countDocuments.mockImplementation(
      async (filter: Record<string, unknown>) => matches(filter).length
    );
    db.collection("npps").aggregate.mockImplementation(
      (pipeline: { $match: Record<string, unknown> }[]) => {
        const counts = new Map<string, number>();
        for (const row of matches(pipeline[0].$match)) {
          counts.set(row.homeState, (counts.get(row.homeState) ?? 0) + 1);
        }
        return {
          toArray: vi
            .fn()
            .mockResolvedValue([...counts].map(([id, count]) => ({ _id: id, count }))),
        } as never;
      }
    );
  });

  it.each(endpoints)("%s ignores foreign parties with the same ID", async (endpoint) => {
    const response = await invoke(endpoint, code, stateId);
    const body = await response.json();
    expect(response.status).toBe(200);
    if (endpoint.endsWith("recruit")) {
      expect(db.collection("npps").insertOne).toHaveBeenCalledOnce();
      expect(db.collection("npps").insertOne.mock.calls[0][0]).toMatchObject({
        countryId,
        party: "10",
        homeState: stateId,
      });
    } else {
      expect(body).toMatchObject({ partyNPPCount: 1, partyNPPMax: 5, availablePartyNppSlots: 4 });
      if (endpoint === "region picker") {
        expect(body.states[0]).toMatchObject({ canRecruit: true, availableSlots: 1 });
      } else {
        expect(body.canRecruit).toBe(true);
      }
      if (endpoint === "regional status") expect(body.stateNPPCount).toBe(1);
    }
    for (const [filter] of db.collection("npps").countDocuments.mock.calls) {
      expect(filter).toMatchObject({ party: "10", retiredAt: null });
      if (countryId !== "US") expect(filter.countryId).toBe(countryId);
    }
    if (endpoint === "region picker") {
      expect(db.collection("npps").aggregate.mock.calls[0][0][0].$match).toMatchObject({
        party: "10",
        retiredAt: null,
      });
    }
  });

  it.each(endpoints)("%s treats untagged NPPs as US only", async (endpoint) => {
    // One legacy row takes the US region to its two-slot limit, but is foreign to the UK.
    roster.push({ party: "10", homeState: stateId, retiredAt: null });
    const response = await invoke(endpoint, code, stateId);
    const body = await response.json();
    const isUS = countryId === "US";
    if (endpoint.endsWith("recruit")) {
      expect(response.status).toBe(isUS ? 400 : 200);
      if (isUS) {
        expect(body.error).toContain("No recruitment slots");
        expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
      } else {
        expect(db.collection("npps").insertOne).toHaveBeenCalledOnce();
      }
    } else {
      expect(response.status).toBe(200);
      expect(body.partyNPPCount).toBe(isUS ? 2 : 1);
      expect(body.availablePartyNppSlots).toBe(isUS ? 3 : 4);
      if (endpoint === "region picker") expect(body.states[0].availableSlots).toBe(isUS ? 0 : 1);
      if (endpoint === "regional status") expect(body.stateNPPCount).toBe(isUS ? 2 : 1);
    }
  });

  it.each(endpoints)("%s handles a party with no domestic NPPs", async (endpoint) => {
    roster = roster.filter((row) => row.countryId !== countryId);
    const response = await invoke(endpoint, code, stateId);
    expect(response.status).toBe(200);
    const body = await response.json();
    if (!endpoint.endsWith("recruit")) {
      expect(body).toMatchObject({ partyNPPCount: 0, availablePartyNppSlots: 5 });
    }
  });

  it.each(endpoints)("%s blocks recruitment with no active members", async (endpoint) => {
    const { getPartyNppCapacity } = await import("@/lib/npp/partyCapacity");
    vi.mocked(getPartyNppCapacity).mockResolvedValue({ activeMemberCount: 0, maxNpps: 0 });
    const response = await invoke(endpoint, code, stateId);
    const body = await response.json();
    if (endpoint.endsWith("recruit")) {
      expect(response.status).toBe(400);
      expect(body.error).toContain("capacity reached (1/0)");
      expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
    } else {
      expect(body).toMatchObject({ partyNPPMax: 0, availablePartyNppSlots: 0 });
      if (endpoint === "region picker") expect(body.states[0].canRecruit).toBe(false);
      else expect(body.canRecruit).toBe(false);
    }
  });

  it.each(["national recruit", "regional recruit"] as const)(
    "%s still enforces the local party cap",
    async (endpoint) => {
      roster.push(
        ...Array.from({ length: 4 }, () => ({ countryId, party: "10", homeState: "OTHER" }))
      );
      const response = await invoke(endpoint, code, stateId);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("capacity reached (5/5)");
      expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
    }
  );

  it.each(["national recruit", "regional recruit"] as const)(
    "%s still enforces regional slots",
    async (endpoint) => {
      roster.push({ countryId, party: "10", homeState: stateId });
      const response = await invoke(endpoint, code, stateId);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("No recruitment slots");
      expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
    }
  );
});
