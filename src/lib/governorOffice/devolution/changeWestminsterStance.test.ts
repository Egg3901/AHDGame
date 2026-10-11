import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { changeWestminsterStance } from "./changeWestminsterStance";
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));

describe("atomic Westminster stance changes", () => {
  const setup = () => {
    const db = createMockDb();
    const collection = db.collection("governorOfficeState");
    collection.findOne.mockResolvedValue({
      gubernatorialActions: 2,
      westminsterStances: { WAL: { policy: "pro", changedAtTurn: 99 } },
    });
    collection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    return { db: db as unknown as Db, collection };
  };
  beforeEach(() => vi.clearAllMocks());
  it("changes Scotland without overwriting Wales or its cooldown", async () => {
    const { db, collection } = setup();
    expect(
      (await changeWestminsterStance(db, { stateId: "SCO", policy: "independence" })).status
    ).toBe(200);
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      stateId: "uk_national",
      gubernatorialActions: { $gte: 2 },
      "westminsterStances.SCO.policy": { $exists: false },
      "westminsterStances.SCO.changedAtTurn": { $exists: false },
    });
    expect(update.$set).toHaveProperty("westminsterStances.SCO", {
      policy: "independence",
      changedAtTurn: 100,
    });
    expect(update.$set).not.toHaveProperty("westminsterStances.WAL");
    expect(update.$inc).toEqual({ gubernatorialActions: -2 });
  });
  it("rejects Wales on its own cooldown without spending AP", async () => {
    const { db, collection } = setup();
    expect(
      (await changeWestminsterStance(db, { stateId: "WAL", policy: "independence" })).status
    ).toBe(400);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });
  it("reports a lost concurrent update without claiming success", async () => {
    const { db, collection } = setup();
    collection.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect((await changeWestminsterStance(db, { stateId: "SCO", policy: "pro" })).status).toBe(409);
  });
  it("does not create a national office with a new AP balance when missing", async () => {
    const { db, collection } = setup();
    collection.findOne.mockResolvedValue(null);
    expect((await changeWestminsterStance(db, { stateId: "NIR", policy: "pro" })).status).toBe(409);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });
});
