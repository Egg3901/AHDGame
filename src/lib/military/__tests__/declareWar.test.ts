import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { declareWar } from "../declareWar";

const createConflictSpy = vi.fn();
const joinSideSpy = vi.fn();

vi.mock("@/lib/military/createConflict", () => ({
  createConflict: (...args: unknown[]) => {
    createConflictSpy(...args);
    const input = args[1] as Record<string, unknown>;
    return Promise.resolve({ _id: "new", conflictId: 7, ...input });
  },
}));
vi.mock("@/lib/military/joinSide", () => ({
  joinSide: (...args: unknown[]) => {
    joinSideSpy(...args);
    return Promise.resolve();
  },
}));

/**
 * A db whose host-scoped lookup returns `hosted`, and whose scan for a war between
 * the two parties sees `all` (defaulting to just `hosted`).
 *
 * The two are separate because they answer different questions: `findOne` asks "is a
 * war being fought in the defender", `find` asks "are these two already fighting
 * each other, anywhere".
 */
function stubDb(hosted: unknown = null, all?: unknown[]): Db {
  const scan = all ?? (hosted == null ? [] : [hosted]);
  return {
    collection: () => ({
      findOne: vi.fn().mockResolvedValue(hosted),
      find: () => ({ toArray: async () => scan }),
    }),
  } as unknown as Db;
}

const input = {
  declarer: "US" as const,
  defender: "CN" as const,
  warGoal: "punitive" as const,
  billId: "b1",
  currentTurn: 40,
};

beforeEach(() => vi.clearAllMocks());

describe("declareWar", () => {
  it("creates a war hosted in the defender when none exists", async () => {
    const { conflict, joined } = await declareWar(stubDb(), input);
    expect(joined).toBe(false);
    expect(conflict.hostCountry).toBe("CN");
    expect(conflict.sideA.countries).toEqual(["US"]);
    expect(conflict.sideB.countries).toEqual(["CN"]);
    expect(joinSideSpy).not.toHaveBeenCalled();
  });

  it("records the goal and the bill that declared it", async () => {
    const { conflict } = await declareWar(stubDb(), input);
    expect(conflict.warGoal).toBe("punitive");
    expect(conflict.declaredByBillId).toBe("b1");
  });

  it("joins the existing war instead of opening a second", async () => {
    const live = {
      _id: "c1",
      hostCountry: "CN",
      sideA: { countries: ["UK"], kind: "state" },
      sideB: { countries: ["CN"], kind: "state" },
    };
    const { joined } = await declareWar(stubDb(live), input);
    expect(joined).toBe(true);
    expect(createConflictSpy).not.toHaveBeenCalled();
    expect(joinSideSpy).toHaveBeenCalledWith(expect.anything(), live, "US", "A");
  });

  it("enrols on the side OPPOSING the defender, not simply side A", async () => {
    // The defender sits on side A of a war someone else started, so the declarer
    // must land on B. Hardcoding "A" would have put them alongside their enemy.
    const live = {
      _id: "c1",
      hostCountry: "CN",
      sideA: { countries: ["CN"], kind: "state" },
      sideB: { countries: ["RU"], kind: "state" },
    };
    await declareWar(stubDb(live), input);
    expect(joinSideSpy).toHaveBeenCalledWith(expect.anything(), live, "US", "B");
  });

  it("opens a NEW war rather than resurrecting a resolved one", async () => {
    // The lookup excludes resolved conflicts, so a finished war leaves nothing live.
    const { joined } = await declareWar(stubDb(null), input);
    expect(joined).toBe(false);
    expect(createConflictSpy).toHaveBeenCalled();
  });

  it("gives the conflict a stable id derived from the belligerents and turn", async () => {
    await declareWar(stubDb(), input);
    const passed = createConflictSpy.mock.calls[0][1] as { id: string };
    expect(passed.id).toBe("war_us_cn_40");
  });
});

describe("one war at a time between the same pair", () => {
  it("does NOT open a second war when the pair is already opposed elsewhere", async () => {
    // The TOCTOU the validator alone cannot close: the bill was filed when the two
    // were not opposed, and passed after a third country's war drew them in on
    // opposite sides. Creating here would give the same pair two live wars.
    const elsewhere = {
      _id: "c9",
      hostCountry: "RU",
      sideA: { countries: ["RU", "CN"], kind: "coalition" },
      sideB: { countries: ["US"], kind: "state" },
    };
    const { conflict, joined } = await declareWar(stubDb(null, [elsewhere]), input);
    expect(joined).toBe(true);
    expect(conflict._id).toBe("c9");
    expect(createConflictSpy).not.toHaveBeenCalled();
    expect(joinSideSpy).not.toHaveBeenCalled();
  });

  it("still creates when the pair share a side elsewhere but are not opposed", async () => {
    // Co-belligerents in RU's war are not at war with each other, so a declaration
    // between them opens their first war rather than a second.
    const together = {
      _id: "c8",
      hostCountry: "RU",
      sideA: { countries: ["US", "CN"], kind: "coalition" },
      sideB: { countries: ["RU"], kind: "state" },
    };
    const { joined, conflict } = await declareWar(stubDb(null, [together]), input);
    expect(joined).toBe(false);
    expect(conflict.hostCountry).toBe("CN");
    expect(createConflictSpy).toHaveBeenCalled();
  });
});
