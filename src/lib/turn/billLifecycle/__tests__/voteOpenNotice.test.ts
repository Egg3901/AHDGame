import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill } from "@/lib/db/types";

const createNotifications = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...args: unknown[]) => createNotifications(...args),
}));

const { notifyBillsVoteOpen, notifyChambersVoteOpen } = await import("../lifecycleHelpers");

/**
 * The chamber name in this notice was hardcoded to House/Senate, so every
 * non-US legislature announced its own vote as the Senate. Latent while only
 * the US reached it; PR3 fans the notice across an entire bloc.
 */
describe("notifyChambersVoteOpen", () => {
  const characterId = new ObjectId();
  const userId = new ObjectId();

  const setup = (countryId: string, officeType: string) => {
    const db = createMockDb();
    db.collection("electedOfficials");
    db.collection("characters");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ characterId, officeType, countryId }],
      }),
      toArray: async () => [{ characterId, officeType, countryId }],
    });
    db.collectionMocks["characters"]!.find.mockReturnValue({
      toArray: async () => [{ _id: characterId, userId }],
    });
    return db;
  };

  const bill = (countryId: string): Bill =>
    ({
      _id: new ObjectId(),
      title: "Join the Conflict",
      countryId,
    }) as unknown as Bill;

  beforeEach(() => createNotifications.mockClear());

  it("names the country's own lower chamber", async () => {
    const db = setup("UK", "commons");
    await notifyChambersVoteOpen(db as never, bill("UK"), "commons");

    const [rows] = createNotifications.mock.calls[0] as [{ message: string }[]];
    expect(rows[0]!.message).toContain("House of Commons");
    expect(rows[0]!.message).not.toContain("Senate");
  });

  it("still names the US chambers correctly", async () => {
    const db = setup("US", "senate");
    await notifyChambersVoteOpen(db as never, bill("US"), "senate");

    const [rows] = createNotifications.mock.calls[0] as [{ message: string }[]];
    expect(rows[0]!.message).toContain("Senate");
  });

  it("batches several openings without duplicating a multi-row office holder", async () => {
    const db = setup("US", "house");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: async () => [
        { characterId, officeType: "house", countryId: "US" },
        { characterId, officeType: "house", countryId: "US" },
      ],
    });

    await notifyBillsVoteOpen(db as never, [
      { bill: bill("US"), chamberType: "house" },
      { bill: bill("US"), chamberType: "house" },
    ]);

    const [rows] = createNotifications.mock.calls[0] as [{ message: string }[]];
    expect(rows).toHaveLength(2);
  });
});
