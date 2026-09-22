import { expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-20-turn-clock-indexes";

it("leaves dry runs untouched and creates iteration and legacy clock indexes", async () => {
  const db = createMockDb();
  await migration.execute(db as unknown as Db, { dryRun: true });
  expect(db.collectionMocks.turnLogs).toBeUndefined();
  await migration.execute(db as unknown as Db, { dryRun: false });
  const createIndex = db.collectionMocks.turnLogs.createIndex;
  expect(createIndex).toHaveBeenCalledTimes(2);
  expect(createIndex).toHaveBeenCalledWith(
    { success: 1, "iteration.type": 1, "iteration.number": 1, turn: -1, gameTime: -1 },
    { name: "turnLogs_success_iteration_clock" }
  );
  expect(createIndex).toHaveBeenCalledWith(
    { success: 1, turn: -1, gameTime: -1 },
    { name: "turnLogs_success_clock" }
  );
});
