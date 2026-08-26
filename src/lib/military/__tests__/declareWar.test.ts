import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { declareWar } from "../declareWar";

const createConflictSpy = vi.fn();
const joinSideSpy = vi.fn();
const conflictUpdateSpy = vi.fn();

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

const treatyDefendersSpy = vi.fn();
vi.mock("@/lib/military/treatyDefence", () => ({
  resolveTreatyDefenders: (...a: unknown[]) => treatyDefendersSpy(...a),
}));

const notifySpy = vi.fn();
const orgHistorySpy = vi.fn();
const hogSpy = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...a: unknown[]) => {
    notifySpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: (...a: unknown[]) => {
    orgHistorySpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...a: unknown[]) => hogSpy(...a),
}));

const CHAR_ID = new ObjectId();
const USER_ID = new ObjectId();

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
  const characters = [{ _id: CHAR_ID, userId: USER_ID }];
  return {
    collection: (name: string) => ({
      // `cabinetMembers` is the defence-seat lookup for a notified ally; returning null
      // leaves the head of government as the sole recipient.
      findOne: vi.fn().mockResolvedValue(name === "cabinetMembers" ? null : hosted),
      find: () => ({
        toArray: async () => (name === "characters" ? characters : scan),
        project: () => ({ toArray: async () => (name === "characters" ? characters : scan) }),
      }),
      // Treaty entries are $push-ed onto a live conflict when allies join one.
      updateOne: (...a: unknown[]) => {
        conflictUpdateSpy(...a);
        return Promise.resolve({ modifiedCount: 1 });
      },
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no treaty binds anybody, so every pre-existing case keeps its shape.
  treatyDefendersSpy.mockResolvedValue([]);
  hogSpy.mockResolvedValue(CHAR_ID);
});

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
    expect(joinSideSpy).toHaveBeenCalledWith(
      expect.anything(),
      live,
      "US",
      "A",
      expect.any(Number)
    );
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
    expect(joinSideSpy).toHaveBeenCalledWith(
      expect.anything(),
      live,
      "US",
      "B",
      expect.any(Number)
    );
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

describe("declareWar treaty defence", () => {
  const pactDefender = { ...input, defender: "DD" as const };

  it("opens a new war with treaty allies already on the defending side", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    const { conflict } = await declareWar(stubDb(), pactDefender);
    expect(conflict.sideB.countries).toEqual(["DD", "RU"]);
    // Allies must be in the roster BEFORE createConflict, or opening forces are never
    // deployed for them and baseStrength is computed for a coalition of one.
    const passed = createConflictSpy.mock.calls[0][1] as { sideB: { countries: string[] } };
    expect(passed.sideB.countries).toEqual(["DD", "RU"]);
  });

  it("records why each ally is present", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    const { conflict } = await declareWar(stubDb(), pactDefender);
    expect(conflict.treatyEntries).toEqual([
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 40 },
    ]);
  });

  it("labels a defended side as a coalition, not a lone state", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    const { conflict } = await declareWar(stubDb(), pactDefender);
    expect(conflict.sideB.kind).toBe("coalition");
  });

  it("leaves a bilateral war untouched when no treaty binds the defender", async () => {
    const { conflict } = await declareWar(stubDb(), input);
    expect(conflict.sideB.countries).toEqual(["CN"]);
    expect(conflict.sideB.kind).toBe("state");
    expect(conflict.treatyEntries).toBeUndefined();
  });

  it("enrols allies on the defender's side of a war already being fought there", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    const live = {
      _id: "c1",
      hostCountry: "DD",
      sideA: { countries: ["UK"], kind: "state" },
      sideB: { countries: ["DD"], kind: "state" },
    };
    await declareWar(stubDb(live), pactDefender);
    // The ally joins the DEFENDER's side (B); the declarer joins the other one.
    expect(joinSideSpy).toHaveBeenCalledWith(
      expect.anything(),
      live,
      "RU",
      "B",
      expect.any(Number)
    );
    expect(joinSideSpy).toHaveBeenCalledWith(
      expect.anything(),
      live,
      "US",
      "A",
      expect.any(Number)
    );
  });

  // The join path records provenance through a $push rather than at creation. Without
  // this the peace bar and release would have nothing to read for an ally that entered
  // an existing war, and both would silently do nothing for it.
  it("records provenance when allies join an existing war", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    const live = {
      _id: "c1",
      hostCountry: "DD",
      name: "Battle of Berlin",
      sideA: { countries: ["UK"], kind: "state" },
      sideB: { countries: ["DD"], kind: "state" },
    };
    await declareWar(stubDb(live), pactDefender);
    const push = conflictUpdateSpy.mock.calls.find(
      (c) => (c[1] as { $push?: unknown })?.$push !== undefined
    );
    expect(push).toBeDefined();
    const entries = (push![1] as { $push: { treatyEntries: { $each: Record<string, unknown>[] } } })
      .$push.treatyEntries.$each;
    expect(entries).toEqual([
      { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 40 },
    ]);
  });

  it("does not auto-join when the defender cannot be placed on either side", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    // The defender is on neither roster and has no bloc backer to fall back on, so there
    // is no side to defend. Guessing would enrol the ally AGAINST the country it came to
    // protect.
    const live = {
      _id: "c1",
      hostCountry: "DD",
      sideA: { countries: ["UK"], kind: "state" },
      sideB: { countries: ["FR"], kind: "state" },
    };
    await declareWar(stubDb(live), pactDefender);
    expect(joinSideSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      live,
      "RU",
      expect.anything(),
      expect.anything()
    );
  });

  it("tells an auto-joined ally's government that its treaty took it to war", async () => {
    treatyDefendersSpy.mockResolvedValue([{ countryId: "RU", organizationId: "WARSAW_PACT" }]);
    await declareWar(stubDb(), pactDefender);
    const inputs = notifySpy.mock.calls[0][0] as Array<{
      userId: unknown;
      type: string;
      message: string;
    }>;
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0].userId).toEqual(USER_ID);
    expect(inputs[0].type).toBe("treaty_defence_invoked");
    expect(inputs[0].message).toContain("Warsaw Pact");
    // Player-facing copy: no em or en dashes.
    expect(inputs[0].message).not.toMatch(/[—–]/);
    expect(orgHistorySpy).toHaveBeenCalled();
  });

  it("sends nothing when no ally was pulled in", async () => {
    await declareWar(stubDb(), input);
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
