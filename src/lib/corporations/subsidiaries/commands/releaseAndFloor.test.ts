import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";

vi.mock("../authorization", () => ({ canActOnCorporationAsParent: vi.fn() }));
vi.mock("@/lib/corporations/caretakerCeo", () => ({ dismissCaretakerCeo: vi.fn() }));

import { canActOnCorporationAsParent } from "../authorization";
import { dismissCaretakerCeo } from "@/lib/corporations/caretakerCeo";
import { releaseSubsidiary } from "./releaseSubsidiary";
import { setParentDividendFloor } from "./setParentDividendFloor";
import { SUBSIDIARY_MIN_AGE_TURNS } from "../constants";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";

const parentId = new ObjectId();
const subId = new ObjectId();
const callerUserId = new ObjectId();

function sub(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: subId,
    name: "Sub Co",
    totalShares: 100,
    shareholders: [{ corporationId: parentId, shares: 100 }],
    subsidiaryFormalizedAtTurn: 0,
    ...overrides,
  } as unknown as Corporation;
}

function makeDb() {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  return {
    db: {
      collection: vi.fn(() => ({
        updateOne,
        find: vi.fn().mockReturnValue({ toArray: async () => [] }),
        findOne: vi
          .fn()
          .mockResolvedValue({ _id: parentId, userId: callerUserId, ceoVacant: false }),
      })),
    } as unknown as Db,
    updateOne,
  };
}

describe("releaseSubsidiary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(true);
  });

  it("refuses an unauthorized caller and writes nothing", async () => {
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(false);
    const { db, updateOne } = makeDb();

    const result = await releaseSubsidiary(db, {
      sub: sub(),
      callerUserId,
      turn: 1000,
      now: new Date(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("holds a freshly formalized subsidiary for the minimum age", async () => {
    const { db, updateOne } = makeDb();

    const result = await releaseSubsidiary(db, {
      sub: sub({ subsidiaryFormalizedAtTurn: 1000 } as Partial<Corporation>),
      callerUserId,
      turn: 1000 + SUBSIDIARY_MIN_AGE_TURNS - 1,
      now: new Date(),
    });

    expect(result.ok).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("releases once the minimum age has elapsed", async () => {
    const { db, updateOne } = makeDb();

    const result = await releaseSubsidiary(db, {
      sub: sub({ subsidiaryFormalizedAtTurn: 0 } as Partial<Corporation>),
      callerUserId,
      turn: SUBSIDIARY_MIN_AGE_TURNS,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    expect(updateOne).toHaveBeenCalled();
  });

  it("only dismisses a caretaker when asked and one is installed", async () => {
    vi.mocked(dismissCaretakerCeo).mockResolvedValue({ ok: true } as never);
    const { db } = makeDb();

    await releaseSubsidiary(db, {
      sub: sub(),
      callerUserId,
      turn: SUBSIDIARY_MIN_AGE_TURNS,
      now: new Date(),
    });
    expect(dismissCaretakerCeo).not.toHaveBeenCalled();

    await releaseSubsidiary(db, {
      sub: sub({ caretakerCeo: { installedAtTurn: 1 } } as unknown as Partial<Corporation>),
      callerUserId,
      dismissCaretaker: true,
      turn: SUBSIDIARY_MIN_AGE_TURNS,
      now: new Date(),
    });
    expect(dismissCaretakerCeo).toHaveBeenCalledTimes(1);
  });
});

describe("setParentDividendFloor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(true);
  });

  it("refuses an unauthorized caller and writes nothing", async () => {
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(false);
    const { db, updateOne } = makeDb();

    const result = await setParentDividendFloor(db, {
      sub: sub(),
      callerUserId,
      floorPct: 10,
      now: new Date(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("clamps the floor into the legal dividend range rather than rejecting", async () => {
    const { db } = makeDb();

    const high = await setParentDividendFloor(db, {
      sub: sub(),
      callerUserId,
      floorPct: MAX_DIVIDEND_RATE + 50,
      now: new Date(),
    });
    expect(high.ok).toBe(true);
    if (high.ok) expect(high.parentDividendFloorPct).toBe(MAX_DIVIDEND_RATE);

    const low = await setParentDividendFloor(db, {
      sub: sub(),
      callerUserId,
      floorPct: -10,
      now: new Date(),
    });
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.parentDividendFloorPct).toBe(0);
  });

  it("rejects a non-finite floor", async () => {
    const { db, updateOne } = makeDb();

    const result = await setParentDividendFloor(db, {
      sub: sub(),
      callerUserId,
      floorPct: Number.NaN,
      now: new Date(),
    });

    expect(result.ok).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
