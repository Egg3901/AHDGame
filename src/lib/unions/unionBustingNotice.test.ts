import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { notifyUnionOfBustingAttempt } from "./unionBustingNotice";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

const presidentId = new ObjectId();
const organizerId = new ObjectId();
const presidentUserId = new ObjectId();
const organizerUserId = new ObjectId();
const employerId = new ObjectId();

function mockDb({
  union,
  organizers = [{ characterId: organizerId }],
  characters = [
    { _id: presidentId, userId: presidentUserId },
    { _id: organizerId, userId: organizerUserId },
  ],
}: {
  union: Record<string, unknown> | null;
  organizers?: Array<{ characterId: ObjectId }>;
  characters?: Array<{ _id: ObjectId; userId?: ObjectId }>;
}) {
  const organizerFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(organizers) });
  const db = {
    collection: (name: string) => {
      if (name === "unions") return { findOne: vi.fn().mockResolvedValue(union) };
      if (name === "unionOrganizers") return { find: organizerFind };
      if (name === "characters") {
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(characters) }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, organizerFind };
}

const baseInput = {
  countryId: "US" as const,
  sectorType: "manufacturing",
  employerName: "Amalgamated Steel",
  employerId,
  success: true,
  unionizationBefore: 50,
  unionizationAfter: 30,
};

describe("notifyUnionOfBustingAttempt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names the employer to the president and every organizer holding strength", async () => {
    const { createNotifications } = await import("@/lib/notifications");
    const { db, organizerFind } = mockDb({
      union: { _id: new ObjectId(), name: "US Manufacturing Workers", ownerId: presidentId },
    });

    const sent = await notifyUnionOfBustingAttempt(db, baseInput);
    // Only organizers with banked strength count as the union's electorate.
    expect(organizerFind.mock.calls[0][0]).toMatchObject({ strength: { $gt: 0 } });

    expect(sent).toBe(2);
    const inputs = vi.mocked(createNotifications).mock.calls[0][0];
    expect(inputs.map((i) => i.userId)).toStrictEqual([presidentUserId, organizerUserId]);
    for (const input of inputs) {
      expect(input.type).toBe("union_busting_attempted");
      expect(input.message).toContain("Amalgamated Steel");
      expect(input.metadata).toMatchObject({
        employerCorporationName: "Amalgamated Steel",
        employerCorporationId: employerId.toString(),
        success: true,
      });
    }
  });

  it("says a backfire happened rather than a loss", async () => {
    const { createNotifications } = await import("@/lib/notifications");
    const { db } = mockDb({
      union: { _id: new ObjectId(), name: "US Manufacturing Workers", ownerId: presidentId },
    });

    await notifyUnionOfBustingAttempt(db, {
      ...baseInput,
      success: false,
      unionizationBefore: 50,
      unionizationAfter: 65,
    });

    const inputs = vi.mocked(createNotifications).mock.calls[0][0];
    expect(inputs[0].title).toBe("Union-busting backfired");
    expect(inputs[0].message).toContain("failed");
    expect(inputs[0].message).toContain("15 points");
  });

  it("skips the NPP owner but still reaches player organizers", async () => {
    const { createNotifications } = await import("@/lib/notifications");
    const { db } = mockDb({
      union: {
        _id: new ObjectId(),
        name: "US Manufacturing Workers",
        ownerId: new ObjectId(),
        ownerType: "npp",
      },
      characters: [{ _id: organizerId, userId: organizerUserId }],
    });

    const sent = await notifyUnionOfBustingAttempt(db, baseInput);
    expect(sent).toBe(1);
    expect(vi.mocked(createNotifications).mock.calls[0][0][0].userId).toStrictEqual(
      organizerUserId
    );
  });

  it("is a no-op when no union organizes the sector", async () => {
    const { createNotifications } = await import("@/lib/notifications");
    const { db } = mockDb({ union: null });
    expect(await notifyUnionOfBustingAttempt(db, baseInput)).toBe(0);
    expect(createNotifications).not.toHaveBeenCalled();
  });

  it("never throws when the union read fails", async () => {
    const db = {
      collection: () => ({
        findOne: vi.fn().mockRejectedValue(new Error("mongo down")),
      }),
    } as unknown as Db;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notifyUnionOfBustingAttempt(db, baseInput)).toBe(0);
    spy.mockRestore();
  });
});
