import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureIndexMock } = vi.hoisted(() => ({ ensureIndexMock: vi.fn() }));

vi.mock("./helpers", () => ({ ensureIndex: ensureIndexMock }));

import { seedPerfIndexes } from "./performance";

describe("seedPerfIndexes", () => {
  beforeEach(() => ensureIndexMock.mockReset());

  it("supports iteration-scoped successful clock repair without a blocking sort", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    await seedPerfIndexes(db, () => {});
    expect(ensureIndexMock).toHaveBeenCalledWith(
      db,
      "turnLogs",
      {
        success: 1,
        "iteration.type": 1,
        "iteration.number": 1,
        turn: -1,
        gameTime: -1,
      },
      expect.any(Object),
      expect.any(Function)
    );
  });

  /**
   * `manifestos` shipped with no index beyond `_id`, so every read — the point
   * lookup on save/lock and the batch `$in` behind the elections page — was a
   * collection scan. The elections page issues one of those per contested race.
   */
  it("indexes the manifestos lookup key so the elections page stops scanning", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    await seedPerfIndexes(db, () => {});

    const call = ensureIndexMock.mock.calls.find((c) => c[1] === "manifestos");
    expect(call, "no manifestos index is seeded").toBeTruthy();
    expect(call![2]).toEqual({ countryId: 1, electionId: 1, party: 1 });
  });

  /**
   * `electedOfficials` carried indexes on characterId, nppId and a text index,
   * but nothing on `party`. The party growth frontier asks "which regions hold
   * an office for this party" on every party hub load, every recruitment and
   * relocation picker, and every join or recruit attempt, so without this each
   * of those is a full collection scan.
   */
  it("indexes electedOfficials by party and region for the growth frontier", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    await seedPerfIndexes(db, () => {});

    const call = ensureIndexMock.mock.calls.find(
      (c) => c[1] === "electedOfficials" && c[3]?.name === "electedOfficials_party_state"
    );
    expect(call, "no electedOfficials party/state index is seeded").toBeTruthy();
    expect(call![2]).toEqual({ party: 1, state: 1 });
  });

  it("recreates election result snapshot indexes after a world reset", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    await seedPerfIndexes(db, () => {});

    const calls = ensureIndexMock.mock.calls.filter((c) => c[1] === "electionResultSnapshots");
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          db,
          "electionResultSnapshots",
          { electionId: 1 },
          { unique: true, name: "election_result_snapshot_election" },
        ]),
        expect.arrayContaining([
          db,
          "electionResultSnapshots",
          { countryId: 1, electionType: 1, cycle: -1 },
          { name: "election_result_snapshot_history" },
        ]),
      ])
    );
  });
});
