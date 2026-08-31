import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { processGovernorAPRegen } from "./governorAPRegen";

describe("processGovernorAPRegen", () => {
  it("claims the AP snapshot before writing the regenerated value", async () => {
    const db = createMockDb();
    const officeId = new ObjectId();
    const cursor = {
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: officeId,
          gubernatorialActions: 2,
          lastActionGrantedTurn: 10,
        },
      ]),
    };
    db.collection("governorOfficeState").find.mockReturnValue(cursor);

    await processGovernorAPRegen(db as unknown as Db, 30);

    const [operations] = db.collectionMocks.governorOfficeState.bulkWrite.mock.calls[0];
    expect(operations[0].updateOne.filter).toEqual({
      _id: officeId,
      gubernatorialActions: 2,
      lastActionGrantedTurn: 10,
    });
    expect(operations[0].updateOne.update.$set.gubernatorialActions).toBe(3);
  });
});
