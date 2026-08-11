import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getAllCountryAccess: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationDef: vi.fn().mockResolvedValue({ id: "NATO", name: "NATO" }),
  hasOpenMembershipProposal: vi.fn().mockResolvedValue(false),
}));
// Partial: only the DB-backed check is stubbed. `resolveSeedRoster` is pure and
// is what the seed-time non-member cap reads, so replacing the whole module
// would leave the healing path capping against an empty roster.
vi.mock("@/lib/internationalOrganizations/founding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/internationalOrganizations/founding")>()),
  isOrganizationFoundedLive: vi.fn().mockResolvedValue(true),
}));

const { getAllCountryAccess } = await import("@/lib/countryAccess");
const { removeOrganizationMembership } =
  await import("@/lib/internationalOrganizations/withdrawalBills");
const { hasOpenMembershipProposal } = await import("@/lib/internationalOrganizations/service");
const { isOrganizationFoundedLive } = await import("@/lib/internationalOrganizations/founding");

describe("processAlignmentTurn", () => {
  let db: MockDb;

  const gameState = (doc: object | null) =>
    db.collection("gameState").findOne.mockResolvedValue(doc);
  const alignments = (rows: object[]) =>
    db.collection("countryAlignments").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const memberships = (rows: object[]) =>
    db.collection("organizationMemberships").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const spheres = (rows: object[]) =>
    db.collection("sphereMemberships").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const orgMemberships = (rows: object[]) =>
    db.collection("organizationMemberships").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });
  /** Active org resolutions the alignment phase reads (sanctions). */
  const orgLegislation = (rows: object[]) =>
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const crises = (rows: object[]) =>
    db.collection("alignmentCrises").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const plays = (rows: object[]) =>
    db.collection("alignmentPlays").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
  const play = (over: Record<string, unknown> = {}) => ({
    _id: "p1",
    organizationId: "NATO",
    sponsorCountryId: "US",
    targetEntityId: "YU",
    amountUsd: 900_000_000,
    amountLocal: 900_000_000,
    turn: 4,
    resolvedTurn: null,
    appliedPoints: null,
    ...over,
  });
  /** Give YU a macro economy of `perTurnCapacity × 48` USD millions. */
  const targetEconomy = (perTurnCapacity: number | null) => {
    db.collection("states").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("macroCountries").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          perTurnCapacity === null
            ? []
            : [{ entityId: "YU", sectors: { industry: { capacity: perTurnCapacity } } }]
        ),
    });
  };
  const written = (i = 0) =>
    (
      db.collection("countryAlignments").updateOne.mock.calls[i]![1] as {
        $set: {
          eraKey: string;
          shares: Record<string, number>;
          nonAligned: number;
          previous: { shares: Record<string, number>; nonAligned: number } | null;
          turn: number;
        };
      }
    ).$set;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
    alignments([]);
    memberships([]);
    spheres([]);
    plays([]);
    crises([]);
    orgMemberships([]);
    orgLegislation([]);
    // clearAllMocks resets calls but KEEPS implementations, so a per-test
    // mockResolvedValue would leak into every later test. Re-assert the default.
    vi.mocked(getAllCountryAccess).mockResolvedValue({} as never);
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(false);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(true);
    // Influence is priced against the target's live economy. YU is macro-tier,
    // so its GDP comes from sector capacity: 625 a turn × 48 = 30,000 USD
    // millions, a $30bn economy. That makes the fixture's $900m play worth
    // exactly 3 points (1% of $30bn buys one), which is the size these cases
    // were written around.
    targetEconomy(625);
  });

  it("does nothing at all when the gate is off", async () => {
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 10);
    expect(r).toEqual({
      countriesDrifted: 0,
      erasCrossed: 0,
      spheresSynced: 0,
      rowsHealed: 0,
      playsResolved: 0,
      blocStress: {},
      defections: 0,
      defectionWarnings: 0,
      joinRequests: 0,
      crisesOpened: 0,
      crisesResolved: 0,
    });
    expect(db.collection("countryAlignments").find).not.toHaveBeenCalled();
  });

  it("snapshots the prior shares into previous so a trend can be shown", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    const set = written();
    expect(set.previous).toEqual({ shares: { WEST: 22, EAST: 50 }, nonAligned: 28 });
    expect(set.turn).toBe(4);
  });

  it("crosses a world that has reached the next era and clears its trend", async () => {
    gameState({ _id: "current", currentYear: 1991, intOrgAlignmentEnabled: true });
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 60, EAST: 20 },
        nonAligned: 20,
        previous: { shares: { WEST: 58, EAST: 22 }, nonAligned: 20 },
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(r.erasCrossed).toBe(1);
    const set = written();
    expect(set.eraKey).toBe("post-cold-war");
    expect(set.previous).toBeNull();
    expect(set.shares.WASHINGTON).toBe(60);
  });

  it("always writes a row whose shares still total 100", async () => {
    alignments([
      {
        entityId: "SE",
        eraKey: "cold-war",
        shares: { WEST: 30, EAST: 18 },
        nonAligned: 52,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);
    const set = written();
    const total = Object.values(set.shares).reduce((a, b) => a + b, 0) + set.nonAligned;
    expect(total).toBe(100);
  });

  const polishMember = (turn: number, east = 40) => {
    alignments([
      {
        entityId: "PL",
        eraKey: "cold-war",
        shares: { WEST: 10, EAST: east },
        nonAligned: 90 - east,
        previous: null,
        turn: turn - 1,
      },
    ]);
    memberships([{ organizationId: "WARSAW_PACT", countryId: "PL" }]);
  };

  it("pulls a bloc member toward the pole its org channels to", async () => {
    polishMember(5);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 5);

    const set = written();
    expect(set.shares.EAST!).toBeGreaterThan(40);
    expect(set.shares.WEST!).toBeLessThanOrEqual(10);
  });

  it("moves a member every turn, by a hundredth-grid amount", async () => {
    // Smooth rather than lumpy: shares store to 0.01, so 0.04 a turn survives
    // the write. On the old tenth grid this rounded to nothing every turn and
    // the tide was inert.
    polishMember(4);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);
    expect(written().shares.EAST!).toBeCloseTo(40.04, 5);
  });

  it("will not carry a member past the drift ceiling", async () => {
    // Drift keeps an alliance's members securely in it; it never makes one
    // immovable. Past this, standing has to be bought.
    polishMember(5, 67);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 5);
    expect(written().shares.EAST!).toBe(67);
  });

  it("leaves an unaffiliated nation where it stands", async () => {
    alignments([
      {
        entityId: "SE",
        eraKey: "cold-war",
        shares: { WEST: 30, EAST: 18 },
        nonAligned: 52,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    const set = written();
    expect(set.shares).toEqual({ WEST: 30, EAST: 18 });
    // Still counted and still written — the turn number has to advance.
    expect(r.countriesDrifted).toBe(1);
  });

  it("reports how many countries it touched", async () => {
    alignments([
      {
        entityId: "SE",
        eraKey: "cold-war",
        shares: { WEST: 30 },
        nonAligned: 70,
        previous: null,
        turn: 3,
      },
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { EAST: 40 },
        nonAligned: 60,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);
    expect(r).toEqual({
      countriesDrifted: 2,
      erasCrossed: 0,
      spheresSynced: 0,
      rowsHealed: 0,
      playsResolved: 0,
      // 1953 channels are NATO and the Warsaw Pact; both settled here.
      blocStress: { NATO: 0, WARSAW_PACT: 0 },
      defections: 0,
      defectionWarnings: 0,
      joinRequests: 0,
      crisesOpened: 0,
      crisesResolved: 0,
    });
  });

  it("migrates a sphere membership when alignment crosses the join gate", async () => {
    alignments([
      {
        entityId: "AT",
        eraKey: "cold-war",
        shares: { WEST: 8, EAST: 60 },
        nonAligned: 32,
        previous: null,
        turn: 3,
      },
    ]);
    spheres([
      {
        _id: "AT",
        entityId: "AT",
        presetId: "1953-default",
        primarySphereId: "US",
        relationships: [
          {
            sponsorId: "US",
            alignment: 0.6,
            integration: 0.5,
            treatyIds: [],
            treatyState: "active",
          },
          { sponsorId: "RU", alignment: 0.1, integration: 0.2, treatyIds: [], treatyState: "none" },
        ],
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(r.spheresSynced).toBe(1);
    const set = (
      db.collection("sphereMemberships").updateOne.mock.calls[0]![1] as {
        $set: {
          primarySphereId: string | null;
          relationships: Array<{ sponsorId: string; alignment: number; integration: number }>;
        };
      }
    ).$set;
    expect(set.primarySphereId).toBe("RU");
    expect(set.relationships.find((x) => x.sponsorId === "RU")!.alignment).toBeCloseTo(0.6, 5);
    // Integration is sphere-owned and must survive untouched.
    expect(set.relationships.find((x) => x.sponsorId === "US")!.integration).toBe(0.5);
  });

  it("leaves alignment rows with no sphere membership alone", async () => {
    alignments([
      {
        entityId: "SE",
        eraKey: "cold-war",
        shares: { WEST: 30, EAST: 18 },
        nonAligned: 52,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);
    expect(r.spheresSynced).toBe(0);
    expect(db.collection("sphereMemberships").updateOne).not.toHaveBeenCalled();
  });

  it("heals a row for an entity that came into existence after the world was seeded", async () => {
    // Ghana does not exist in 1953, so seeding skipped it. It emerges in 1957
    // with a sphere membership; without a row its alignment would never move.
    alignments([]);
    spheres([
      {
        _id: "GH",
        entityId: "GH",
        presetId: "1953-default",
        primarySphereId: "UK",
        relationships: [
          {
            sponsorId: "UK",
            alignment: 0.3,
            integration: 0.2,
            treatyIds: [],
            treatyState: "active",
          },
        ],
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 200);

    expect(r.rowsHealed).toBe(1);
    const doc = db.collection("countryAlignments").insertOne.mock.calls[0]![0] as {
      entityId: string;
      shares: Record<string, number>;
      nonAligned: number;
    };
    expect(doc.entityId).toBe("GH");
    const sum = Object.values(doc.shares).reduce((a, b) => a + b, 0) + doc.nonAligned;
    expect(sum).toBe(100);
    // Healed in the same pass it was created, so it drifts immediately.
    expect(r.countriesDrifted).toBe(1);
  });

  it("heals an organization member that no sphere doc sponsors", async () => {
    // Membership is entity-wide, so a bloc can seat a Background Nation: NATO
    // seats Canada and the Benelux, the Warsaw Pact seats Albania. None has a
    // sphere doc, so the sphere-only heal never reached them — they were absent
    // from the Influence tab's own member roster, and with no standing nothing
    // could ever measure them against the leave gate.
    alignments([]);
    spheres([]);
    memberships([{ organizationId: "NATO", countryId: "CA" }]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 200);

    expect(r.rowsHealed).toBe(1);
    const doc = db.collection("countryAlignments").insertOne.mock.calls[0]![0] as {
      entityId: string;
    };
    expect(doc.entityId).toBe("CA");
  });
  it("does not heal a row that already exists", async () => {
    alignments([
      {
        entityId: "AT",
        eraKey: "cold-war",
        shares: { WEST: 40, EAST: 10 },
        nonAligned: 50,
        previous: null,
        turn: 3,
      },
    ]);
    spheres([
      {
        _id: "AT",
        entityId: "AT",
        presetId: "1953-default",
        primarySphereId: null,
        relationships: [],
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);
    expect(r.rowsHealed).toBe(0);
    expect(db.collection("countryAlignments").insertOne).not.toHaveBeenCalled();
  });

  it("crosses a healed row into the live era instead of mislabelling it", async () => {
    // A 1953-preset world that has run past 1991. Opening shares are built in
    // the PRESET's poles (West/East); stamping them with the live era would
    // freeze West/East values in a Washington/Moscow world forever.
    gameState({ _id: "current", currentYear: 1995, intOrgAlignmentEnabled: true });
    alignments([]);
    spheres([
      {
        _id: "GH",
        entityId: "GH",
        presetId: "1953-default",
        primarySphereId: null,
        relationships: [],
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 3000);

    expect(r.rowsHealed).toBe(1);
    expect(r.erasCrossed).toBe(1);
    const set = written();
    expect(set.eraKey).toBe("post-cold-war");
    expect(set.shares.WEST).toBeUndefined();
    expect(set.shares.EAST).toBeUndefined();
    expect(set.shares.WASHINGTON).toBeGreaterThanOrEqual(0);
  });

  it("buys less in a larger economy than the same money buys in a small one", async () => {
    // The whole point of pricing against GDP: identical cheques, different
    // countries, different results. Ten times the economy, a tenth the effect.
    const shares = {
      entityId: "YU",
      eraKey: "cold-war",
      shares: { WEST: 22, EAST: 50 },
      nonAligned: 28,
      previous: null,
      turn: 3,
    };
    const { processAlignmentTurn } = await import("./alignmentPhase");

    alignments([shares]);
    plays([play()]);
    targetEconomy(625); // $30bn
    await processAlignmentTurn(db as unknown as Db, 4);
    const smallEconomyGain = written().shares.WEST! - 22;

    vi.clearAllMocks();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
    spheres([]);
    crises([]);
    orgMemberships([]);
    vi.mocked(getAllCountryAccess).mockResolvedValue({} as never);
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(false);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(true);
    alignments([shares]);
    plays([play()]);
    targetEconomy(6_250); // $300bn
    await processAlignmentTurn(db as unknown as Db, 4);
    const largeEconomyGain = written().shares.WEST! - 22;

    // Ten times the economy, a tenth of the effect — exactly proportional,
    // which is what pricing against GDP is supposed to mean. Shares resolve to
    // a tenth of a point, so the small effect registers as 0.3 rather than
    // rounding away to nothing the way it did at whole-point resolution.
    expect(smallEconomyGain).toBeCloseTo(3, 9);
    expect(largeEconomyGain).toBeCloseTo(0.3, 9);
    expect(smallEconomyGain).toBeCloseTo(largeEconomyGain * 10, 9);
  });

  it("resolves a play against a target it cannot price without moving it", async () => {
    // The command refuses these up front, but a target's economy can vanish
    // between commit and resolution. The play must settle at zero rather than
    // hang pending forever or move the nation for free.
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play()]);
    targetEconomy(null);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(r.playsResolved).toBe(1);
    expect(written().shares.WEST).toBe(22);
  });

  // Bloc stress reaching the resolution, not just the helper. A correct
  // `computeBlocStress` that the phase never consulted would leave an
  // overextended alliance pushing exactly as hard as a settled one.
  describe("bloc stress", () => {
    // CA is NATO's member here, so it needs its own alignment row — without one
    // its WEST share reads 0 and a "settled" bloc looks contested.
    const yu = () => [
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
      {
        entityId: "CA",
        eraKey: "cold-war",
        shares: { WEST: 95, EAST: 2 },
        nonAligned: 3,
        previous: null,
        turn: 3,
      },
    ];

    async function runWithNatoMembers(rows: object[]) {
      alignments(yu());
      memberships(rows);
      plays([play()]);
      const { processAlignmentTurn } = await import("./alignmentPhase");
      const r = await processAlignmentTurn(db as unknown as Db, 4);
      return { result: r, shares: written().shares };
    }

    it("an overextended bloc's play moves the target less than a settled one's", async () => {
      // Settled: a member NATO holds above the locked gate, long acceded.
      const settled = await runWithNatoMembers([
        { organizationId: "NATO", countryId: "CA", joinedTurn: -20, wantsOutSinceTurn: null },
      ]);
      vi.clearAllMocks();
      // Overextended: contested, heading out, and freshly acceded.
      const strained = await runWithNatoMembers([
        { organizationId: "NATO", countryId: "CA", joinedTurn: 4, wantsOutSinceTurn: 3 },
      ]);

      expect(settled.result.blocStress.NATO).toBe(0);
      expect(strained.result.blocStress.NATO).toBeGreaterThan(0);
      expect(strained.shares.WEST).toBeLessThan(settled.shares.WEST);
    });

    it("records the stress it applied, so the dampening is visible", async () => {
      const { result } = await runWithNatoMembers([
        { organizationId: "NATO", countryId: "CA", joinedTurn: 4, wantsOutSinceTurn: 3 },
      ]);
      expect(result.blocStress).toHaveProperty("NATO");
      expect(result.blocStress.NATO).toBeGreaterThan(0);
      expect(result.blocStress.NATO).toBeLessThanOrEqual(1);
    });
  });

  it("applies a queued play toward the org's pole", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(r.playsResolved).toBe(1);
    expect(written().shares.WEST!).toBeGreaterThan(22);
  });

  it("erodes a bloc's own standing in a nation it is sanctioning", async () => {
    // Sanctions used to be a free hit. Squeezing a country now costs the
    // squeezer standing there, which is what gives the instrument a price.
    // YU is contested (lead 20), so it resists at half strength: a 1-point
    // erosion lands as 0.5. Shares resolve to a tenth, so that registers and
    // accumulates instead of rounding away every turn.
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 40, EAST: 20 },
        nonAligned: 40,
        previous: null,
        turn: 3,
      },
    ]);
    orgLegislation([
      {
        organizationId: "NATO",
        type: "sanctions",
        status: "active",
        sanctionsTargetCountryId: "YU",
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    const set = written();
    expect(set.shares.WEST!).toBeLessThan(40);
    // The resentment is not handed to Moscow — the uncommitted pool absorbs it,
    // and a rival still has to act to collect.
    expect(set.shares.EAST!).toBe(20);
  });

  it("leaves a nation alone once the sanctions lapse", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 40, EAST: 20 },
        nonAligned: 40,
        previous: null,
        turn: 3,
      },
    ]);
    orgLegislation([]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    expect(written().shares.WEST!).toBe(40);
  });

  it("takes ground from the uncommitted, not from a rival that did nothing", async () => {
    // Nothing fires on its own any more. A bloc that spends nothing loses no
    // share; the gain comes out of the uncommitted remainder.
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    const set = written();
    expect(set.shares.WEST!).toBeGreaterThan(22);
    expect(set.shares.EAST!).toBe(50);
    expect(set.nonAligned).toBeLessThan(28);
  });

  it("only cancels a rival's play when it actually makes one of its own", async () => {
    // The meter moves on what organisations DO. Two equal pushes in opposite
    // directions are a stalemate — and it costs both of them to produce it.
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play(), play({ _id: "p2", organizationId: "WARSAW_PACT", sponsorCountryId: "RU" })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    const set = written();
    expect(set.shares.WEST!).toBe(22);
    expect(set.shares.EAST!).toBe(50);
  });

  it("stamps a resolved play so a member can see what its money bought", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 22, EAST: 50 },
        nonAligned: 28,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play({ amountUsd: 100_000_000 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 7);

    const set = (
      db.collection("alignmentPlays").updateOne.mock.calls[0]![1] as {
        $set: { resolvedTurn: number; appliedPoints: number };
      }
    ).$set;
    expect(set.resolvedTurn).toBe(7);
    expect(set.appliedPoints).toBeGreaterThan(0);
  });

  it("resolves a play whose target has no row rather than leaking it forever", async () => {
    alignments([]);
    plays([play({ targetEntityId: "TANG" })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(db.collection("alignmentPlays").updateOne).toHaveBeenCalled();
    expect(r.playsResolved).toBe(1);
  });

  it("does not move a locked nation even with a play against it", async () => {
    alignments([
      {
        entityId: "PL",
        eraKey: "cold-war",
        shares: { WEST: 2, EAST: 90 },
        nonAligned: 8,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play({ targetEntityId: "PL", amountUsd: 1e12 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    expect(written().shares).toEqual({ WEST: 2, EAST: 90 });
  });

  it("stamps zero when the target locked between commit and resolution", async () => {
    // The command refuses a locked target up front, but a nation can lock in the
    // turns between. Drift no-ops it, so the play bought nothing and must not be
    // reported as though it had.
    alignments([
      {
        entityId: "PL",
        eraKey: "cold-war",
        shares: { WEST: 2, EAST: 90 },
        nonAligned: 8,
        previous: null,
        turn: 3,
      },
    ]);
    plays([play({ targetEntityId: "PL", amountUsd: 9e8 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    const set = (
      db.collection("alignmentPlays").updateOne.mock.calls[0]![1] as {
        $set: { appliedPoints: number };
      }
    ).$set;
    expect(set.appliedPoints).toBe(0);
  });

  /** A NATO member whose alignment has collapsed, below the gate since turn 1. */
  const wobbling = (over: Record<string, unknown> = {}) => ({
    _id: "m1",
    organizationId: "NATO",
    countryId: "YU",
    status: "active",
    wantsOutSinceTurn: 1,
    ...over,
  });
  /** Yugoslavia leaning East — a Western share of 10, well under the leave share. */
  const collapsedRow = {
    entityId: "YU",
    eraKey: "cold-war",
    shares: { WEST: 10, EAST: 55 },
    nonAligned: 35,
    previous: null,
    turn: 3,
  };

  it("removes a non-player member whose share has sat at or below 40 long enough", async () => {
    alignments([collapsedRow]);
    orgMemberships([wobbling()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(1);
    expect(vi.mocked(removeOrganizationMembership)).toHaveBeenCalledWith(
      expect.anything(),
      "YU",
      "NATO",
      "NATO",
      100,
      expect.anything()
    );
  });

  it("does not remove one that has not been there long enough", async () => {
    alignments([collapsedRow]);
    orgMemberships([wobbling({ wantsOutSinceTurn: 90 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100); // only 10 turns

    expect(r.defections).toBe(0);
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });

  it("warns but never removes a player-controlled member", async () => {
    vi.mocked(getAllCountryAccess).mockResolvedValue({ YU: { enabledForPlayers: true } } as never);
    alignments([collapsedRow]);
    orgMemberships([wobbling()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defectionWarnings).toBe(1);
    expect(r.defections).toBe(0);
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
  });

  it("starts the clock the first turn a member falls to the leave share", async () => {
    alignments([collapsedRow]);
    orgMemberships([wobbling({ wantsOutSinceTurn: null })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(0);
    const call = db.collection("organizationMemberships").updateOne.mock.calls[0]!;
    expect((call[1] as { $set: { wantsOutSinceTurn: number } }).$set.wantsOutSinceTurn).toBe(100);
  });

  it("clears the clock when a member recovers, so the run must be sustained", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 60, EAST: 5 },
        nonAligned: 35,
        previous: null,
        turn: 3,
      },
    ]);
    orgMemberships([wobbling()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(0);
    const call = db.collection("organizationMemberships").updateOne.mock.calls[0]!;
    expect((call[1] as { $set: { wantsOutSinceTurn: null } }).$set.wantsOutSinceTurn).toBeNull();
  });

  it("never defects anyone from an org with no alignment channel", async () => {
    alignments([collapsedRow]);
    orgMemberships([wobbling({ organizationId: "UN" })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(0);
    expect(db.collection("organizationMemberships").updateOne).not.toHaveBeenCalled();
  });

  it("reads the share in the org's own pole, not the nation's best pole", async () => {
    // 70 toward Moscow says nothing good about a NATO membership: what matters is
    // that only 5 of this nation is Western.
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 5, EAST: 70 },
        nonAligned: 25,
        previous: null,
        turn: 3,
      },
    ]);
    orgMemberships([wobbling()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    expect(r.defections).toBe(1);
  });

  it("never shows a founding member the door, whatever its standing", async () => {
    // Nigeria founds the Commonwealth while still a colony, so it carries a
    // colony's damped metropole alignment and sits below its own bloc's bar.
    // You cannot be expelled from a club you founded.
    alignments([collapsedRow]);
    orgMemberships([wobbling({ status: "founding" })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(0);
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
    // Not even a clock is started for one.
    expect(db.collection("organizationMemberships").updateOne).not.toHaveBeenCalled();
  });

  /** A nation firmly Western, join-ready since turn 1. */
  const joinReadyRow = (over: Record<string, unknown> = {}) => ({
    entityId: "SE",
    eraKey: "cold-war",
    shares: { WEST: 70, EAST: 5 },
    nonAligned: 25,
    previous: null,
    joinReadySince: { WEST: 1 },
    turn: 3,
    ...over,
  });

  it("asks to join a bloc it has held the join share in for a sustained run", async () => {
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.joinRequests).toBeGreaterThanOrEqual(1);
    const proposal = db.collection("organizationMembershipProposals").insertOne.mock
      .calls[0]![0] as {
      proposingCountryId: string;
      status: string;
      domesticApproved: boolean;
    };
    expect(proposal.proposingCountryId).toBe("SE");
    expect(proposal.status).toBe("pending");
    // The org's unanimous member vote is left as the only live gate.
    expect(proposal.domesticApproved).toBe(true);
  });

  it("does not ask before the run is long enough", async () => {
    alignments([joinReadyRow({ joinReadySince: { WEST: 90 } })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100); // only 10 turns
    expect(r.joinRequests).toBe(0);
    expect(db.collection("organizationMembershipProposals").insertOne).not.toHaveBeenCalled();
  });

  it("never asks on a player's behalf — they choose their own alliances", async () => {
    vi.mocked(getAllCountryAccess).mockResolvedValue({ SE: { enabledForPlayers: true } } as never);
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    expect(r.joinRequests).toBe(0);
  });

  it("does not ask to join an org it already belongs to", async () => {
    alignments([joinReadyRow()]);
    orgMemberships([
      {
        _id: "m9",
        organizationId: "NATO",
        countryId: "SE",
        status: "active",
        wantsOutSinceTurn: null,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    // NATO is skipped; the Commonwealth channel is still open to it.
    const asked = db
      .collection("organizationMembershipProposals")
      .insertOne.mock.calls.map(
        (c: unknown[]) => (c[0] as { organizationId: string }).organizationId
      );
    expect(asked).not.toContain("NATO");
    expect(r.joinRequests).toBe(asked.length);
  });

  it("does not ask twice while a proposal is already open", async () => {
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(true);
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    expect(r.joinRequests).toBe(0);
  });

  it("does not ask to join an org that has not been founded yet", async () => {
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(false);
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    expect(r.joinRequests).toBe(0);
  });

  it("starts the accession clock the first turn a share reaches the join threshold", async () => {
    alignments([joinReadyRow({ joinReadySince: null })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 100);

    const set = written();
    expect((set as unknown as { joinReadySince: Record<string, number> }).joinReadySince.WEST).toBe(
      100
    );
  });

  it("clears the accession clock when the share slips back", async () => {
    alignments([
      {
        entityId: "SE",
        eraKey: "cold-war",
        shares: { WEST: 30, EAST: 20 },
        nonAligned: 50,
        previous: null,
        joinReadySince: { WEST: 1 },
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 100);

    const set = written() as unknown as { joinReadySince: Record<string, number> };
    expect(set.joinReadySince.WEST).toBeUndefined();
  });

  it("does not pester an org that refused it recently", async () => {
    // Without a cooldown a refused applicant re-applies on the very next turn,
    // forever: its share is still high and the accession clock still old.
    db.collection("organizationMembershipProposals").findOne.mockResolvedValue({
      organizationId: "NATO",
      proposingCountryId: "SE",
      status: "rejected",
      resolvedOnTurn: 95,
    });
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);
    expect(r.joinRequests).toBe(0);
  });

  it("asks to join NATO and nothing else when it swings West", async () => {
    // The Commonwealth shares NATO's pole but is a former-empire association, so
    // being Western is no claim on it.
    alignments([joinReadyRow()]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    const asked = db
      .collection("organizationMembershipProposals")
      .insertOne.mock.calls.map(
        (c: unknown[]) => (c[0] as { organizationId: string }).organizationId
      );
    expect(asked).toEqual(["NATO"]);
    expect(r.joinRequests).toBe(1);
  });

  it("never walks a nation out of the Commonwealth for ceasing to be Western", async () => {
    alignments([collapsedRow]);
    orgMemberships([wobbling({ organizationId: "COMMONWEALTH" })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 100);

    expect(r.defections).toBe(0);
    expect(vi.mocked(removeOrganizationMembership)).not.toHaveBeenCalled();
    // No clock is even started for it.
    expect(db.collection("organizationMemberships").updateOne).not.toHaveBeenCalled();
  });

  it("lets a nation in crisis move further than one that is not", async () => {
    // A committed nation: the non-aligned halving would otherwise cut a maxed
    // play down to exactly the normal ceiling, and the crisis one would never
    // bind.
    const shares = { WEST: 60, EAST: 20 };
    const rowFor = (entityId: string) => ({
      entityId,
      eraKey: "cold-war",
      shares,
      nonAligned: 20,
      previous: null,
      turn: 3,
    });

    alignments([rowFor("YU")]);
    plays([play({ targetEntityId: "YU", amountUsd: 1e12 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);
    const calmGain = written().shares.WEST! - 60;

    vi.clearAllMocks();
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: true });
    memberships([]);
    spheres([]);
    orgMemberships([]);
    alignments([rowFor("YU")]);
    plays([play({ targetEntityId: "YU", amountUsd: 1e12 })]);
    crises([{ _id: "c1", targetEntityId: "YU", status: "open", closesTurn: 99 }]);
    await processAlignmentTurn(db as unknown as Db, 4);
    const crisisGain = written().shares.WEST! - 60;

    expect(crisisGain).toBeGreaterThan(calmGain);
  });

  it("changes nothing on its own when nobody acts on a flashpoint", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 30, EAST: 30 },
        nonAligned: 40,
        previous: null,
        turn: 3,
      },
    ]);
    crises([{ _id: "c1", targetEntityId: "YU", status: "open", closesTurn: 99 }]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);

    // A raised ceiling is not a grant.
    expect(written().shares).toEqual({ WEST: 30, EAST: 30 });
  });

  it("closes a crisis whose window has passed", async () => {
    alignments([]);
    crises([{ _id: "c1", targetEntityId: "YU", status: "open", closesTurn: 4 }]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);
    expect(r.crisesResolved).toBe(1);
  });

  it("still cannot move a locked nation, crisis or not", async () => {
    alignments([
      {
        entityId: "PL",
        eraKey: "cold-war",
        shares: { WEST: 2, EAST: 90 },
        nonAligned: 8,
        previous: null,
        turn: 3,
      },
    ]);
    crises([{ _id: "c1", targetEntityId: "PL", status: "open", closesTurn: 99 }]);
    plays([play({ targetEntityId: "PL", amountUsd: 1e12 })]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    await processAlignmentTurn(db as unknown as Db, 4);
    expect(written().shares).toEqual({ WEST: 2, EAST: 90 });
  });

  it("opens a flashpoint over a nation two blocs are dug into", async () => {
    alignments([
      {
        entityId: "YU",
        eraKey: "cold-war",
        shares: { WEST: 32, EAST: 30 },
        nonAligned: 38,
        previous: null,
        turn: 3,
      },
    ]);
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);

    expect(r.crisesOpened).toBe(1);
    const doc = db.collection("alignmentCrises").insertOne.mock.calls[0]![0] as {
      targetEntityId: string;
      kind: string;
    };
    expect(doc.targetEntityId).toBe("YU");
  });

  it("opens nothing at all when the gate is off", async () => {
    gameState({ _id: "current", currentYear: 1953, intOrgAlignmentEnabled: false });
    const { processAlignmentTurn } = await import("./alignmentPhase");
    const r = await processAlignmentTurn(db as unknown as Db, 4);
    expect(r.crisesOpened).toBe(0);
    expect(r.crisesResolved).toBe(0);
    expect(db.collection("alignmentCrises").find).not.toHaveBeenCalled();
  });
});
