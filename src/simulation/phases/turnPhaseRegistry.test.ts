import { describe, expect, it, vi } from "vitest";
import { getTurnPhaseRegistry } from "@/simulation/phases/turnPhaseRegistry";
import { TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";

describe("turn phase registry", () => {
  it("preserves the high-level Wave 7 execution order", () => {
    const keys = getTurnPhaseRegistry().map((entry) => entry.key);

    expect(keys).toEqual([
      "expiredBannedShareholderCleanup",
      "inactiveShareholderShareRelease",
      "resourceAndFinanceStart",
      "demographicsAndPartySetup",
      "billsCampaignsAndActivity",
      "electionResolutionAndGovernment",
      "electionCoverageAndSuccession",
      "fiscalYearBoundary",
      "stateEffectsAndNationalAggregation",
      "indexFunds",
      "moneySupplySnapshot",
      "ledgerBalanceSnapshot",
      "ledgerReconcile",
      "economicVitalSigns",
    ]);
  });

  it("runs npcBankPolicyTurn immediately before bankingTurn", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(phaseIndex.get("npcBankPolicyTurn"), "npcBankPolicyTurn must be registered").not.toBe(
      undefined
    );
    expect(phaseIndex.get("npcBankPolicyTurn")).toBe(
      (phaseIndex.get("savingsInterestTurn") ?? -1) + 1
    );
    expect(phaseIndex.get("bankingTurn"), "bankingTurn must be registered").not.toBe(undefined);
    expect(phaseIndex.get("bankingTurn")).toBe((phaseIndex.get("npcBankPolicyTurn") ?? -1) + 1);
  });

  it("runs bankSolvencyTurn immediately after recomputeSharePrices", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(phaseIndex.get("bankSolvencyTurn"), "bankSolvencyTurn must be registered").not.toBe(
      undefined
    );
    expect(phaseIndex.get("bankSolvencyTurn")).toBe(
      (phaseIndex.get("recomputeSharePrices") ?? -1) + 1
    );
  });

  it("releases inactive-user shares before the corporation turn", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(
      phaseIndex.get("inactiveShareholderShareRelease"),
      "inactiveShareholderShareRelease must be registered"
    ).not.toBe(undefined);
    expect(phaseIndex.get("inactiveShareholderShareRelease") ?? -1).toBeLessThan(
      phaseIndex.get("corporationTurn") ?? -1
    );
  });

  it("registers NPP union behavior immediately after the union economy", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    const unionsTurn = phaseIndex.get("unionsTurn");
    const nppUnionBehavior = phaseIndex.get("nppUnionBehavior");

    expect(unionsTurn, "unionsTurn must be registered").not.toBeUndefined();
    expect(nppUnionBehavior, "nppUnionBehavior must be registered").not.toBeUndefined();
    expect(nppUnionBehavior).toBe((unionsTurn as number) + 1);
  });

  it("registers socialAxisDrift after billLifecycle (reads the statePolicies it writes)", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(phaseIndex.get("socialAxisDrift"), "socialAxisDrift must be registered").not.toBe(
      undefined
    );
    expect(phaseIndex.get("socialAxisDrift") ?? -1).toBeGreaterThan(
      phaseIndex.get("billLifecycle") ?? -1
    );
  });

  it("runs demographicFlows after metricEngine and before nationalMetrics", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(phaseIndex.get("demographicFlows")).toBeGreaterThan(
      phaseIndex.get("metricEngine") ?? -1
    );
    expect(phaseIndex.get("nationalMetrics")).toBeGreaterThan(
      phaseIndex.get("demographicFlows") ?? -1
    );
  });

  it("runs wealth and portfolio snapshots after the value-affecting turn phases", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));

    expect(phaseIndex.get("portfolioSnapshot")).toBeGreaterThan(phaseIndex.get("forexTurn") ?? -1);
    expect(phaseIndex.get("portfolioSnapshot")).toBeGreaterThan(
      phaseIndex.get("centralBankChairSelection") ?? -1
    );
    expect(phaseIndex.get("portfolioSnapshot")).toBeGreaterThan(
      phaseIndex.get("interestRateSnapshot") ?? -1
    );
    expect(phaseIndex.get("corpPortfolioSnapshot")).toBeGreaterThan(
      phaseIndex.get("portfolioSnapshot") ?? -1
    );
    expect(phaseIndex.get("stockExchangeSnapshot")).toBeGreaterThan(
      phaseIndex.get("corpPortfolioSnapshot") ?? -1
    );
    expect(phaseIndex.get("investorRankingSnapshot")).toBeGreaterThan(
      phaseIndex.get("stockExchangeSnapshot") ?? -1
    );
    expect(phaseIndex.get("wealthListSnapshot")).toBeGreaterThan(
      phaseIndex.get("investorRankingSnapshot") ?? -1
    );
  });

  it("runs macroCountryTurn before commodityPrices so same-turn refreshes apply", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    expect(phaseIndex.get("macroCountryTurn"), "macroCountryTurn must be registered").not.toBe(
      undefined
    );
    expect(phaseIndex.get("macroCountryTurn") ?? -1).toBeLessThan(
      phaseIndex.get("commodityPrices") ?? -1
    );
    expect(phaseIndex.get("macroCountryTurn") ?? -1).toBeGreaterThan(
      phaseIndex.get("prospectingResolution") ?? -1
    );
  });

  it("runs chair executive-removal after the chair turn and before chair selection", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));

    expect(phaseIndex.get("centralBankChairExecutiveRemoval")).toBeGreaterThan(
      phaseIndex.get("centralBankChairTurn") ?? -1
    );
    expect(phaseIndex.get("centralBankChairSelection")).toBeGreaterThan(
      phaseIndex.get("centralBankChairExecutiveRemoval") ?? -1
    );
  });

  // The canonical election-resolution sequence — documented in
  // `docs/design/elections.md` §Turn Processing Order and called out in
  // `turnPhaseRegistry.ts`: "Group 7 is strictly sequential. Reordering
  // any of these steps corrupts elections by dropping final-turn votes
  // or resolving offices from stale tallies."
  //
  // The invariant: candidates swept → primaries resolve → general votes
  // accumulate → timers advance → completed elections resolve.
  it("enforces the election-resolution ordering: sweep → primary → vote → timers → resolution", () => {
    const phaseIndex = new Map(TURN_PHASE_NAMES.map((name, index) => [name, index]));
    const indexOf = (phase: string) => {
      const i = phaseIndex.get(phase);
      expect(i, `phase '${phase}' must be registered`).not.toBeUndefined();
      return i as number;
    };

    const sweep = indexOf("candidatePartySweep");
    const primary = indexOf("primaryResolution");
    const vote = indexOf("voteAccumulation");
    const timers = indexOf("electionTimers");
    const resolution = indexOf("electionResolution");

    expect(sweep).toBeLessThan(primary);
    expect(primary).toBeLessThan(vote);
    expect(vote).toBeLessThan(timers);
    expect(timers).toBeLessThan(resolution);
  });

  it("electionResolutionAndGovernment adapter calls primaryResolution before voteAccumulation before electionTimers before electionResolution", async () => {
    const registry = getTurnPhaseRegistry();
    const adapter = registry.find((a) => a.key === "electionResolutionAndGovernment");
    expect(adapter).toBeDefined();

    const calledPhases: string[] = [];
    const runPhase = vi.fn(async (name: string, _fn: () => unknown) => {
      calledPhases.push(name);
      // Make generalResolved=0 so the conditional leadershipVacate path is
      // skipped — we don't need to assert anything about it here, just keep
      // the adapter happy.
      return name === "electionResolution" ? 0 : undefined;
    });

    const context = {
      db: {} as never,
      gameNow: new Date(),
      newTurn: 2,
      phaseResults: {} as Record<string, unknown>,
    } as never;
    const runtime = { runPhase, markPhaseSkipped: vi.fn() } as never;

    await adapter!.execute(context, runtime);

    const indexOf = (phase: string) => {
      const i = calledPhases.indexOf(phase);
      expect(i, `phase '${phase}' should have been invoked`).toBeGreaterThanOrEqual(0);
      return i;
    };

    expect(indexOf("candidatePartySweep")).toBeLessThan(indexOf("primaryResolution"));
    expect(indexOf("primaryResolution")).toBeLessThan(indexOf("voteAccumulation"));
    expect(indexOf("voteAccumulation")).toBeLessThan(indexOf("electionTimers"));
    expect(indexOf("electionTimers")).toBeLessThan(indexOf("electionResolution"));
  });

  // Office-state docs are created only at bootstrap/reset, so a regional
  // executive seated for a region added later (e.g. the Ireland build-out)
  // never gets a `governorOfficeState` row — its office AP reads `?? 0` and
  // `governorAPRegen` has nothing to increment, freezing AP at 0 forever. The
  // fix runs the idempotent office-state seed each turn, BEFORE regen, so any
  // missing row is created (at cap) and then eligible for regen the same turn.
  it("seeds missing office-state docs before regenerating office AP", async () => {
    const adapter = getTurnPhaseRegistry().find((a) => a.key === "billsCampaignsAndActivity");
    expect(adapter).toBeDefined();

    const calledPhases: string[] = [];
    const runPhase = vi.fn(async (name: string, _fn: () => unknown) => {
      calledPhases.push(name);
      return undefined;
    });
    const markPhaseSkipped = vi.fn(async () => undefined);

    const context = {
      realNow: new Date(),
      gameNow: new Date(),
      newTurn: 2,
      // The dispatch reads the registered-country set (dissolved-country gate)
      // before fanning phases out; an empty read means "all static countries".
      db: {
        collection: () => ({ find: () => ({ toArray: async () => [] }) }),
      } as never,
      config: {} as never,
      gameState: { playerRandomEventsEnabled: false },
      phaseResults: {} as Record<string, unknown>,
    } as never;
    const runtime = { runPhase, markPhaseSkipped } as never;

    await adapter!.execute(context, runtime);

    const seedIdx = calledPhases.indexOf("officeStateSeed");
    const regenIdx = calledPhases.indexOf("governorAPRegen");
    expect(seedIdx, "officeStateSeed should be invoked").toBeGreaterThanOrEqual(0);
    expect(regenIdx, "governorAPRegen should be invoked").toBeGreaterThanOrEqual(0);
    expect(seedIdx).toBeLessThan(regenIdx);
  });

  // Fix 2: when an admin pauses corporation actions, the corporate turn phase
  // must not run — making the admin toggle's "corporate phases will be skipped
  // during turn processing" promise true. runPhase is a recording stub that does
  // NOT invoke the phase body, so this isolates the gate decision.
  describe("resourceAndFinanceStart — corporationTurn pause gate", () => {
    function makeContext(corporationActionsPaused: boolean) {
      return {
        characters: [],
        config: { baseActionsPerTurn: 4 },
        gameNow: new Date(),
        stateMap: new Map(),
        gameState: { corporationActionsPaused, forexEnabled: false },
        newTurn: 5,
        db: {} as never,
        phaseResults: {} as Record<string, unknown>,
      } as never;
    }

    async function runGate(corporationActionsPaused: boolean) {
      const adapter = getTurnPhaseRegistry().find((a) => a.key === "resourceAndFinanceStart");
      expect(adapter).toBeDefined();
      const ranPhases: string[] = [];
      const runPhase = vi.fn(async (name: string) => {
        ranPhases.push(name);
        return null;
      });
      const markPhaseSkipped = vi.fn(async () => undefined);
      const runtime = { runPhase, markPhaseSkipped } as never;
      await adapter!.execute(makeContext(corporationActionsPaused), runtime);
      return { ranPhases, markPhaseSkipped };
    }

    it("runs corporationTurn when corporation actions are NOT paused", async () => {
      const { ranPhases, markPhaseSkipped } = await runGate(false);
      expect(ranPhases).toContain("corporationTurn");
      expect(markPhaseSkipped).not.toHaveBeenCalledWith(
        "corporationTurn",
        expect.anything(),
        expect.anything()
      );
    });

    it("skips corporationTurn and marks it manualPause when paused", async () => {
      const { ranPhases, markPhaseSkipped } = await runGate(true);
      expect(ranPhases).not.toContain("corporationTurn");
      expect(markPhaseSkipped).toHaveBeenCalledWith(
        "corporationTurn",
        "manualPause",
        expect.any(String)
      );
    });
  });
});

describe("settlement phase registration", () => {
  it("registers a settlement phase name immediately after alignment", async () => {
    const { BASE_TURN_PHASE_NAMES } = await import("./turnPhaseNames");
    // Widened to string[] deliberately: the array is `as const`, so indexOf on
    // a literal that is not yet a member is a typecheck error rather than the
    // runtime failure this test wants to show.
    const names: readonly string[] = BASE_TURN_PHASE_NAMES;
    const alignment = names.indexOf("alignment");
    const settlement = names.indexOf("settlement");
    expect(alignment).toBeGreaterThan(-1);
    expect(settlement).toBe(alignment + 1);
  });

  it("carries the settlement phase into the derived TURN_PHASE_NAMES list", () => {
    expect(TURN_PHASE_NAMES).toContain("settlement");
  });
});
