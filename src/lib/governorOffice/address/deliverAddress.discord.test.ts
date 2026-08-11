import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

// Mock only the Discord sender; keep DISCORD_COLORS / the embed builder real so
// the national address embed is genuinely constructed.
vi.mock("@/lib/discordWebhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discordWebhooks")>();
  return { ...actual, sendCountryGameEvent: vi.fn().mockResolvedValue(undefined) };
});

import { deliverAddress } from "./deliverAddress";
import { sendCountryGameEvent } from "@/lib/discordWebhooks";

/** Minimal mock Db sufficient for an address with no demographic target. */
function makeMockDb(seed: { currentTurn: number }) {
  const collections: Record<string, unknown> = {
    gameState: {
      findOne: vi.fn().mockResolvedValue({ _id: "current", currentTurn: seed.currentTurn }),
    },
    governorAddresses: {
      find: vi.fn(() => ({
        sort: vi.fn(() => ({
          limit: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        })),
      })),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    },
    governorOfficeState: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    characters: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
  };
  return {
    collection: vi.fn((name: string) => collections[name]),
  } as unknown as Db;
}

describe("deliverAddress — Discord country Game Events", () => {
  beforeEach(() => {
    vi.mocked(sendCountryGameEvent).mockClear();
  });

  it("posts the national (head-of-government) address to the country game-events webhook", async () => {
    const db = makeMockDb({ currentTurn: 100 });

    const result = await deliverAddress(db, {
      countryId: "UK",
      stateId: "uk_national", // national pseudo-state id for UK
      character: { _id: new ObjectId(), name: "PM Jane Smith", party: "1" },
      title: "A New Dawn",
      body: "My fellow citizens.",
      emphasizedCategories: ["economic"],
    });

    expect(result.status).toBe(200);
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
    const [countryArg, embedArg] = vi.mocked(sendCountryGameEvent).mock.calls[0];
    expect(countryArg).toBe("UK");
    expect(embedArg.title).toContain("A New Dawn");
    expect(embedArg.description).toContain("My fellow citizens.");
  });

  it("does NOT post a regional (governor) address to the country game-events webhook", async () => {
    const db = makeMockDb({ currentTurn: 100 });

    const result = await deliverAddress(db, {
      countryId: "US",
      stateId: "CA", // a real state → regional governor address
      character: { _id: new ObjectId(), name: "Governor Doe", party: "1" },
      title: "State of the State",
      body: "Fellow Californians.",
      emphasizedCategories: ["economic"],
    });

    expect(result.status).toBe(200);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });
});
