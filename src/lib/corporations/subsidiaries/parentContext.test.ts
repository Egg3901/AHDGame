import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { collectSiblingSubsidiaryCeoUserIds, subsidiaryReclaimBlocked } from "./parentContext";

const parentId = new ObjectId();
const subAId = new ObjectId();
const subBId = new ObjectId();
const sittingUser = new ObjectId();
const stashUser = new ObjectId();
const SYSTEM_USER_ID = "000000000000000000000000";

function formalizedSub(id: ObjectId, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: id,
    subsidiaryFormalizedAtTurn: 10,
    totalShares: 100,
    shareholders: [{ corporationId: parentId, shares: 80 }],
    ...overrides,
  } as Corporation;
}

function dbWithFormalized(corps: Corporation[]): Db {
  const db = createMockDb();
  db.collection("corporations").find = viFind(corps);
  db.collection("corporations").findOne = async (q: { _id: ObjectId }) =>
    corps.find((c) => c._id.equals(q._id)) ??
    ({
      _id: parentId,
      userId: new ObjectId(),
      ceoType: "character",
    } as Corporation);
  return db as unknown as Db;
}

function viFind(corps: Corporation[]) {
  return () => ({
    toArray: async () => corps,
    project: function project() {
      return this;
    },
  });
}

describe("collectSiblingSubsidiaryCeoUserIds", () => {
  it("includes a sitting human CEO of another subsidiary of the same parent", async () => {
    const db = dbWithFormalized([
      formalizedSub(subAId, { ceoType: "npp" }),
      formalizedSub(subBId, { ceoType: "character", userId: sittingUser }),
    ]);
    const ids = await collectSiblingSubsidiaryCeoUserIds(db, parentId, subAId);
    expect(ids).toHaveLength(1);
    expect(ids[0]!.equals(sittingUser)).toBe(true);
  });

  it("does not treat an NPP-caretaker stash as a sitting sibling operator", async () => {
    const db = dbWithFormalized([
      formalizedSub(subAId, { ceoType: "character", userId: sittingUser }),
      formalizedSub(subBId, {
        ceoType: "npp",
        userId: stashUser,
        caretakerCeo: {
          underlyingUserId: stashUser,
          underlyingCharacterId: new ObjectId(),
          appointedTurn: 5,
          appointmentSource: "vacancy",
        },
      }),
    ]);
    const ids = await collectSiblingSubsidiaryCeoUserIds(db, parentId, subAId);
    expect(ids).toHaveLength(0);
  });

  it("skips a plain NPP subsidiary with no human operator", async () => {
    const db = dbWithFormalized([
      formalizedSub(subAId),
      formalizedSub(subBId, {
        ceoType: "npp",
        userId: new ObjectId(SYSTEM_USER_ID),
      }),
    ]);
    const ids = await collectSiblingSubsidiaryCeoUserIds(db, parentId, subAId);
    expect(ids).toHaveLength(0);
  });

  it("skips the excluded subsidiary even when it has a sitting human CEO", async () => {
    const db = dbWithFormalized([
      formalizedSub(subAId, { ceoType: "character", userId: sittingUser }),
    ]);
    const ids = await collectSiblingSubsidiaryCeoUserIds(db, parentId, subAId);
    expect(ids).toHaveLength(0);
  });
});

describe("subsidiaryReclaimBlocked", () => {
  it("is null when the corp is not a formalized subsidiary", async () => {
    const db = dbWithFormalized([]);
    const reason = await subsidiaryReclaimBlocked(db, { _id: subAId } as Corporation, stashUser);
    expect(reason).toBeNull();
  });

  it("blocks reclaim when the stashed human already sits as CEO of a sibling", async () => {
    const parentOwner = new ObjectId();
    const reclaiming = formalizedSub(subAId, {
      ceoType: "npp",
      caretakerCeo: {
        underlyingUserId: sittingUser,
        underlyingCharacterId: new ObjectId(),
        appointedTurn: 5,
        appointmentSource: "owner",
      },
    });
    const sibling = formalizedSub(subBId, {
      ceoType: "character",
      userId: sittingUser,
    });
    const db = createMockDb();
    db.collection("corporations").find = viFind([reclaiming, sibling]);
    db.collection("corporations").findOne = async () =>
      ({
        _id: parentId,
        userId: parentOwner,
        ceoType: "character",
      }) as Corporation;

    const reason = await subsidiaryReclaimBlocked(db as unknown as Db, reclaiming, sittingUser);
    expect(reason).toBe("sibling");
  });
});
