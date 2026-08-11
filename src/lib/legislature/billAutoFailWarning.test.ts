import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getBillProposalAutoFailWarning } from "./billAutoFailWarning";

describe("getBillProposalAutoFailWarning", () => {
  it("warns immediately for lower-chamber-origin bills when the lower-chamber election resolves soon", async () => {
    const db = createMockDb();
    const proposedAt = new Date("2026-04-25T12:00:00.000Z");
    const electionEndsAt = new Date("2026-04-26T00:00:00.000Z");

    db.collectionMocks.elections = db.collection("elections");
    db.collectionMocks.elections.findOne.mockResolvedValue({
      electionType: "commons",
      status: "upcoming",
      endTime: electionEndsAt,
    });

    const warning = await getBillProposalAutoFailWarning(
      db as unknown as Db,
      "UK",
      "commons",
      proposedAt
    );

    expect(warning).not.toBeNull();
    expect(warning?.countryId).toBe("UK");
    expect(warning?.originChamber).toBe("commons");
    expect(warning?.lowerChamberKey).toBe("commons");
    expect(warning?.electionEndsAt).toBe(electionEndsAt.toISOString());
  });

  it("does not warn for upper-chamber-origin bills before they reach the lower chamber", async () => {
    const db = createMockDb();
    const proposedAt = new Date("2026-04-25T12:00:00.000Z");

    db.collectionMocks.elections = db.collection("elections");
    db.collectionMocks.elections.findOne.mockResolvedValue({
      electionType: "house",
      status: "upcoming",
      endTime: new Date("2026-04-26T00:00:00.000Z"),
    });

    const warning = await getBillProposalAutoFailWarning(
      db as unknown as Db,
      "US",
      "senate",
      proposedAt
    );

    expect(warning).toBeNull();
  });

  it("warns for upper-chamber-origin bills once the lower-chamber exposure window would be hit", async () => {
    const db = createMockDb();
    const proposedAt = new Date("2026-04-25T12:00:00.000Z");
    const electionEndsAt = new Date("2026-04-27T00:00:00.000Z");

    db.collectionMocks.elections = db.collection("elections");
    db.collectionMocks.elections.findOne.mockResolvedValue({
      electionType: "house",
      status: "active",
      endTime: electionEndsAt,
    });

    const warning = await getBillProposalAutoFailWarning(
      db as unknown as Db,
      "US",
      "senate",
      proposedAt
    );

    expect(warning).not.toBeNull();
    expect(warning?.originChamber).toBe("senate");
    expect(warning?.lowerChamberKey).toBe("house");
    expect(warning?.electionStatus).toBe("active");
  });

  it("tracks Japanese upper-house bills against the next Shugiin election window", async () => {
    const db = createMockDb();
    const proposedAt = new Date("2026-04-25T12:00:00.000Z");
    const electionEndsAt = new Date("2026-04-27T06:00:00.000Z");

    db.collectionMocks.elections = db.collection("elections");
    db.collectionMocks.elections.findOne.mockResolvedValue({
      electionType: "snap_shugiin",
      status: "upcoming",
      endTime: electionEndsAt,
    });

    const warning = await getBillProposalAutoFailWarning(
      db as unknown as Db,
      "JP",
      "sangiin",
      proposedAt
    );

    expect(warning).not.toBeNull();
    expect(warning?.lowerChamberKey).toBe("shugiin");
    expect(warning?.electionType).toBe("snap_shugiin");
  });

  it("ignores elections that resolve after the lower-chamber exposure window ends", async () => {
    const db = createMockDb();
    const proposedAt = new Date("2026-04-25T12:00:00.000Z");

    db.collectionMocks.elections = db.collection("elections");
    db.collectionMocks.elections.findOne.mockResolvedValue({
      electionType: "bundestag",
      status: "upcoming",
      endTime: new Date("2026-04-27T18:00:00.000Z"),
    });

    const warning = await getBillProposalAutoFailWarning(
      db as unknown as Db,
      "DE",
      "bundestag",
      proposedAt
    );

    expect(warning).toBeNull();
  });
});
