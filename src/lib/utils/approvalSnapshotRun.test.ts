import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ConflictDoc } from "@/lib/db/types/conflict";

vi.mock("@/lib/utils/governmentApproval", () => ({
  snapshotApprovalHistory: vi.fn().mockResolvedValue(undefined),
}));

import { snapshotApprovalsForTurn } from "./approvalSnapshotRun";
import { snapshotApprovalHistory } from "@/lib/utils/governmentApproval";

function cursorOf<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const conflict = (over: Partial<ConflictDoc> = {}): ConflictDoc =>
  ({
    _id: "war_us_dd_415",
    status: "active",
    hostCountry: "DE",
    sideA: { label: "US", countries: ["US"], kind: "state" },
    sideB: { label: "East", countries: ["DD", "RU"], kind: "coalition" },
    startTurn: 415,
    ...over,
  }) as unknown as ConflictDoc;

let db: MockDb;

/**
 * `governmentApprovals` is read twice with different filters: once with no
 * filter to find every country that already has a document, and once scoped to
 * the guests when deciding who to release. The mock answers on the filter so a
 * test can drive the two independently.
 */
function wire(options: {
  conflicts?: ConflictDoc[];
  documented?: string[];
  exhaustion?: Record<string, number>;
  seeded?: string[];
}) {
  const { conflicts = [], documented = [], exhaustion = {}, seeded = [] } = options;
  db.collection("conflicts").find.mockReturnValue(cursorOf(conflicts));
  db.collection("governmentApprovals").find.mockImplementation(
    (filter: Record<string, unknown>) => {
      const scoped = filter && Object.keys(filter).length > 0;
      if (!scoped) return cursorOf(documented.map((id) => ({ _id: id })));
      const ids = (filter._id as { $in: string[] })?.$in ?? [];
      return cursorOf(ids.map((id) => ({ _id: id, warExhaustion: exhaustion[id] ?? 0 })));
    }
  );
  db.collection("states").distinct.mockResolvedValue(seeded);
  db.collection("stateMetrics").distinct.mockResolvedValue(seeded);
}

const ACTIVE = ["US", "UK", "JP", "DE", "IE", "CN"];

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(snapshotApprovalHistory).mockResolvedValue(undefined);
});

describe("snapshotApprovalsForTurn", () => {
  const run = () => snapshotApprovalsForTurn(db as unknown as Db, 500);
  const snapshotted = () =>
    vi.mocked(snapshotApprovalHistory).mock.calls.map((call) => call[1] as string);
  const deleted = (): string[] => {
    const calls = db.collection("governmentApprovals").deleteMany.mock.calls as Array<
      [{ _id?: { $in?: string[] } }]
    >;
    return calls.flatMap((call) => call[0]?._id?.$in ?? []);
  };

  it("snapshots every active country when nothing else is going on", async () => {
    wire({ documented: ACTIVE });
    const result = await run();
    expect(snapshotted().sort()).toEqual([...ACTIVE].sort());
    expect(result.countriesProcessed).toBe(ACTIVE.length);
    expect(result.guestsReleased).toEqual([]);
  });

  it("keeps a peaceful seeded NPP country in the permanent snapshot roster", async () => {
    wire({ seeded: ["DD", "ZZ"] });
    const result = await run();
    expect(snapshotted()).toContain("DD");
    expect(snapshotted()).not.toContain("ZZ");
    expect(result.guestsReleased).toEqual([]);
  });

  it("keeps a documented seeded country stored instead of treating it as a releasable guest", async () => {
    wire({ seeded: ["DD"], documented: ["DD"] });
    const result = await run();
    expect(snapshotted()).toEqual(expect.arrayContaining(["DD"]));
    expect(result.guestsReleased).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it("pulls in a belligerent that is not a playable country", async () => {
    wire({ conflicts: [conflict()], documented: ACTIVE });
    await run();
    expect(snapshotted()).toContain("DD");
    expect(snapshotted()).toContain("RU");
  });

  it("pulls in an inactive belligerent while its defeat modifier is active", async () => {
    wire({
      conflicts: [
        conflict({
          status: "resolved",
          endTurn: 500,
          outcome: { winner: "A", note: "" },
        }),
      ],
    });
    await run();
    expect(snapshotted()).toContain("RU");
  });

  it("does not release a guest that is still fighting", async () => {
    wire({ conflicts: [conflict()], documented: [...ACTIVE, "DD", "RU"] });
    const result = await run();
    expect(result.guestsReleased).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it("keeps snapshotting a guest whose war is over but whose exhaustion remains", async () => {
    wire({ documented: [...ACTIVE, "DD"], exhaustion: { DD: -1.4 } });
    const result = await run();
    expect(snapshotted()).toContain("DD");
    expect(result.guestsReleased).toEqual([]);
  });

  /**
   * The regression. A guest whose war ended on a turn its exhaustion read
   * exactly zero used to fall out of the snapshot roster entirely — and release
   * only ever runs for countries ON that roster, so its document stayed on disk
   * with nothing left that could remove it. `loadNationalApproval` prefers a
   * stored rating over its live recompute, so that country's page would have
   * been pinned to its last wartime number for the rest of the game.
   */
  it("releases a guest whose war is over and whose exhaustion has healed", async () => {
    wire({ documented: [...ACTIVE, "DD"], exhaustion: { DD: 0 } });
    const result = await run();
    expect(snapshotted()).toContain("DD");
    expect(result.guestsReleased).toEqual(["DD"]);
    expect(deleted()).toEqual(["DD"]);
  });

  it("never releases an active country, however its document reads", async () => {
    wire({ documented: ACTIVE, exhaustion: Object.fromEntries(ACTIVE.map((id) => [id, 0])) });
    const result = await run();
    expect(result.guestsReleased).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  it("ignores a belligerent that is not a country this game models", async () => {
    const withStranger = conflict({
      sideB: { label: "x", countries: ["ZZ"], kind: "state" },
    } as unknown as Partial<ConflictDoc>);
    wire({ conflicts: [withStranger], documented: ACTIVE });
    await run();
    expect(snapshotted()).not.toContain("ZZ");
  });

  it("reports the roster it actually processed, not a fixed country count", async () => {
    wire({ conflicts: [conflict()], documented: ACTIVE });
    const result = await run();
    expect(result.countriesProcessed).toBe(ACTIVE.length + 2);
    expect(snapshotted()).toHaveLength(result.countriesProcessed);
  });

  it("does not touch the collection when there is nothing to release", async () => {
    wire({ documented: ACTIVE });
    await run();
    expect(db.collection("governmentApprovals").deleteMany).not.toHaveBeenCalled();
  });
});
