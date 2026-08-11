import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("botApiAuth", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("botApiKeys");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects stored bot API keys with an invalid scope", async () => {
    db.collectionMocks.botApiKeys!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: new ObjectId(),
      scope: "broken-scope",
      revokedAt: null,
    });

    const { requireBotApiAccess } = await import("./botApiAuth");
    const result = await requireBotApiAccess(
      new Request("http://localhost/api/discord-bot/elections", {
        headers: { "X-Bot-Token": "ahd_bot_test" },
      })
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(db.collectionMocks.botApiKeys!.updateOne).not.toHaveBeenCalled();
  });
});
