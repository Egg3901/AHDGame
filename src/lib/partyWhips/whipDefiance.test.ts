import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill, BillWhip, Character, ElectedOfficial, NPP } from "@/lib/db/types";
import { buildWhipDefianceSnapshot } from "./whipDefiance";

describe("buildWhipDefianceSnapshot", () => {
  it("shows active player defiance for a national soft whip on a bill", async () => {
    const db = createMockDb();
    const whipId = new ObjectId();
    const billId = new ObjectId();
    const characterId = new ObjectId();
    db.collection("billWhips");
    db.collection("bills");
    db.collection("characters");
    db.collection("electedOfficials");

    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () =>
          [
            {
              _id: whipId,
              targetType: "bill",
              targetId: billId,
              chamber: "house",
              direction: "for",
              issuedBy: "nationalParty",
              countryId: "US",
              partyId: "1",
              audience: "character",
              mode: "soft",
              attemptNumber: 1,
              createdAt: new Date("2026-04-29T12:00:00.000Z"),
              updatedAt: new Date("2026-04-29T12:00:00.000Z"),
            } satisfies Omit<BillWhip, "candidacyId">,
          ] as BillWhip[],
      }),
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Infrastructure Act",
      status: "active",
      votes: { [characterId.toString()]: "against" },
    } as unknown as Bill);
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            _id: characterId,
            name: "Dana Roem",
            party: "1",
          } satisfies Pick<Character, "_id" | "name" | "party">,
        ],
      }),
    });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            characterId,
            state: "VA",
            officeType: "house",
          } satisfies Pick<ElectedOfficial, "characterId" | "state" | "officeType">,
        ],
      }),
    });

    const snapshot = await buildWhipDefianceSnapshot(db as unknown as Db, {
      countryId: "US",
      partyId: "1",
      issuedBy: "nationalParty",
    });

    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.playerCount).toBe(1);
    expect(snapshot.nppCount).toBe(0);
    expect(snapshot.players[0]).toMatchObject({
      voterName: "Dana Roem",
      targetLabel: "Infrastructure Act",
      currentVoteLabel: "AGAINST",
      whipDirection: "for",
      mode: "soft",
    });
  });

  it("clears defiance when the current vote already matches the whip", async () => {
    const db = createMockDb();
    const whipId = new ObjectId();
    const billId = new ObjectId();
    const nppId = new ObjectId();
    db.collection("billWhips");
    db.collection("bills");
    db.collection("npps");
    db.collection("electedOfficials");

    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      sort: () => ({
        toArray: async () =>
          [
            {
              _id: whipId,
              targetType: "bill",
              targetId: billId,
              chamber: "stateSenate",
              direction: "against",
              issuedBy: "stateParty",
              countryId: "US",
              partyId: "1",
              stateId: "AZ",
              audience: "npp",
              attemptNumber: 1,
              createdAt: new Date("2026-04-29T12:00:00.000Z"),
              updatedAt: new Date("2026-04-29T12:00:00.000Z"),
            } satisfies Omit<BillWhip, "candidacyId" | "mode">,
          ] as BillWhip[],
      }),
    });
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Education Act",
      status: "active",
      votes: { [`npp_${nppId.toString()}`]: "against" },
    } as unknown as Bill);
    db.collectionMocks["npps"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            _id: nppId,
            name: "Wei Yang",
            party: "1",
          } satisfies Pick<NPP, "_id" | "name" | "party">,
        ],
      }),
    });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            nppId,
            state: "AZ",
            officeType: "stateSenate",
          } satisfies Pick<ElectedOfficial, "nppId" | "state" | "officeType">,
        ],
      }),
    });

    const snapshot = await buildWhipDefianceSnapshot(db as unknown as Db, {
      countryId: "US",
      partyId: "1",
      issuedBy: "stateParty",
      stateId: "AZ",
    });

    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.players).toHaveLength(0);
    expect(snapshot.npps).toHaveLength(0);
  });
});
