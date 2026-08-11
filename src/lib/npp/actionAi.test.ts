import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calculateActionPriorities,
  decideNppAction,
  NPP_MAX_DONOR_BASE_LEVEL,
  type NppActionContext,
} from "./actionAi";

describe("calculateActionPriorities", () => {
  const baseContext: NppActionContext = {
    hasOffice: false,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    funds: 10_000,
    actionPoints: 10,
    donorBaseLevel: 0,
  };

  it("prioritizes buildDonorBase for non-office holders", () => {
    const priorities = calculateActionPriorities(baseContext);
    expect(priorities.buildDonorBase).toBeGreaterThan(priorities.campaign);
  });

  it("prioritizes campaign for office holders", () => {
    const context = { ...baseContext, hasOffice: true };
    const priorities = calculateActionPriorities(context);
    expect(priorities.campaign).toBeGreaterThan(priorities.buildDonorBase);
  });

  it("boosts partyDonation for high loyalty", () => {
    const lowLoyalty = calculateActionPriorities({
      ...baseContext,
      personality: { loyalty: 30, ambition: 50, stubbornness: 50 },
    });
    const highLoyalty = calculateActionPriorities({
      ...baseContext,
      personality: { loyalty: 80, ambition: 50, stubbornness: 50 },
    });
    expect(highLoyalty.partyDonation).toBeGreaterThan(lowLoyalty.partyDonation);
  });

  it("boosts buildDonorBase for high ambition", () => {
    const lowAmbition = calculateActionPriorities({
      ...baseContext,
      personality: { loyalty: 50, ambition: 30, stubbornness: 50 },
    });
    const highAmbition = calculateActionPriorities({
      ...baseContext,
      personality: { loyalty: 50, ambition: 80, stubbornness: 50 },
    });
    expect(highAmbition.buildDonorBase).toBeGreaterThan(lowAmbition.buildDonorBase);
  });
});

describe("decideNppAction", () => {
  const basePersonality = { loyalty: 50, ambition: 50, stubbornness: 50 };
  const wellFundedNonOffice: NppActionContext = {
    hasOffice: false,
    personality: basePersonality,
    funds: 1_000_000,
    actionPoints: 100,
    donorBaseLevel: 0,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'none' with 'No affordable action' when nothing fits", () => {
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      funds: 0,
      actionPoints: 0,
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toMatch(/No affordable action/);
  });

  it("skips buildDonorBase entirely once at NPP_MAX_DONOR_BASE_LEVEL", () => {
    // Force the weighted-random roll to always land on the first remaining option so
    // we exercise the candidate list directly. With build skipped, the highest-priority
    // remaining action for a non-office NPP is campaign (25), and a near-zero roll
    // lands on the first inserted candidate (campaign).
    vi.spyOn(Math, "random").mockReturnValue(0); // disables save coin flip + picks first candidate

    const decision = decideNppAction({
      ...wellFundedNonOffice,
      donorBaseLevel: NPP_MAX_DONOR_BASE_LEVEL,
    });

    expect(decision.action).not.toBe("buildDonorBase");
    expect(["partyDonation", "advertise", "campaign"]).toContain(decision.action);
  });

  it("does not save when AP is sufficient even if a higher-priority action exists", () => {
    // AP at cap so buildDonorBase L0 (5 AP / $10K) is affordable. Save block must not fire.
    // Math.random=0 disables save coin flip regardless, but also confirms we don't bail early.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const decision = decideNppAction(wellFundedNonOffice);
    expect(decision.action).not.toBe("none");
  });

  it("does not save when funds are the blocker (waiting on AP regen wouldn't help)", () => {
    // AP shortage AND fund shortage — save heuristic must reject because funds < fundCost.
    // Math.random=0 would otherwise pass the coin flip.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      actionPoints: 0,
      funds: 0,
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toMatch(/No affordable action/);
  });

  it("does not save once donor-base is at cap (build will be skipped anyway)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      donorBaseLevel: NPP_MAX_DONOR_BASE_LEVEL,
      actionPoints: 0, // no save trigger because buildAtCap nulls buildCandidate
      funds: 1_000_000,
    });
    // With no AP at all, every action other than partyDonation (1 AP) is blocked too;
    // partyDonation needs 1 AP so it's also unaffordable. We expect "none" with
    // "No affordable action" — NOT "Saving for buildDonorBase".
    expect(decision.action).toBe("none");
    expect(decision.reason).not.toMatch(/Saving/);
  });

  it("bridges the level-4 buildDonorBase plateau (22 AP gap, previously unreachable)", () => {
    // Live-world sampling found level-4+ NPPs sitting at 2-3 AP when this heuristic runs
    // (they spend their AP on cheaper actions every cycle). buildDonorBase L4→5 costs 25
    // AP, so at AP=3 the deficit is 22 — needing 11 turns of regen. The old SAVE_MAX_TURNS
    // of 4 (8 AP of headroom) could never cover that; 0 of 1,764 level-4 NPPs in a 654-turn
    // world ever reached 25 AP. The widened window must cover it.
    vi.spyOn(Math, "random").mockReturnValue(0.1); // passes the save coin flip
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      donorBaseLevel: 4,
      actionPoints: 3,
      funds: 1_000_000,
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toMatch(/Saving for buildDonorBase L5/);
  });

  it("takes the funds-poor fallback (fundraise) when AP-rich but every real action is priced out", () => {
    // The trap this covers: an NPP sitting near the AP cap with funds below even the
    // cheapest action's cost has, before this fallback, no path out at all — the normal
    // affordable-action loop returns nothing every single cycle, forever.
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      funds: 0,
      actionPoints: 90,
    });
    expect(decision.action).toBe("fundraise");
  });

  it("does not fundraise when AP is also too low to afford it", () => {
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      funds: 0,
      actionPoints: 2, // below FUNDRAISE_AP_COST (4)
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toMatch(/No affordable action/);
  });

  it("saves probabilistically when AP shortage is short and funds are ready", () => {
    // Set Math.random to a value that:
    //   1) passes the save coin flip (< 0.33)
    //   2) means we hit the save branch
    // donorBaseLevel=0 → buildDonorBase L0 costs 5 AP / $10K. AP=3 → 1 turn of regen needed.
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      actionPoints: 3,
      funds: 1_000_000,
    });
    expect(decision.action).toBe("none");
    expect(decision.reason).toMatch(/Saving for buildDonorBase L1/);
  });

  it("acts (not save) when the save coin flip fails", () => {
    // Same scenario as the save test, but Math.random returns 0.9 → coin flip fails → act.
    // partyDonation costs 1 AP / $5K — fully affordable with AP=3.
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const decision = decideNppAction({
      ...wellFundedNonOffice,
      actionPoints: 3,
      funds: 1_000_000,
    });
    expect(decision.action).not.toBe("none");
  });

  it("diversifies across affordable actions over many rolls (no monotonic lock-in)", () => {
    // Office NPP at full AP/funds — every action should appear at least once over many trials.
    const office: NppActionContext = {
      hasOffice: true,
      personality: basePersonality,
      funds: 1_000_000,
      actionPoints: 100,
      donorBaseLevel: 0,
    };
    const seen = new Set<string>();
    // Deterministic roll sequence sweeping (0, 1)
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      const v = (i / 100) % 1;
      i += 7; // co-prime stride
      return v;
    });
    for (let n = 0; n < 200; n++) {
      seen.add(decideNppAction(office).action);
    }
    expect(seen.has("campaign")).toBe(true);
    expect(seen.has("advertise")).toBe(true);
    expect(seen.has("buildDonorBase")).toBe(true);
    expect(seen.has("partyDonation")).toBe(true);
  });
});
