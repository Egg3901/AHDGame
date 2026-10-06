import { expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedGameConfig } from "./seedGameConfig";
it("enables era pricing on fresh worlds without changing an existing world's flag", async () => {
  const db = createMockDb();
  await seedGameConfig(db as never, false, vi.fn(), "1953-default");
  const [, update] = db.collection("gameConfig").updateOne.mock.calls[0];
  expect(update.$set.campaignEraPriceLevelEnabled).toBeUndefined();
  expect(update.$setOnInsert.campaignEraPriceLevelEnabled).toBe(true);
});

it("inserts fresh-world flags without flipping a running world's gates", async () => {
  const db = createMockDb();
  await seedGameConfig(db as never, false, vi.fn(), "1991-default");
  const [, update] = db.collection("gameConfig").updateOne.mock.calls[0];
  expect(update.$set).not.toHaveProperty("treasuryCashLedgerEnabled");
  expect(update.$set).not.toHaveProperty("adminRegistrationEnabled");
  expect(update.$setOnInsert.treasuryCashLedgerEnabled).toBe(true);
  expect(update.$set.startingFunds).toBeGreaterThan(0);
});
