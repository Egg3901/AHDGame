import { describe, it, expect } from "vitest";
import { planStateRegDriftDecay } from "./regDriftDecay";
import type { StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";

/**
 * Registration law reaching the turn phase.
 *
 * The passive Org→Reg drift ran at a fixed rate no law could touch. An enacted
 * `ElectoralLawProvision.registrationAccess` now scales it. These assert the
 * behaviour through the real planner, not the multiplier helpers, because the
 * multipliers being right is not the same as the phase using them.
 */

const NOW = new Date("2026-01-01T00:00:00Z");

function party(partyId: string, organization: number, registration: number): StatePartyOrg {
  return {
    _id: `PA:${partyId}`,
    stateId: "PA",
    countryId: "US",
    partyId,
    organization,
    registration,
  } as unknown as StatePartyOrg;
}

function pool(): StateRegistrationPool {
  return {
    _id: "PA",
    stateId: "PA",
    countryId: "US",
    independent: 20,
    unregistered: 30,
  } as unknown as StateRegistrationPool;
}

function plan(registrationAccessBias?: number) {
  return planStateRegDriftDecay({
    countryId: "US",
    stateId: "PA",
    // Org well above Reg, so drift has somewhere to climb toward.
    parties: [party("1", 40, 10), party("2", 30, 12)],
    pool: pool(),
    turn: 100,
    now: NOW,
    governor: null,
    registrationAccessBias,
  });
}

function regOf(result: ReturnType<typeof plan>, partyId: string): number {
  const row = result!.partyUpdates.find((u) => u.rowId === `PA:${partyId}`);
  return row!.newReg;
}

describe("registration access law in the drift/decay phase", () => {
  // The regression that matters most: every existing world has no such law, and
  // must behave exactly as it did before the channel existed.
  it("is byte-identical with no law enacted", () => {
    const none = plan(undefined);
    const zero = plan(0);
    expect(none).not.toBeNull();
    expect(none).toEqual(zero);
  });

  it("expanded access grows the rolls faster than neutral", () => {
    const neutral = plan(0);
    const expanded = plan(50);
    expect(regOf(expanded, "1")).toBeGreaterThan(regOf(neutral, "1"));
    expect(regOf(expanded, "2")).toBeGreaterThan(regOf(neutral, "2"));
  });

  it("restricted access grows them slower", () => {
    const neutral = plan(0);
    const restricted = plan(-50);
    expect(regOf(restricted, "1")).toBeLessThan(regOf(neutral, "1"));
    expect(regOf(restricted, "2")).toBeLessThan(regOf(neutral, "2"));
  });

  // The design call this mechanic rests on. A law that handed the enacting party
  // a bigger share than its organization earns would make "pass a law, win the
  // state" dominate every other political action.
  it("is party-neutral — the law moves rates, not who benefits", () => {
    const neutral = plan(0);
    const expanded = plan(50);
    const ratio = (r: ReturnType<typeof plan>) => regOf(r, "1") / regOf(r, "2");
    // Party 1 has more Org, so it gains more in absolute terms either way; what
    // must not change is that the split is decided by Org, not by the law.
    expect(ratio(expanded)).toBeCloseTo(ratio(neutral), 2);
  });

  it("never drives registration negative at full restriction", () => {
    const restricted = plan(-50);
    for (const u of restricted!.partyUpdates) {
      expect(u.newReg, u.rowId).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the pool summing to 100 under any law", () => {
    for (const bias of [-50, -20, 0, 20, 50]) {
      const r = plan(bias)!;
      const partyTotal = r.partyUpdates.reduce((s, u) => s + u.newReg, 0);
      const total = partyTotal + r.poolUpdate.newIndependent + r.poolUpdate.newUnregistered;
      const before = 10 + 12 + 20 + 30;
      expect(total, `bias ${bias}`).toBeCloseTo(before, 6);
    }
  });
});
