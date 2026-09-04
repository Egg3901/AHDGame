import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockDb, type MockDb, assertSetFields } from "@/lib/test-utils/mockDb";
import { resetGameWorld, RUNTIME_WIPE_SPECIAL_CASES } from "@/lib/admin/resetGameWorld";
import { getRuntimeCollectionNames } from "@/lib/admin/seed/seedManifest";
import { getPresetById } from "@/lib/constants/historicalSeats";

vi.mock("@/lib/admin/bootstrapGameWorld", () => ({
  seedAllCountryData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/npp/seedHistorical", () => ({
  seedHistoricalOfficials: vi.fn().mockResolvedValue({ nppsCreated: 0, officialsCreated: 0 }),
}));

vi.mock("@/lib/constants/historicalSeats", () => ({
  getPresetById: vi.fn().mockReturnValue({ deleteDefaultParties: true }),
}));

vi.mock("@/lib/seeds/ensureDefaultParties", () => ({
  ensureDefaultParties: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/sequentialId", () => ({
  resetPartyCounters: vi.fn().mockResolvedValue(undefined),
  realignPartyCountersToExisting: vi.fn().mockResolvedValue(undefined),
  // ensureImfInstitutionPlaceholder calls getNextSequentialId during reset.
  getNextSequentialId: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/retireCharacter", () => ({
  retireCharacter: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/seed/seedBudgets", () => ({
  seedBudgets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/seed/seedUkBudgets", () => ({
  seedUkBudgets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/seed/seedJpBudgets", () => ({
  seedJpBudgets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/admin/seed/seedStatePolicies", () => ({
  seedStatePolicies: vi.fn().mockResolvedValue(undefined),
}));

describe("resetGameWorld", () => {
  it("wipes indexFunds with the rest of the world-bound fund ledger", () => {
    expect(getRuntimeCollectionNames()).toContain("indexFunds");
  });
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("clears corporation world collections before resetting counters", async () => {
    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
    });

    const clearedCollections = [
      "bondHistory",
      "bonds",
      "capitalActionLogs",
      "coalitions",
      "caucuses",
      "caucusMemberships",
      "caucusPolicyPositions",
      "corporationCeoVotes",
      "corporationHistory",
      "corporateSectors",
      "corporations",
      "countryState",
      "regimeEscalation",
      "extractionContracts",
      "investorRankingSnapshots",
      "marketCapHistory",
      "nppVoteCommitments",
      "nppVotePredictions",
      "politicalCapitalBalances",
      "recruitmentSlates",
      "slateCandidates",
      "shareListings",
      "shareOrders",
      "shareTradeHistory",
      "stockExchangeSnapshots",
      "treasuryTransactions",
    ];

    for (const name of clearedCollections) {
      expect(db.collectionMocks[name]?.drop).toHaveBeenCalled();
    }

    // Counters are wiped except for the party_<country> ones, which track
    // surviving default parties' sequentialIds — wiping them would make
    // ensureDefaultParties hand out a colliding seqId for a newly-added
    // preset-specific party (e.g. UUP when switching to 1991-default).
    expect(db.collectionMocks.counters?.deleteMany).toHaveBeenCalledWith({
      _id: { $not: { $regex: /^party_/ } },
    });
  });

  it("freezes outgoing office history and appends the new iteration to the registry", async () => {
    // Outgoing game state: currently Beta 2 with a known registry.
    db.collection("gameState"); // instantiate the lazy mock
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      iteration: { type: "Beta", number: 2 },
      iterationHistory: [
        { type: "Alpha", number: 1 },
        { type: "Beta", number: 1 },
        { type: "Beta", number: 2 },
      ],
      currentTurn: 100,
      lastTurnProcessed: new Date("2020-01-01T00:00:00Z"),
      startingYear: 2019,
    });
    // One unstamped country-history event should be frozen under Beta 2.
    db.collection("countryHistory"); // instantiate the lazy mock
    db.collectionMocks.countryHistory.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "c1", turn: 5 }]),
    });

    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
      iteration: { type: "Beta", number: 3 },
    });

    // Freeze stamped the unstamped event with the OUTGOING iteration (Beta 2).
    assertSetFields(db.collectionMocks.countryHistory.updateOne, {
      iteration: { type: "Beta", number: 2 },
      iterationStartingYear: 2019,
    });

    // gameState updated with the registry extended by the new iteration (Beta 3).
    assertSetFields(db.collectionMocks.gameState.updateOne, {
      iterationHistory: [
        { type: "Alpha", number: 1 },
        { type: "Beta", number: 1 },
        { type: "Beta", number: 2 },
        { type: "Beta", number: 3 },
      ],
    });
  });

  // ── Reset / manifest contract ──────────────────────────────────────────────
  // The reset wipe is driven by getRuntimeCollectionNames(). These tests pin the
  // contract so a runtime collection can never again silently survive a reset
  // (the bug class this replaced): every runtime collection is either wiped by
  // the blanket sweep or explicitly listed in RUNTIME_WIPE_SPECIAL_CASES.
  it("wipes every runtime collection not handled as a special case", async () => {
    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
    });

    for (const name of getRuntimeCollectionNames()) {
      if (RUNTIME_WIPE_SPECIAL_CASES.has(name)) continue;
      expect(
        db.collectionMocks[name]?.drop,
        `runtime collection "${name}" was not wiped on reset — add it to the sweep or to RUNTIME_WIPE_SPECIAL_CASES`
      ).toHaveBeenCalled();
    }
  });

  it("handles every special-cased runtime collection explicitly", async () => {
    // Instantiate BEFORE the call — a lazy mock created afterwards has no
    // recorded calls, so the `not.toHaveBeenCalled()` below would pass no
    // matter what the sweep did.
    db.collection("partyCharters");

    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
    });

    // The eight counted collections are deleted with {} so we can report counts.
    for (const name of [
      "electedOfficials",
      "elections",
      "electionCandidates",
      "npps",
      "actionLogs",
      "bills",
      "stateBills",
      "statePartyElections",
    ]) {
      expect(db.collectionMocks[name]?.deleteMany).toHaveBeenCalledWith({});
    }

    // counters: partial delete that spares party_<country> counters.
    expect(db.collectionMocks.counters?.deleteMany).toHaveBeenCalledWith({
      _id: { $not: { $regex: /^party_/ } },
    });

    // gameState: `current` is re-initialized in place, never blanket-deleted.
    // Only non-`current` squatter documents are removed (see the dedicated test
    // below) — a `deleteMany({})` here would destroy the world's own state doc.
    expect(db.collectionMocks.gameState?.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.gameState?.deleteMany).not.toHaveBeenCalledWith({});

    // partyCharters: excluded from the sweep because the preset-aware charter
    // cleanup owns it — that cleanup now runs in `finalizeResetGameWorld`,
    // after bootstrap, where the surviving parties' sequentialIds are the new
    // world's rather than the dead world's. What this test pins is the half
    // that stayed here: the blanket sweep must NOT drop it.
    expect(db.collectionMocks.partyCharters.drop).not.toHaveBeenCalled();
  });

  it("clears the previous world's per-world progress guards from gameState", async () => {
    // Outgoing world: a 2010s world whose turn phases have all fired. Every
    // field here is a "last time this fired" guard read by the NEW world.
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 944,
      startingYear: 2019,
      lastCensusYear: 2010,
      lastAutoSeedTurn: 944,
      lastBundestagReconciledCycle: 6,
      currentEraId: "2010s",
      lastEraCrossedYear: 2010,
      lastMetricActivationYear: 2015,
    });

    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
    });

    const currentUpdate = db.collectionMocks.gameState.updateOne.mock.calls.find(
      (c) => (c[0] as { _id?: string })?._id === "current"
    );
    expect(currentUpdate).toBeDefined();
    const unset = (currentUpdate![1] as { $unset?: Record<string, string> }).$unset;

    // Each of these left a real, confirmed regression on a live 1953 world:
    //  - lastCensusYear 2010 → no census fires until game-year 2020
    //  - lastAutoSeedTurn 944 vs currentTurn 1 → auto sector seeding never fires
    //  - lastBundestagReconciledCycle 6 → German AMS skipped for cycles 0-6
    for (const key of [
      "lastCensusYear",
      "lastCensus",
      "lastAutoSeedTurn",
      "lastExtractionAutoStrategyTurn",
      "lastBundestagReconciledCycle",
      "lastCabinetYearProcessed",
      "currentEraId",
      "lastEraCrossedYear",
      "lastMetricActivationYear",
      "eraGdpPerCapitaBaseline",
      "incomeBandIndexByCountry",
      "presidentialTenureByCountry",
    ]) {
      expect(unset?.[key], `gameState.${key} must be unset by the reset`).toBe("");
    }

    // The $set and $unset must never share a key — MongoDB rejects that update.
    const set = (currentUpdate![1] as { $set?: Record<string, unknown> }).$set ?? {};
    expect(Object.keys(set).filter((k) => k in (unset ?? {}))).toEqual([]);
  });

  it("removes squatter documents from gameState without touching `current`", async () => {
    await resetGameWorld(db as never, {
      deleteProfiles: true,
      preset: "2019-default",
      seedHistorical: false,
    });

    // `triggerDebtCeilingCrisis` writes `_id: "debt_ceiling_crisis"` into the
    // gameState collection. gameState is exempt from the runtime sweep and the
    // reset's update is filtered to `_id: "current"`, so before this purge no
    // reset could ever remove it — a 1993 crisis was still `active: true` on a
    // live 1953 world.
    expect(db.collectionMocks.gameState?.deleteMany).toHaveBeenCalledWith({
      _id: { $ne: "current" },
    });
    // Never a blanket wipe — that would delete the world's own state document.
    expect(db.collectionMocks.gameState?.deleteMany).not.toHaveBeenCalledWith({});
  });

  // ── Observability ─────────────────────────────────────────────────────────
  // The reset phase used to run entirely silently: `ResetGameWorldOptions` had
  // no `log`, and the call to `seedAllCountryData` passed `() => {}`. An admin
  // watching a reset saw nothing at all until the bootstrap phase began — which
  // is roughly half the wall time — and every seeder line that DID appear was
  // unattributable, because the bootstrap phase re-runs many of the same
  // seeders and logs identical text.
  describe("logging", () => {
    async function linesFrom(): Promise<string[]> {
      const lines: string[] = [];
      await resetGameWorld(db as never, {
        deleteProfiles: true,
        preset: "2019-default",
        seedHistorical: false,
        log: (msg) => lines.push(msg),
      });
      return lines;
    }

    it("sends its progress to the caller's sink", async () => {
      expect((await linesFrom()).length).toBeGreaterThan(0);
    });

    it("tags every line so the teardown is distinguishable from the bootstrap that follows", async () => {
      // `resetAndBootstrapGameWorld` runs bootstrapGameWorld straight after this
      // function and pipes both into one stream. Without the tag the two phases
      // are indistinguishable in the admin log.
      const lines = await linesFrom();
      expect(lines.every((l) => l.startsWith("[reset] "))).toBe(true);
    });

    it("does not throw when no logger is supplied", async () => {
      await expect(
        resetGameWorld(db as never, {
          deleteProfiles: true,
          preset: "2019-default",
          seedHistorical: false,
        })
      ).resolves.toBeTruthy();
    });

    it("reports the runtime wipe with a collection count", async () => {
      expect(
        (await linesFrom()).some((l) => /^\[reset] Wiped \d+ runtime collections/.test(l))
      ).toBe(true);
    });

    it("reports character retirement, which is a silent per-character loop", async () => {
      db.collection("characters");
      db.collectionMocks.characters.find.mockReturnValue({
        toArray: async () => [
          { _id: { toString: () => "c1" }, userId: "u1" },
          { _id: { toString: () => "c2" }, userId: "u1" },
        ],
      });
      const lines: string[] = [];

      await resetGameWorld(db as never, {
        deleteProfiles: false,
        preset: "2019-default",
        seedHistorical: false,
        log: (msg) => lines.push(msg),
      });

      expect(lines.some((l) => /^\[reset] Retired 2 character\(s\)/.test(l))).toBe(true);
    });

    it("signs off by naming what comes next, so a truncated log is legible", async () => {
      // A reset that dies mid-run leaves the admin with a partial transcript.
      // The closing line is how they tell "teardown finished, bootstrap was
      // running" from "teardown itself died".
      expect((await linesFrom()).some((l) => l.includes("Teardown complete"))).toBe(true);
    });
  });
});
