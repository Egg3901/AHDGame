import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { polesForYear } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const POLES = polesForYear(1979);
const at = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, POLES);
const row = (entityId: string, w: number, e: number) => ({ entityId, shares: at(w, e) });

describe("closeDueCrises", () => {
  let db: MockDb;

  const crises = (rows: object[]) =>
    db.collection("alignmentCrises").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    crises([]);
  });

  it("closes a crisis whose window has passed", async () => {
    crises([{ _id: "c1", targetEntityId: "YU", status: "open", closesTurn: 10 }]);
    const { closeDueCrises } = await import("./crisisTurn");
    const r = await closeDueCrises(db as unknown as Db, { currentTurn: 12 });

    expect(r.crisesResolved).toBe(1);
    const set = (
      db.collection("alignmentCrises").updateOne.mock.calls[0]![1] as {
        $set: { status: string; resolvedTurn: number };
      }
    ).$set;
    expect(set.status).toBe("resolved");
    expect(set.resolvedTurn).toBe(12);
  });

  it("leaves a crisis whose window is still open", async () => {
    const { closeDueCrises } = await import("./crisisTurn");
    const r = await closeDueCrises(db as unknown as Db, { currentTurn: 5 });
    expect(r.crisesResolved).toBe(0);
  });

  it("pays out nothing — a crisis lifts a ceiling, it does not grant ground", async () => {
    crises([{ _id: "c1", targetEntityId: "YU", status: "open", closesTurn: 10 }]);
    const { closeDueCrises } = await import("./crisisTurn");
    const r = await closeDueCrises(db as unknown as Db, { currentTurn: 12 });
    expect(Object.keys(r)).toEqual(["crisesResolved"]);
  });
});

describe("openCrisisTargets", () => {
  it("names every nation currently in a crisis", async () => {
    const db = createMockDb();
    db.collection("alignmentCrises").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { targetEntityId: "YU", status: "open" },
        { targetEntityId: "HU", status: "open" },
      ]),
    });
    const { openCrisisTargets } = await import("./crisisTurn");
    const targets = await openCrisisTargets(db as unknown as Db);
    expect([...targets].sort()).toEqual(["HU", "YU"]);
  });
});

describe("openDueCrises", () => {
  let db: MockDb;

  const crises = (rows: object[]) =>
    db.collection("alignmentCrises").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const opened = () =>
    db
      .collection("alignmentCrises")
      .insertOne.mock.calls.map(
        (c: unknown[]) =>
          c[0] as { kind: string; targetEntityId: string; retargetedFrom: string | null }
      );

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    crises([]);
  });

  const call = async (over: Record<string, unknown> = {}) => {
    const { openDueCrises } = await import("./crisisTurn");
    return openDueCrises(
      db as unknown as Db,
      {
        currentTurn: 100,
        year: 1979,
        rows: [],
        memberships: [],
        ...over,
      } as never
    );
  };

  it("opens nothing in a quiet world", async () => {
    const r = await call({ rows: [row("US", 90, 2)] });
    expect(r.crisesOpened).toBe(0);
  });

  it("opens a tug-of-war over a nation two blocs are dug into", async () => {
    const r = await call({ rows: [row("YU", 32, 30)] });
    expect(r.crisesOpened).toBe(1);
    expect(opened()[0]!.kind).toBe("emergent.tugOfWar");
    expect(opened()[0]!.targetEntityId).toBe("YU");
  });

  it("opens a defection crisis for a member halfway out the door", async () => {
    const r = await call({
      rows: [row("TR", 30, 20)],
      memberships: [{ organizationId: "NATO", countryId: "TR", wantsOutSinceTurn: 80 }],
    });
    expect(r.crisesOpened).toBe(1);
    expect(opened()[0]!.kind).toBe("emergent.defection");
  });

  it("leaves a member alone until it is halfway out", async () => {
    const r = await call({
      rows: [row("TR", 30, 20)],
      memberships: [{ organizationId: "NATO", countryId: "TR", wantsOutSinceTurn: 95 }],
    });
    expect(r.crisesOpened).toBe(0);
  });

  it("retargets an authored anchor whose nation is not in the world", async () => {
    // 1956-58: Hungary and Suez are both in window; neither HU nor EG is present.
    const r = await call({ year: 1957, rows: [row("YU", 34, 32)] });
    expect(r.crisesOpened).toBeGreaterThanOrEqual(1);
    const first = opened()[0]!;
    expect(first.kind).toMatch(/^crisis\./);
    expect(first.targetEntityId).toBe("YU");
    expect(first.retargetedFrom).toBeTruthy();
  });

  it("uses an authored anchor's own nation when it is present and movable", async () => {
    const r = await call({ year: 1957, rows: [row("HU", 30, 40)] });
    expect(r.crisesOpened).toBeGreaterThanOrEqual(1);
    const hungarian = opened().find((c: { kind: string }) => c.kind === "crisis.hungarianRising")!;
    expect(hungarian.targetEntityId).toBe("HU");
    expect(hungarian.retargetedFrom).toBeNull();
  });

  it("never opens a second crisis on the same nation", async () => {
    crises([{ _id: "c1", targetEntityId: "YU", status: "open" }]);
    const r = await call({ rows: [row("YU", 32, 30)] });
    expect(r.crisesOpened).toBe(0);
  });

  it("never opens one on a nation nothing could move", async () => {
    // Locked: the crisis would resolve into a no-op.
    const r = await call({ rows: [row("PL", 2, 90)] });
    expect(r.crisesOpened).toBe(0);
  });

  it("respects the global cap so the desk never floods", async () => {
    const { MAX_OPEN_CRISES } = await import("./crisisTurn");
    const many = Array.from({ length: 10 }, (_, i) => row(`X${i}`, 32, 30));
    const r = await call({ rows: many });
    expect(r.crisesOpened).toBe(MAX_OPEN_CRISES);
  });

  it("opens no more once the cap is already met", async () => {
    const { MAX_OPEN_CRISES } = await import("./crisisTurn");
    crises(
      Array.from({ length: MAX_OPEN_CRISES }, (_, i) => ({
        _id: `c${i}`,
        targetEntityId: `Z${i}`,
        status: "open",
      }))
    );
    const r = await call({ rows: [row("YU", 32, 30)] });
    expect(r.crisesOpened).toBe(0);
  });

  it("runs an authored anchor once per world, not once per turn", async () => {
    crises([
      { _id: "c0", kind: "crisis.hungarianRising", targetEntityId: "HU", status: "resolved" },
    ]);
    const r = await call({ year: 1957, rows: [row("HU", 30, 40)] });
    expect(opened().some((c: { kind: string }) => c.kind === "crisis.hungarianRising")).toBe(false);
    void r;
  });
});
