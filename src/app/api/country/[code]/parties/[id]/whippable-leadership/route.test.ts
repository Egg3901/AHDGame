import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/partyMap", () => ({ getPartyMap: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/congress/houseComposition", () => ({ getHouseComposition: vi.fn() }));
vi.mock("@/lib/congress/senateComposition", () => ({ getSenateComposition: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const MOTION_STARTED = new Date("2026-08-31T00:00:00Z");

const openMotion = {
  _id: "current",
  status: "voting",
  targetSpeakerName: "Sean Oppenheimer",
  filedByName: "Karl Kautsky",
  startedAt: MOTION_STARTED,
  endsAt: new Date("2026-09-02T00:00:00Z"),
  endsOnTurn: 124,
  votes: {},
};

describe("GET /api/country/[code]/parties/[id]/whippable-leadership — motion to vacate", () => {
  let db: MockDb;
  let chairId: ObjectId;

  async function get(code = "us") {
    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/country/${code}/parties/1/whippable-leadership`),
      {
        params: Promise.resolve({ code, id: "1" }),
      }
    );
    return res;
  }

  /** Every leadership item the route can surface, keyed by chamber. */
  async function itemsFor(code = "us") {
    const res = await get(code);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, Array<{ type: string; id: string }>>;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();

    for (const name of [
      "electedOfficials",
      "billWhips",
      "speakerElections",
      "speakerNominations",
      "speakerVacateMotions",
      "houseLeadershipElections",
      "senateLeadershipElections",
      "houseLeadershipNominations",
      "senateLeadershipNominations",
      "cabinetNominations",
      "pmAppointmentVotes",
      "noConfidenceVotes",
    ]) {
      db.collection(name);
    }

    // One seated House member for the party, so lower-chamber items surface.
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([{ _id: new ObjectId(), officeType: "house", party: "1" }])
    );
    db.collectionMocks["billWhips"]!.find.mockReturnValue(makeCursor([]));
    for (const name of [
      "speakerElections",
      "houseLeadershipElections",
      "senateLeadershipElections",
      "houseLeadershipNominations",
      "senateLeadershipNominations",
      "cabinetNominations",
      "pmAppointmentVotes",
      "noConfidenceVotes",
    ]) {
      db.collectionMocks[name]!.find.mockReturnValue(makeCursor([]));
      db.collectionMocks[name]!.findOne.mockResolvedValue(null);
    }
    db.collectionMocks["speakerVacateMotions"]!.findOne.mockResolvedValue(openMotion);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 100,
      effectiveNow: new Date("2026-09-01T00:00:00Z"),
    } as never);

    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      composition: [{ party: "1", partyName: "Party One" }],
      majorityParty: "1",
      majorityBloc: null,
    } as never);
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    vi.mocked(getSenateComposition).mockResolvedValue({
      composition: [{ party: "1", partyName: "Party One" }],
      majorityParty: "1",
      majorityBloc: null,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: false, character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);
  });

  it("surfaces active Supreme Court nominations for Senate whips", async () => {
    const nominationId = new ObjectId();
    db.collection("scotusNominations").find.mockReturnValue(
      makeCursor([
        {
          _id: nominationId,
          countryId: "US",
          status: "active",
          nomineeName: "Test Nominee",
          votingEndsOnTurn: 124,
          votes: {},
        },
      ])
    );
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([{ _id: new ObjectId(), officeType: "senate", party: "1" }])
    );
    const result = await itemsFor();
    expect(result.senate).toContainEqual(
      expect.objectContaining({
        id: nominationId.toString(),
        type: "Supreme Court: Test Nominee",
        chamber: "senate",
        canWhip: true,
      })
    );
  });

  it("hides expired Supreme Court nominations and scopes the query to active US votes", async () => {
    db.collection("scotusNominations").find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          status: "active",
          votingEndsOnTurn: 99,
        },
      ])
    );
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([{ _id: new ObjectId(), officeType: "senate", party: "1" }])
    );
    const result = await itemsFor();
    expect(result.senate).toEqual([]);
    expect(db.collectionMocks.scotusNominations!.find).toHaveBeenCalledWith({
      countryId: "US",
      status: "active",
    });
  });

  it("shows Supreme Court nominees for a player-only Senate delegation and preserves attempt summaries", async () => {
    const nominationId = new ObjectId();
    db.collection("scotusNominations").find.mockReturnValue(
      makeCursor([
        {
          _id: nominationId,
          countryId: "US",
          status: "active",
          nomineeName: "Test Nominee",
          votingEndsOnTurn: 124,
        },
      ])
    );
    db.collectionMocks.electedOfficials!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          characterId: new ObjectId(),
          isNPP: false,
          officeType: "senate",
          party: "1",
        },
      ])
    );
    db.collectionMocks.billWhips!.find.mockReturnValue(
      makeCursor(
        [1, 2].map((attemptNumber) => ({
          targetType: "scotusNomination",
          targetId: nominationId,
          chamber: "senate",
          audience: "npp",
          attemptNumber,
        }))
      )
    );
    const result = await itemsFor();
    expect(result.senate[0]).toMatchObject({
      targetType: "scotusNomination",
      canWhip: false,
      nppWhip: { canWhip: false, existingWhips: [{ attemptNumber: 1 }, { attemptNumber: 2 }] },
      playerWhip: { canWhip: true, existingWhips: [] },
    });
  });

  it("surfaces the open motion on the House chamber", async () => {
    const result = await itemsFor();
    const vacate = result.house.find((i) => i.type === "speakerVacateMotion");

    expect(vacate).toBeDefined();
    expect(vacate).toMatchObject({
      id: "current",
      chamber: "house",
      canWhip: true,
    });
  });

  it("names the Speaker under threat so the panel header is readable", async () => {
    const result = (await itemsFor()) as unknown as Record<
      string,
      Array<{ type: string; candidacies: Array<{ nomineeName: string }> }>
    >;
    const vacate = result.house.find((i) => i.type === "speakerVacateMotion")!;

    expect(vacate.candidacies[0].nomineeName).toBe("Motion to vacate Sean Oppenheimer");
  });

  it("hides a motion whose voting window has closed", async () => {
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 130,
      effectiveNow: new Date("2026-09-03T00:00:00Z"),
    } as never);

    const result = await itemsFor();
    expect(result.house.find((i) => i.type === "speakerVacateMotion")).toBeUndefined();
  });

  it("hides a resolved motion", async () => {
    db.collectionMocks["speakerVacateMotions"]!.findOne.mockResolvedValue(null);

    const result = await itemsFor();
    expect(result.house.find((i) => i.type === "speakerVacateMotion")).toBeUndefined();
  });

  it("ignores whips issued before this motion opened when counting attempts", async () => {
    // Two whips exist on the same singleton key but predate this motion, so
    // they belong to a previous motion and must not exhaust the cap (#959).
    db.collectionMocks["billWhips"]!.find.mockReturnValue(
      makeCursor([
        {
          targetType: "speakerVacateMotion",
          targetId: "current",
          chamber: "house",
          attemptNumber: 1,
          audience: "npp",
          createdAt: new Date("2026-08-01T00:00:00Z"),
        },
        {
          targetType: "speakerVacateMotion",
          targetId: "current",
          chamber: "house",
          attemptNumber: 2,
          audience: "npp",
          createdAt: new Date("2026-08-02T00:00:00Z"),
        },
      ])
    );

    const result = await itemsFor();
    const vacate = result.house.find((i) => i.type === "speakerVacateMotion");

    expect(vacate).toMatchObject({ canWhip: true });
  });

  it("counts whips issued during this motion against the cap", async () => {
    db.collectionMocks["billWhips"]!.find.mockReturnValue(
      makeCursor([
        {
          targetType: "speakerVacateMotion",
          targetId: "current",
          chamber: "house",
          attemptNumber: 1,
          audience: "npp",
          createdAt: new Date("2026-08-31T06:00:00Z"),
        },
        {
          targetType: "speakerVacateMotion",
          targetId: "current",
          chamber: "house",
          attemptNumber: 2,
          audience: "npp",
          createdAt: new Date("2026-08-31T07:00:00Z"),
        },
      ])
    );

    const result = await itemsFor();
    const vacate = result.house.find((i) => i.type === "speakerVacateMotion");

    expect(vacate).toMatchObject({ canWhip: false });
  });

  it("never surfaces a vacate motion for a non-US country", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "UK",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      makeCursor([{ _id: new ObjectId(), officeType: "commons", party: "1" }])
    );

    const result = await itemsFor("uk");
    for (const items of Object.values(result)) {
      expect(items.find((i) => i.type === "speakerVacateMotion")).toBeUndefined();
    }
    expect(db.collectionMocks.scotusNominations).toBeUndefined();
    // The US-only collection must not even be consulted outside the US.
    expect(db.collectionMocks["speakerVacateMotions"]!.findOne).not.toHaveBeenCalled();
  });
});
