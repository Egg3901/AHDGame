import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadOrgInfluence", () => {
  let db: MockDb;

  const gameState = (doc: object | null) =>
    db.collection("gameState").findOne.mockResolvedValue(doc);
  const alignments = (rows: object[]) =>
    db.collection("countryAlignments").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const orgMembers = (rows: object[]) =>
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  /** Macro-tier GDP: `capacity × 48` USD millions per entity. */
  const macroEconomies = (rows: object[]) =>
    db.collection("macroCountries").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const plays = (rows: object[]) =>
    db.collection("alignmentPlays").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
    db.collection("organizationFunds").findOne.mockResolvedValue({
      organizationId: "NATO",
      balanceLocal: 5_000_000,
      currencyCountryId: "US",
    });
    alignments([]);
    plays([]);
    orgMembers([]);
    macroEconomies([]);
    db.collection("alignmentCrises").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("states").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  it("reports the org's channel for the live era", async () => {
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.enabled).toBe(true);
    expect(v.channel).toMatchObject({ poleId: "WEST", weight: 1 });
    // Tokens, never hex — 11 themes ship with the app.
    expect(v.channel!.accentToken).toMatch(/^(info|error|warning|success)$/);
  });

  it("reports a player-founded Bloc as a live influence channel", async () => {
    const cursor = {
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          id: "andes-pact",
          name: "Andes Pact",
          shortName: "AP",
          creatorCountryId: "BR",
          category: "bloc",
          alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
        },
      ]),
    };
    db.collection("customInternationalOrganizations").find.mockReturnValue(cursor);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "andes-pact");

    expect(v.enabled).toBe(true);
    expect(v.channel).toMatchObject({
      poleId: "ORG:andes-pact",
      poleLabel: "Andes Pact",
      accentToken: "warning",
      weight: 1,
    });
  });

  it("returns no channel for an org that carries no influence this era", async () => {
    const { loadOrgInfluence } = await import("./orgInfluence");
    // The EU carries influence only from 1991.
    const v = await loadOrgInfluence(db as unknown as Db, "EU");
    expect(v.enabled).toBe(true);
    expect(v.channel).toBeNull();
    expect(v.targets).toEqual([]);
  });

  it("reads nothing when the gate is off", async () => {
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.enabled).toBe(false);
    expect(db.collection("countryAlignments").find).not.toHaveBeenCalled();
    expect(db.collection("alignmentPlays").find).not.toHaveBeenCalled();
  });

  it("omits locked nations, which the command would refuse anyway", async () => {
    alignments([
      { entityId: "PL", shares: { WEST: 2, EAST: 90 }, nonAligned: 8 }, // lead 88 — locked
      { entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }, // lead 28
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets.map((t) => t.entityId)).toEqual(["YU"]);
  });

  it("puts the least committed nations first — the cheapest to win", async () => {
    alignments([
      { entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }, // lead 28
      { entityId: "SE", shares: { WEST: 30, EAST: 18 }, nonAligned: 52 }, // lead 12
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets.map((t) => t.entityId)).toEqual(["SE", "YU"]);
  });

  it("reports this org's own share in each target", async () => {
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets[0]!.ourShare).toBe(22);
  });

  it("shows what a resolved play actually bought", async () => {
    plays([
      {
        targetEntityId: "YU",
        sponsorCountryId: "US",
        amountLocal: 900_000_000,
        turn: 4,
        resolvedTurn: 5,
        appliedPoints: 3,
        effectivePoints: 2,
      },
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.recent[0]).toMatchObject({
      targetName: "Yugoslavia",
      resolvedTurn: 5,
      effectivePoints: 2,
    });
  });

  it("carries the fund balance and its currency for the spend form", async () => {
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.fundBalanceLocal).toBe(5_000_000);
    expect(v.fundCurrencyCountryId).toBe("US");
  });

  it("does not substitute legacy raw pressure for missing effective results", async () => {
    plays([
      {
        organizationId: "WARSAW_PACT",
        targetEntityId: "YU",
        appliedPoints: 10,
        resolvedTurn: 5,
        turn: 4,
      },
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const view = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(view.recent[0]?.effectivePoints).toBeNull();
    expect(view.recent[0]).not.toHaveProperty("appliedPoints");
    expect(view.rivalIntel.YU?.[0]?.pointsLanded).toBeNull();
  });

  it("reports each member's standing, the ones on their way out first", async () => {
    alignments([
      { entityId: "US", shares: { WEST: 90, EAST: 2 }, nonAligned: 8 },
      { entityId: "TR", shares: { WEST: 12, EAST: 20 }, nonAligned: 68 },
    ]);
    orgMembers([
      { organizationId: "NATO", countryId: "US", wantsOutSinceTurn: null },
      { organizationId: "NATO", countryId: "TR", wantsOutSinceTurn: 90 },
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.members.map((m) => m.countryId)).toEqual(["TR", "US"]);
    expect(v.members[0]).toMatchObject({ eligible: false });
    expect(v.members[1]).toMatchObject({ eligible: true });
  });

  it("counts how long a wobbling member has been at or below the leave share", async () => {
    gameState({
      _id: "current",
      currentYear: 1953,
      currentTurn: 100,
      intOrgAlignmentEnabled: true,
    });
    alignments([{ entityId: "TR", shares: { WEST: 12, EAST: 20 }, nonAligned: 68 }]);
    orgMembers([{ organizationId: "NATO", countryId: "TR", wantsOutSinceTurn: 89 }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.members[0]!.turnsBelowGate).toBe(11);
    expect(v.sustainTurns).toBe(24);
    expect(v.joinShare).toBe(60);
    expect(v.leaveShare).toBe(40);
  });

  it("leaves turnsBelowGate null for a member in good standing", async () => {
    alignments([{ entityId: "US", shares: { WEST: 90, EAST: 2 }, nonAligned: 8 }]);
    orgMembers([{ organizationId: "NATO", countryId: "US", wantsOutSinceTurn: null }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.members[0]!.turnsBelowGate).toBeNull();
  });

  it("omits a member with no alignment row rather than guessing", async () => {
    alignments([]);
    orgMembers([{ organizationId: "NATO", countryId: "US", wantsOutSinceTurn: null }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.members).toEqual([]);
  });

  it("counts a founder below the bar down like any other member", async () => {
    // Founding status stopped being an exemption when the defection sweep lost
    // its `status === "founding"` skip (ticket #1285). The roster has to say so:
    // hiding the countdown would tell a bloc its founder is safe on the turn it
    // is in fact 5 turns into leaving.
    gameState({
      _id: "current",
      currentYear: 1953,
      currentTurn: 100,
      intOrgAlignmentEnabled: true,
    });
    alignments([{ entityId: "TR", shares: { WEST: 12, EAST: 20 }, nonAligned: 68 }]);
    orgMembers([
      {
        organizationId: "NATO",
        countryId: "TR",
        status: "founding",
        wantsOutSinceTurn: 89,
      },
    ]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.members[0]).toMatchObject({ eligible: false, wantsOut: true });
    expect(v.members[0]!.turnsBelowGate).toBe(11);
  });
  it("prices each target against its own economy", async () => {
    alignments([
      { entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 },
      { entityId: "SE", shares: { WEST: 30, EAST: 10 }, nonAligned: 60 },
    ]);
    // YU: 625/turn → 30,000 USD millions ($30bn). SE: 6,250 → $300bn.
    macroEconomies([
      { entityId: "YU", sectors: { industry: { capacity: 625 } } },
      { entityId: "SE", sectors: { industry: { capacity: 6_250 } } },
    ]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    const yu = v.targets.find((t) => t.entityId === "YU")!;
    const se = v.targets.find((t) => t.entityId === "SE")!;
    // YU leads by 28, outside the band: it absorbs a push in full, so a point
    // is the list price — a tenth of a percent of $30bn, in the fund's currency
    // (USD, rate 1.0).
    expect(yu.resistsAtHalfStrength).toBe(false);
    expect(yu.pointCostLocal).toBe(30_000_000);
    expect(yu.turnCapCostLocal).toBe(30_000_000 * 5);
    // One play caps at 10 points of list price, so past 300m a single play
    // buys nothing more (ticket #1371).
    expect(yu.playMaxPoints).toBe(10);
    expect(yu.playCapCostLocal).toBe(30_000_000 * 10);
    // SE leads by exactly 20 — inside the band, so it resists at half strength.
    // Ten times the economy, and then doubled again for the resistance: this is
    // the DELIVERED price, which is the only one a player can budget against.
    expect(se.resistsAtHalfStrength).toBe(true);
    expect(se.pointCostLocal).toBe(300_000_000 * 2);
    // The cap is on list price, so it is the same spend but half the delivered
    // points.
    expect(se.playMaxPoints).toBe(5);
    expect(se.playCapCostLocal).toBe(300_000_000 * 10);
  });

  it("quotes no price for a target whose economy is not on record", async () => {
    // Null, never zero: the command refuses these, so the tab must not offer a
    // price it cannot honour — and must not imply the nation is free.
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    macroEconomies([]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.targets[0]!.pointCostLocal).toBeNull();
    expect(v.targets[0]!.turnCapCostLocal).toBeNull();
    expect(v.targets[0]!.playCapCostLocal).toBeNull();
  });

  it("matches the spending command's currency basis in historical worlds", async () => {
    gameState({
      _id: "current",
      currentYear: 1953,
      preset: "1953-default",
      intOrgAlignmentEnabled: true,
    });
    db.collection("organizationFunds").findOne.mockResolvedValue({
      organizationId: "WARSAW_PACT",
      balanceLocal: 1e10,
      currencyCountryId: "RU",
    });
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const { localToUsd } = await import("@/lib/internationalOrganizations/organizationFund");
    const { pointsForSpend } = await import("../influence");
    const { previewEffectivePlay } = await import("../rules/previewEffectivePlay");
    const { computeDrift } = await import("../drift");
    const view = await loadOrgInfluence(db as unknown as Db, "WARSAW_PACT");
    const target = view.targets[0]!;
    const amountLocal = target.pointCostLocal!;
    const rawPoints = pointsForSpend(localToUsd("RU", amountLocal), 30_000_000_000);
    expect(rawPoints).toBeCloseTo(1, 6);
    const shares = { shares: target.shares, nonAligned: target.nonAligned };
    const actual = computeDrift({ shares, poles: ["WEST", "EAST"], pull: { EAST: rawPoints } });
    const estimated = previewEffectivePlay({
      shares,
      poles: ["WEST", "EAST"],
      poleId: "EAST",
      amountLocal,
      pointCostLocal: amountLocal,
      playMaxPoints: target.playMaxPoints,
      resistsAtHalfStrength: false,
      weight: 1,
      effectiveness: 1,
      turnCap: 5,
    });
    expect(estimated).toBeCloseTo(actual.shares.EAST! - shares.shares.EAST!, 2);
  });

  it("marks a member that cannot vote", async () => {
    alignments([{ entityId: "TR", shares: { WEST: 70, EAST: 10 }, nonAligned: 20 }]);
    orgMembers([{ organizationId: "NATO", countryId: "TR", status: "member" }]);
    db.collection("countryGameStates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "TR", enabledForPlayers: false }]),
    });

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.members).toHaveLength(1);
    expect(v.members[0]).toMatchObject({ countryId: "TR", hasVote: false });
  });

  it("marks a member that can vote", async () => {
    // The paired case: without it the one above would pass on any bug that made
    // every member voteless.
    alignments([{ entityId: "TR", shares: { WEST: 70, EAST: 10 }, nonAligned: 20 }]);
    orgMembers([{ organizationId: "NATO", countryId: "TR", status: "member" }]);
    db.collection("countryGameStates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "TR", enabledForPlayers: true }]),
    });

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.members[0]).toMatchObject({ countryId: "TR", hasVote: true });
  });
  it("prices the distance to the join gate, not just one point", async () => {
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    const yu = v.targets.find((t) => t.entityId === "YU")!;

    // 38 points from 22 to the gate at 60, at the delivered point price.
    expect(yu.costToGate).toBe(yu.pointCostLocal! * 38);
  });

  it("has no cost to gate for a nation already past it", async () => {
    // Nothing left to buy is not the same as free — a zero would sort it top
    // of "cheapest to flip", which is exactly backwards.
    alignments([{ entityId: "YU", shares: { WEST: 70, EAST: 10 }, nonAligned: 20 }]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets.find((t) => t.entityId === "YU")!.costToGate).toBeNull();
  });

  it("reports our own pole's trend, not the lead's", async () => {
    // A member's standing asks whether OUR share is falling; the lead can move
    // the other way when a third party gains.
    alignments([
      {
        entityId: "YU",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: { shares: { WEST: 25, EAST: 50 }, nonAligned: 25 },
      },
    ]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets.find((t) => t.entityId === "YU")!.ourShareTrend).toBe(-3);
  });

  it("flags an open flashpoint and its raised ceiling", async () => {
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
    db.collection("alignmentCrises").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ targetEntityId: "YU", closesTurn: 12 }]),
    });

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    const yu = v.targets.find((t) => t.entityId === "YU")!;
    expect(yu.crisis).toEqual({
      turnsRemaining: 12,
      movementCap: 7.5,
    });
    // The full turn costs the raised limit, not the usual 5.
    expect(yu.turnCapCostLocal).toBe(30_000_000 * 7.5);
  });

  it("names the orgs sanctioning a nation", async () => {
    // Sanctions erode the sanctioning bloc's own standing here, so the dossier
    // lists them among the forces acting on the nation.
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          organizationId: "NATO",
          type: "sanctions",
          status: "active",
          sanctionsTargetCountryId: "YU",
        },
      ]),
    });

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.targets.find((t) => t.entityId === "YU")!.sanctionedBy).toEqual(["NATO"]);
  });
  it("carries the world balance in both weightings", async () => {
    alignments([
      { entityId: "YU", shares: { WEST: 80, EAST: 20 }, nonAligned: 0 },
      { entityId: "SE", shares: { WEST: 20, EAST: 80 }, nonAligned: 0 },
    ]);
    macroEconomies([
      { entityId: "YU", sectors: { industry: { capacity: 1_875 } } }, // 90,000
      { entityId: "SE", sectors: { industry: { capacity: 208.334 } } }, // ~10,000
    ]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    // One nation one vote splits evenly; by economy YU's nine-to-one size
    // pulls the world Western.
    expect(v.balance!.byNations.shares.WEST).toBeCloseTo(50, 1);
    expect(v.balance!.byEconomy.shares.WEST).toBeGreaterThan(70);
    expect(v.balance!.nationCount).toBe(2);
  });

  it("weighs the whole world, not just the nations still in play", async () => {
    // Locked nations are excluded from targets but must still count toward the
    // balance, or the bar would lurch every time a country locked.
    alignments([
      { entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 },
      { entityId: "US", shares: { WEST: 96, EAST: 0 }, nonAligned: 4 }, // locked
    ]);
    macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.targets.map((t) => t.entityId)).not.toContain("US");
    expect(v.balance!.nationCount).toBe(2);
  });

  it("hides the balance when the world has no alignment rows", async () => {
    alignments([]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.balance).toBeNull();
  });

  it("carries the era's pole vocabulary for the bar", async () => {
    alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");
    expect(v.poles.map((p) => p.id)).toEqual(["WEST", "EAST"]);
    expect(v.remainderLabel.length).toBeGreaterThan(0);
  });
  describe("rival intel", () => {
    const atTurn10 = () =>
      gameState({
        _id: "current",
        currentYear: 1953,
        currentTurn: 10,
        intOrgAlignmentEnabled: true,
      });

    it("reports a rival's landed points and never its money", async () => {
      atTurn10();
      alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
      macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
      plays([
        {
          organizationId: "WARSAW_PACT",
          targetEntityId: "YU",
          appliedPoints: 6,
          effectivePoints: 4,
          amountUsd: 450_000_000,
          turn: 9,
          resolvedTurn: 9,
        },
      ]);

      const { loadOrgInfluence } = await import("./orgInfluence");
      const v = await loadOrgInfluence(db as unknown as Db, "NATO");

      expect(v.rivalIntel.YU).toEqual([
        { poleLabel: "East", accentToken: "error", pointsLanded: 4, turnsAgo: 1 },
      ]);
      // The spend must not survive the query boundary at all.
      expect(JSON.stringify(v.rivalIntel)).not.toContain("450000000");
    });

    it("exposes a rival's standing push as points, and ignores a stale one (ticket 1371)", async () => {
      atTurn10();
      alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
      macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
      plays([
        {
          organizationId: "WARSAW_PACT",
          targetEntityId: "YU",
          appliedPoints: 9.28,
          amountUsd: 450_000_000,
          turn: 9,
          resolvedTurn: 9,
        },
      ]);
      const { loadOrgInfluence } = await import("./orgInfluence");
      const v = await loadOrgInfluence(db as unknown as Db, "NATO");
      expect(v.targets[0]!.rivalPressure).toEqual({ poleId: "EAST", points: 9.28 });
      expect(JSON.stringify(v.targets)).not.toContain("450000000");
    });

    it("excludes the viewing org's own plays from intel", async () => {
      // Those are the Recent plays panel; repeating them as "rival activity"
      // would tell a player they are being attacked by themselves.
      atTurn10();
      alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
      macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
      plays([
        {
          organizationId: "NATO",
          targetEntityId: "YU",
          appliedPoints: 4,
          turn: 9,
          resolvedTurn: 9,
        },
      ]);

      const { loadOrgInfluence } = await import("./orgInfluence");
      const v = await loadOrgInfluence(db as unknown as Db, "NATO");
      expect(v.rivalIntel.YU ?? []).toEqual([]);
    });

    it("skips a play from an org with no channel this era", async () => {
      // An era crossing can strand a resolved play. It cannot be mapped to a
      // pole, and guessing would attribute the movement to the wrong bloc.
      atTurn10();
      alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
      macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
      plays([
        { organizationId: "EU", targetEntityId: "YU", appliedPoints: 3, turn: 9, resolvedTurn: 9 },
      ]);

      const { loadOrgInfluence } = await import("./orgInfluence");
      const v = await loadOrgInfluence(db as unknown as Db, "NATO");
      expect(v.rivalIntel.YU ?? []).toEqual([]);
    });

    it("keeps the resolved pole after an era change or channel disappearance", async () => {
      gameState({
        _id: "current",
        currentYear: 1992,
        currentTurn: 10,
        intOrgAlignmentEnabled: true,
      });
      plays([
        {
          organizationId: "NATO",
          targetEntityId: "YU",
          appliedPoints: 10,
          effectivePoints: 2.5,
          effectivePoleId: "WEST",
          turn: 9,
          resolvedTurn: 9,
        },
        {
          organizationId: "WARSAW_PACT",
          targetEntityId: "YU",
          appliedPoints: 10,
          effectivePoints: 0,
          effectivePoleId: "EAST",
          turn: 9,
          resolvedTurn: 9,
        },
      ]);
      const { loadOrgInfluence } = await import("./orgInfluence");
      const view = await loadOrgInfluence(db as unknown as Db, "EU");
      expect(view.rivalIntel.YU).toEqual([
        { poleLabel: "West", accentToken: "info", pointsLanded: 2.5, turnsAgo: 1 },
        { poleLabel: "East", accentToken: "error", pointsLanded: 0, turnsAgo: 1 },
      ]);
    });

    it("reports a zero effective gain rather than concealing canceled plays", async () => {
      atTurn10();
      alignments([{ entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 }]);
      macroEconomies([{ entityId: "YU", sectors: { industry: { capacity: 625 } } }]);
      plays([
        {
          organizationId: "WARSAW_PACT",
          targetEntityId: "YU",
          appliedPoints: 0,
          effectivePoints: 0,
          turn: 9,
          resolvedTurn: 9,
        },
      ]);

      const { loadOrgInfluence } = await import("./orgInfluence");
      const v = await loadOrgInfluence(db as unknown as Db, "NATO");
      expect(v.rivalIntel.YU).toEqual([
        { poleLabel: "East", accentToken: "error", pointsLanded: 0, turnsAgo: 1 },
      ]);
    });
  });
  it("marks a target that is already on our roll", async () => {
    // Drives the retention sort — you court non-members and hold members, and
    // the list has to tell them apart.
    alignments([
      { entityId: "TR", shares: { WEST: 70, EAST: 10 }, nonAligned: 20 },
      { entityId: "YU", shares: { WEST: 22, EAST: 50 }, nonAligned: 28 },
    ]);
    orgMembers([{ organizationId: "NATO", countryId: "TR", status: "member" }]);

    const { loadOrgInfluence } = await import("./orgInfluence");
    const v = await loadOrgInfluence(db as unknown as Db, "NATO");

    expect(v.targets.find((t) => t.entityId === "TR")!.isMember).toBe(true);
    expect(v.targets.find((t) => t.entityId === "YU")!.isMember).toBe(false);
  });
});
