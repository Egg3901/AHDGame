import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureIndexMock } = vi.hoisted(() => ({ ensureIndexMock: vi.fn() }));

vi.mock("./helpers", () => ({ ensureIndex: ensureIndexMock }));

import { seedPerfIndexes } from "./performance";

describe("seedPerfIndexes", () => {
  beforeEach(() => ensureIndexMock.mockReset());

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
});
