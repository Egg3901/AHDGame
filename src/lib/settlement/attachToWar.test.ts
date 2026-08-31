import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import type { BlocLookup } from "@/lib/military/bloc";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import { qualifyWar } from "./attachToWar";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

/** The 1953 roll, as `loadMilitaryBlocs` would return it. */
const BLOCS: BlocLookup = {
  US: "west",
  UK: "west",
  DE: "west",
  RU: "east",
  DD: "east",
  PL: "east",
  YU: "nonAligned",
};

type WarInput = Parameters<typeof qualifyWar>[0];

function war(over: Partial<ConflictDoc> = {}): WarInput {
  return {
    _id: "war_us_dd_412",
    name: "United States vs East Germany",
    type: "interstate",
    hostCountry: "DD",
    sideA: { label: "United States", countries: ["US"], kind: "state" },
    sideB: { label: "East Germany", countries: ["DD"], kind: "state" },
    ...over,
  } as WarInput;
}

const CRISIS_ID = new ObjectId();

function crisis(over: Partial<SettlementCrisisDoc> = {}): SettlementCrisisDoc {
  return {
    _id: CRISIS_ID,
    kind: "settlement.germanQuestion",
    status: "open",
    conflictId: null,
    ...over,
  } as SettlementCrisisDoc;
}

describe("qualifyWar", () => {
  it("qualifies a war declared on East Germany by a NATO member", () => {
    const res = qualifyWar(war(), BLOCS);
    expect(res).toEqual({
      conflictId: "war_us_dd_412",
      anchor: "DD",
      sides: { challenger: "B", incumbent: "A" },
    });
  });

  it("reads the rosters, not the sides' order: DD on side A still challenges", () => {
    const res = qualifyWar(
      war({
        sideA: { label: "East Germany", countries: ["DD"], kind: "state" },
        sideB: { label: "United States", countries: ["US"], kind: "state" },
      }),
      BLOCS
    );
    expect(res?.sides).toEqual({ challenger: "A", incumbent: "B" });
  });

  it("qualifies a war declared on West Germany, mapping DE to the incumbent", () => {
    const res = qualifyWar(
      war({
        hostCountry: "DE",
        sideA: { label: "Soviet Union", countries: ["RU"], kind: "state" },
        sideB: { label: "West Germany", countries: ["DE"], kind: "state" },
      }),
      BLOCS
    );
    expect(res).toEqual({
      conflictId: "war_us_dd_412",
      anchor: "DE",
      sides: { challenger: "A", incumbent: "B" },
    });
  });

  it("counts a Germany dragged in by a defence charter as not qualifying", () => {
    const res = qualifyWar(
      war({
        hostCountry: "PL",
        sideA: { label: "United Kingdom", countries: ["UK"], kind: "state" },
        sideB: { label: "Poland", countries: ["PL", "DD"], kind: "coalition" },
        treatyEntries: [
          { countryId: "DD", organizationId: "WARSAW_PACT", defending: "PL", joinedTurn: 410 },
        ],
      }),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("still qualifies when a Germany declared AND other allies were dragged in", () => {
    const res = qualifyWar(
      war({
        sideB: { label: "East Germany", countries: ["DD", "RU", "PL"], kind: "coalition" },
        treatyEntries: [
          { countryId: "RU", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 412 },
          { countryId: "PL", organizationId: "WARSAW_PACT", defending: "DD", joinedTurn: 412 },
        ],
      }),
      BLOCS
    );
    expect(res?.anchor).toBe("DD");
    expect(res?.sides).toEqual({ challenger: "B", incumbent: "A" });
  });

  it("refuses a proxy war, however its rosters filled out", () => {
    // A cold_war conflict's sides start as factions with backers, but `joinSide`
    // puts real countries on them. East Germany intervening in somebody else's
    // proxy war is not a war declared by or against a Germany.
    const res = qualifyWar(
      war({
        type: "cold_war",
        hostCountry: "AO",
        sideA: { label: "MPLA", countries: ["US"], kind: "coalition" },
        sideB: { label: "UNITA", countries: ["DD", "RU"], kind: "coalition" },
      }),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("survives a war whose rosters are missing rather than taking the phase down", () => {
    // Read from documents this feature does not own. A throw here is swallowed by
    // `runPhase` as a failed phase, taking the German Question offline every turn.
    const res = qualifyWar(
      war({
        sideA: { label: "United States" },
        sideB: { label: "East Germany" },
      } as unknown as Partial<ConflictDoc>),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("refuses a war with no Germany on either roster", () => {
    const res = qualifyWar(
      war({
        hostCountry: "PL",
        sideA: { label: "United Kingdom", countries: ["UK"], kind: "state" },
        sideB: { label: "Poland", countries: ["PL"], kind: "state" },
      }),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("refuses a war against a non-aligned state: no opposing bloc to settle with", () => {
    const res = qualifyWar(
      war({
        hostCountry: "YU",
        sideA: { label: "East Germany", countries: ["DD"], kind: "state" },
        sideB: { label: "Yugoslavia", countries: ["YU"], kind: "state" },
      }),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("refuses when the Germany itself sits in no bloc", () => {
    const res = qualifyWar(war(), { ...BLOCS, DD: "nonAligned" });
    expect(res).toBeNull();
  });

  it("refuses when both Germanies fight on the same side", () => {
    const res = qualifyWar(
      war({
        hostCountry: "PL",
        sideA: { label: "Germanies", countries: ["DE", "DD"], kind: "coalition" },
        sideB: { label: "Poland", countries: ["PL"], kind: "state" },
      }),
      BLOCS
    );
    expect(res).toBeNull();
  });

  it("prefers DD as the anchor when both Germanies are opposed", () => {
    const res = qualifyWar(
      war({
        sideA: { label: "West", countries: ["US", "DE"], kind: "coalition" },
        sideB: { label: "East", countries: ["DD", "RU"], kind: "coalition" },
      }),
      BLOCS
    );
    expect(res?.anchor).toBe("DD");
    expect(res?.sides).toEqual({ challenger: "B", incumbent: "A" });
  });
});

describe("attachCrisisToLiveWar", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "conflicts").find.mockReturnValue({ toArray: async () => [war()] });
    prime(db, "conflicts").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "gameState").findOne.mockResolvedValue({ _id: "current", preset: "1953-default" });
    prime(db, "organizationMemberships").find.mockReturnValue({
      toArray: async () => [
        { organizationId: "NATO", countryId: "US" },
        { organizationId: "NATO", countryId: "DE" },
        { organizationId: "WARSAW_PACT", countryId: "DD" },
        { organizationId: "WARSAW_PACT", countryId: "RU" },
      ],
    });
  });

  it("does nothing for a crisis that is not open", async () => {
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    const res = await attachCrisisToLiveWar(db as unknown as Db, crisis({ status: "frozen" }));
    expect(res.attached).toBe(false);
    expect(prime(db, "conflicts").find).not.toHaveBeenCalled();
  });

  it("freezes the crisis onto a qualifying war and stamps the sides", async () => {
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    const res = await attachCrisisToLiveWar(db as unknown as Db, crisis());

    expect(res.attached).toBe(true);
    expect(res.conflictId).toBe("war_us_dd_412");

    const set = prime(db, "settlementCrises").updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe("frozen");
    expect(set.conflictId).toBe("war_us_dd_412");
    expect(set.conflictSides).toEqual({ challenger: "B", incumbent: "A" });
    expect(set.conflictAttachment.anchor).toBe("DD");
  });

  it("claims the crisis before it touches the war", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    const res = await attachCrisisToLiveWar(db as unknown as Db, crisis());

    expect(res.attached).toBe(false);
    expect(prime(db, "conflicts").updateOne).not.toHaveBeenCalled();
  });

  it("renames the war and widens its host entities without losing the anchor", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [
        war({
          hostCountry: "US",
          sideA: { label: "East Germany", countries: ["DD"], kind: "state" },
          sideB: { label: "United States", countries: ["US"], kind: "state" },
        }),
      ],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "conflicts").updateOne.mock.calls[0][1].$set;
    expect(set.name).toBe("The War for Germany");
    expect(set.hostEntities).toEqual(["US", "DE", "DD"]);
  });

  it("never writes a junk host onto a war with no anchor of its own", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [war({ hostCountry: undefined as unknown as string })],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "conflicts").updateOne.mock.calls[0][1].$set;
    expect(set.hostEntities).toEqual(["DE", "DD"]);
  });

  it("records what it overwrote, so a detach can put the war back", async () => {
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "settlementCrises").updateOne.mock.calls[0][1].$set;
    expect(set.conflictAttachment.previousName).toBe("United States vs East Germany");
    expect(set.conflictAttachment.previousHostEntities).toBeNull();
  });

  it("records a null previous name when the war already carries the settlement's", async () => {
    // The state a crash between the freeze and the rename leaves behind. Storing
    // "The War for Germany" as the war's own name would lose the real one for good.
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [war({ name: "The War for Germany" })],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "settlementCrises").updateOne.mock.calls[0][1].$set;
    expect(set.conflictAttachment.previousName).toBeNull();
  });

  it("leaves the crisis open when no live war qualifies", async () => {
    prime(db, "conflicts").find.mockReturnValue({ toArray: async () => [] });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    const res = await attachCrisisToLiveWar(db as unknown as Db, crisis());

    expect(res.attached).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("evens an unmoved front, because the theatre is now both Germanies", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [war({ control: 100, controlStart: 100 })],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "conflicts").updateOne.mock.calls[0][1].$set;
    // `initialControl` gave the defender all of its own soil, which is right for a
    // war over ONE country and wrong once the ground is both halves of a divided one.
    expect(set.control).toBe(50);
    expect(set.controlStart).toBe(50);
  });

  it("drops the momentum sample it just invalidated", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [
        war({ control: 100, controlStart: 100, controlSample: { turn: 410, control: 100 } }),
      ],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    // `applyOccupation` writes a sample even on a battle that does NOT move the
    // front, so an unmoved war can carry one. Kept, `warEffort` would read the
    // re-baseline itself as fifty points of advance somebody made.
    const update = prime(db, "conflicts").updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ controlSample: "" });
  });

  it("refuses to erase a front belligerents have already fought over", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [
        war({ control: 72, controlStart: 100, controlSample: { turn: 410, control: 80 } }),
      ],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    // A crisis can attach to a war that was already running. Twenty-eight points
    // of ground are somebody's; evening them up would hand them back.
    const update = prime(db, "conflicts").updateOne.mock.calls[0][1];
    expect(update.$set.control).toBeUndefined();
    expect(update.$set.controlStart).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });

  it("writes no control at all when the front is already even", async () => {
    prime(db, "conflicts").find.mockReturnValue({
      toArray: async () => [war({ control: 50, controlStart: 50 })],
    });
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const update = prime(db, "conflicts").updateOne.mock.calls[0][1];
    expect(update.$set.control).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });

  it("evens a conflict document that carries no front at all", async () => {
    // Absent on both fields reads as unmoved, and 50 is what `derivedSupplies`
    // already falls back to for a missing starting line. Pinned so the behaviour
    // is a decision rather than an accident of two undefineds comparing equal.
    const { attachCrisisToLiveWar } = await import("./attachToWar");
    await attachCrisisToLiveWar(db as unknown as Db, crisis());

    const set = prime(db, "conflicts").updateOne.mock.calls[0][1].$set;
    expect(set.control).toBe(50);
    expect(set.controlStart).toBe(50);
  });
});

describe("detachCrisisFromWar", () => {
  let db: MockDb;

  const attached = (over: Partial<SettlementCrisisDoc> = {}) =>
    crisis({
      status: "frozen",
      conflictId: "war_us_dd_412",
      conflictSides: { challenger: "B", incumbent: "A" },
      conflictAttachment: {
        anchor: "DD",
        previousName: "United States vs East Germany",
        previousHostEntities: null,
      },
      ...over,
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "conflicts").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("ignores a crisis frozen by its own declared war", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(war({ status: "active" }));
    const { detachCrisisFromWar } = await import("./attachToWar");
    const res = await detachCrisisFromWar(
      db as unknown as Db,
      attached({ conflictAttachment: null })
    );
    expect(res.detached).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("keeps the crisis frozen while its anchor is still fighting", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(war({ status: "active" }));
    const { detachCrisisFromWar } = await import("./attachToWar");
    const res = await detachCrisisFromWar(db as unknown as Db, attached());
    expect(res.detached).toBe(false);
  });

  it("keeps the crisis frozen once the war has resolved, whoever is left on it", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({
        status: "resolved",
        sideB: { label: "East Germany", countries: [], kind: "state" },
      })
    );
    const { detachCrisisFromWar } = await import("./attachToWar");
    const res = await detachCrisisFromWar(db as unknown as Db, attached());
    expect(res.detached).toBe(false);
  });

  it("returns the crisis to play when its anchor leaves the war", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({
        status: "active",
        sideB: { label: "East Germany", countries: [], kind: "state" },
      })
    );
    const { detachCrisisFromWar } = await import("./attachToWar");
    const res = await detachCrisisFromWar(db as unknown as Db, attached());

    expect(res.detached).toBe(true);
    const set = prime(db, "settlementCrises").updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe("open");
    expect(set.conflictId).toBeNull();
    expect(set.conflictSides).toBeNull();
    expect(set.conflictAttachment).toBeNull();
  });

  it("un-stamps the war dispatch so a later war is announced too", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({ status: "active", sideB: { label: "East Germany", countries: [], kind: "state" } })
    );
    const { detachCrisisFromWar } = await import("./attachToWar");
    await detachCrisisFromWar(db as unknown as Db, attached());

    const update = prime(db, "settlementCrises").updateOne.mock.calls[0][1];
    expect(update.$pull).toEqual({ postedWireEvents: "war" });
  });

  it("leaves the name alone when it recorded no name of its own", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({ status: "active", sideB: { label: "East Germany", countries: [], kind: "state" } })
    );
    const { detachCrisisFromWar } = await import("./attachToWar");
    await detachCrisisFromWar(
      db as unknown as Db,
      attached({
        conflictAttachment: {
          anchor: "DD",
          previousName: null,
          previousHostEntities: null,
        },
      })
    );

    const update = prime(db, "conflicts").updateOne.mock.calls[0][1];
    expect(update.$set).toBeUndefined();
    expect(update.$unset).toEqual({ hostEntities: "" });
  });

  it("puts the war's own name and hosts back when it detaches", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({
        status: "active",
        sideB: { label: "East Germany", countries: [], kind: "state" },
      })
    );
    const { detachCrisisFromWar } = await import("./attachToWar");
    await detachCrisisFromWar(db as unknown as Db, attached());

    const call = prime(db, "conflicts").updateOne.mock.calls[0][1];
    expect(call.$set.name).toBe("United States vs East Germany");
    expect(call.$unset).toEqual({ hostEntities: "" });
  });

  it("restores the war BEFORE releasing the crisis, so a crash self-heals", async () => {
    // Released first, a crash in between is permanent: the stamp saying what to
    // give back is gone and the war keeps marks nothing will ever undo.
    const order: string[] = [];
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({ status: "active", sideB: { label: "East Germany", countries: [], kind: "state" } })
    );
    prime(db, "conflicts").updateOne.mockImplementation(async () => {
      order.push("restore");
      return { matchedCount: 1 };
    });
    prime(db, "settlementCrises").updateOne.mockImplementation(async () => {
      order.push("release");
      return { matchedCount: 1 };
    });

    const { detachCrisisFromWar } = await import("./attachToWar");
    await detachCrisisFromWar(db as unknown as Db, attached());

    expect(order).toEqual(["restore", "release"]);
  });
});

describe("resumeCrisisAfterWhitePeace", () => {
  let db: MockDb;

  const attached = (over: Partial<SettlementCrisisDoc> = {}) =>
    crisis({
      status: "frozen",
      conflictId: "war_us_dd_412",
      conflictSides: { challenger: "B", incumbent: "A" },
      conflictAttachment: {
        anchor: "DD",
        previousName: "United States vs East Germany",
        previousHostEntities: null,
      },
      ...over,
    });

  const whitePeacedWar = () =>
    war({ status: "resolved", outcome: { winner: "stalemate", note: "Neither side prevailed." } });

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "conflicts").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("puts the question back on the board when its war ends in a white peace", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(whitePeacedWar());
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    const res = await resumeCrisisAfterWhitePeace(db as unknown as Db, attached());
    expect(res.detached).toBe(true);
    // Found rather than indexed: handing the borrowed war back writes to this
    // collection first, so the release is not necessarily call zero.
    const release = prime(db, "settlementCrises").updateOne.mock.calls.find(
      (c) => c[1]?.$set?.status === "open"
    );
    expect(release?.[1].$set).toMatchObject({ status: "open", conflictId: null });
  });

  it("resumes a crisis fighting its OWN declared war, which has nothing to hand back", async () => {
    // detachCrisisFromWar refuses this case. A war declared to settle Germany that
    // settled nothing still leaves Germany unsettled.
    prime(db, "conflicts").findOne.mockResolvedValue(whitePeacedWar());
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    const res = await resumeCrisisAfterWhitePeace(
      db as unknown as Db,
      attached({ conflictAttachment: null })
    );
    expect(res.detached).toBe(true);
  });

  it("clears the war stamp, so a second war is announced too", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(whitePeacedWar());
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    await resumeCrisisAfterWhitePeace(db as unknown as Db, attached());
    const release = prime(db, "settlementCrises").updateOne.mock.calls.find(
      (c) => c[1]?.$set?.status === "open"
    );
    expect(release?.[1].$pull).toMatchObject({ postedWireEvents: "war" });
  });

  it("leaves a war that somebody actually won to the settle sweep", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(
      war({ status: "resolved", outcome: { winner: "B", note: "took full control" } })
    );
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    const res = await resumeCrisisAfterWhitePeace(db as unknown as Db, attached());
    expect(res.detached).toBe(false);
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
  });

  it("leaves a war still being fought alone", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(war({ status: "active" }));
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    expect((await resumeCrisisAfterWhitePeace(db as unknown as Db, attached())).detached).toBe(
      false
    );
  });

  it("ignores a crisis that is not frozen", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(whitePeacedWar());
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    const res = await resumeCrisisAfterWhitePeace(
      db as unknown as Db,
      attached({ status: "open" })
    );
    expect(res.detached).toBe(false);
  });

  it("does not resume when another runner released it first", async () => {
    prime(db, "conflicts").findOne.mockResolvedValue(whitePeacedWar());
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { resumeCrisisAfterWhitePeace } = await import("./attachToWar");
    expect((await resumeCrisisAfterWhitePeace(db as unknown as Db, attached())).detached).toBe(
      false
    );
  });
});
