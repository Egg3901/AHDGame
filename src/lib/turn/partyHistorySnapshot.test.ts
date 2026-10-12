import { it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { snapshotPartyHistory } from "./partyHistorySnapshot";

it("includes active successor party history and excludes dissolved countries", async () => {
  const db = createMockDb();
  db.collection("countryGameStates").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { _id: "SCO", status: "active" },
      { _id: "WAL", status: "active" },
      { _id: "UK", dissolvedTurn: 1 },
    ]),
  });
  await snapshotPartyHistory(db as unknown as Db, 100);
  const filter = db.collection("politicalParties").find.mock.calls[0][0];
  expect(filter.countryId.$in).toEqual(expect.arrayContaining(["SCO", "WAL"]));
  expect(filter.countryId.$in).not.toContain("UK");
});
