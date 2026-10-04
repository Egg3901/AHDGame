import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Bill, BillWhip, Character, ElectedOfficial, NPP } from "@/lib/db/types";
import { buildWhipDefianceSnapshot } from "./whipDefiance";

describe("buildWhipDefianceSnapshot", () => {
  it("loads cabinet nomination targets in one read for multiple whips", async () => {
    const db = createMockDb();
    const targetIds = [new ObjectId(), new ObjectId(), new ObjectId()];
    const whips = targetIds.map((targetId) => ({
      _id: new ObjectId(),
      targetType: "cabinetNomination",
      targetId,
      chamber: "senate",
      direction: "for",
      issuedBy: "nationalParty",
      countryId: "US",
      partyId: "1",
      audience: "npp",
      createdAt: new Date("2026-04-29T12:00:00.000Z"),
      updatedAt: new Date("2026-04-29T12:00:00.000Z"),
    })) as unknown as BillWhip[];
    db.collection("billWhips");
    db.collection("cabinetNominations");
    db.collectionMocks.billWhips!.find.mockReturnValue({
      sort: () => ({ toArray: async () => whips }),
    });
    db.collectionMocks.cabinetNominations!.find.mockReturnValue({
      toArray: async () =>
        targetIds.map((targetId) => ({
          _id: targetId,
          status: "active",
          votes: {},
        })),
    });

    const scope = {
      countryId: "US",
      partyId: "1",
      issuedBy: "nationalParty",
    } as const;
    const queriedSnapshot = await buildWhipDefianceSnapshot(db as unknown as Db, scope);
    const preloadedSnapshot = await buildWhipDefianceSnapshot(
      db as unknown as Db,
      scope,
      25,
      whips
    );
    expect(preloadedSnapshot).toEqual(queriedSnapshot);

    expect(db.collectionMocks.cabinetNominations!.find).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.cabinetNominations!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetNominations!.find.mock.calls[0][0]._id.$in).toHaveLength(3);
    expect(db.collectionMocks.billWhips!.find).toHaveBeenCalledTimes(1);
  });

  it("shows active player defiance for a national soft whip on a bill", async () => {
    const db = createMockDb();
    const whipId = new ObjectId();
    const billId = new ObjectId();
    const secondBillId = new ObjectId();
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
            {
              _id: new ObjectId(),
              targetType: "bill",
              targetId: secondBillId,
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
    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: billId,
          title: "Infrastructure Act",
          status: "active",
          votes: { [characterId.toString()]: "against" },
        } as unknown as Bill,
        {
          _id: secondBillId,
          title: "Energy Act",
          status: "active",
          votes: { [characterId.toString()]: "against" },
        } as unknown as Bill,
      ],
    });
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

    expect(snapshot.activeCount).toBe(2);
    expect(snapshot.playerCount).toBe(2);
    expect(snapshot.nppCount).toBe(0);
    expect(snapshot.players[0]).toMatchObject({
      voterName: "Dana Roem",
      targetLabel: "Infrastructure Act",
      currentVoteLabel: "AGAINST",
      whipDirection: "for",
      mode: "soft",
    });
    expect(db.collectionMocks["bills"]!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["bills"]!.find.mock.calls[0][0]._id.$in).toHaveLength(2);
    expect(db.collectionMocks["bills"]!.findOne).not.toHaveBeenCalled();
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
    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: billId,
          title: "Education Act",
          status: "active",
          votes: { [`npp_${nppId.toString()}`]: "against" },
        } as unknown as Bill,
      ],
    });
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
