import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeElection } from "@/lib/test-utils/factories";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveElection } from "./resolveElection";

vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("./enrichElection", () => ({
  _enrichElection: vi.fn(async () => ({})),
  fetchDepsForElection: vi.fn(async () => ({})),
}));

describe("resolveElection snap navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 1_228,
      effectiveNow: new Date("2026-09-29T13:00:00.102Z"),
    } as never);
  });

  it("does not resolve a stable seat URL to its cancelled regular race", async () => {
    const db = createMockDb();
    db.collection("elections").findOne.mockResolvedValue(
      makeElection({
        countryId: "UK",
        state: "LON",
        electionType: "snap_commons",
        seatId: "UK-commons-LON",
        cycle: 6,
        status: "resolved",
      })
    );

    await resolveElection(
      db as unknown as Db,
      "UK-commons-LON",
      {
        view: "full",
        userId: null,
      },
      6
    );

    expect(db.collection("elections").findOne).toHaveBeenCalledWith({
      seatId: "UK-commons-LON",
      status: { $ne: "cancelled" },
      cycle: 6,
    });
  });

  it("excludes cancelled races from Previous and Next", async () => {
    const db = createMockDb();
    const election = makeElection({
      countryId: "UK",
      state: "LON",
      electionType: "snap_commons",
      seatId: "UK-commons-LON",
      cycle: 6,
      status: "resolved",
    });
    db.collection("elections").findOne.mockResolvedValue(election);

    await resolveElection(db as unknown as Db, election._id.toString(), {
      view: "full",
      userId: null,
    });

    expect(db.collection("elections").find).toHaveBeenCalledWith({
      seatId: "UK-commons-LON",
      status: { $ne: "cancelled" },
    });
  });

  it("crosses between legacy regular and snap races when seatId is missing", async () => {
    const db = createMockDb();
    const election = makeElection({
      countryId: "UK",
      state: "LON",
      electionType: "snap_commons",
      cycle: 6,
      status: "resolved",
    });
    db.collection("elections").findOne.mockResolvedValue(election);

    await resolveElection(db as unknown as Db, election._id.toString(), {
      view: "full",
      userId: null,
    });

    expect(db.collection("elections").find).toHaveBeenCalledWith({
      countryId: "UK",
      state: "LON",
      electionType: { $in: ["commons", "snap_commons"] },
      status: { $ne: "cancelled" },
    });
  });
});
