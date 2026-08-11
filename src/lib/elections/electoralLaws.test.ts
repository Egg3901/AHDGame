import { describe, it, expect } from "vitest";
import {
  applyElectoralLawProvision,
  clampRegistrationAccess,
  describeElectoralLaw,
  isValidVotingAge,
  registrationDecayMultiplier,
  registrationDriftMultiplier,
  REGISTRATION_ACCESS_MAX,
  REGISTRATION_ACCESS_MIN,
} from "./electoralLaws";
import { resolveVotingAgeEligible } from "@/lib/constants/votingAge";

function fakeDb() {
  const sets: Record<string, unknown>[] = [];
  return {
    sets,
    collection: () => ({
      updateOne: async (_f: unknown, u: { $set: Record<string, unknown> }) => {
        sets.push(u.$set);
      },
    }),
  } as never;
}

describe("electoral law", () => {
  it("writes the franchise the demographic phase already reads", async () => {
    const db = fakeDb();
    const applied = await applyElectoralLawProvision(
      db,
      { type: "electoral_law", votingAge: 18 },
      "US"
    );
    expect(applied.votingAgeSet).toBe(18);
    const written = (db as unknown as { sets: Record<string, unknown>[] }).sets[0];
    expect(written).toEqual({ "votingAgeEligibleByCountry.US": 18 });
    // The whole point: the reader honours it over the year default. Without a
    // stored value a 1953 world falls back to 21.
    expect(resolveVotingAgeEligible({ votingAgeEligible: 18 }, 1953)).toBe(18);
    expect(resolveVotingAgeEligible(undefined, 1953)).toBe(21);
  });

  it("rejects a malformed franchise instead of enacting one nobody voted for", async () => {
    for (const votingAge of [0, 99, 18.5, NaN, -1]) {
      const db = fakeDb();
      const applied = await applyElectoralLawProvision(
        db,
        { type: "electoral_law", votingAge },
        "US"
      );
      expect(applied.votingAgeSet, `${votingAge}`).toBeUndefined();
      expect((db as unknown as { sets: unknown[] }).sets).toEqual([]);
    }
    expect(isValidVotingAge(18)).toBe(true);
    expect(isValidVotingAge("18")).toBe(false);
  });

  // A later bill touching one axis must not silently reset the other, or every
  // franchise law would quietly repeal the registration regime.
  it("leaves the other axis alone", async () => {
    const franchiseOnly = fakeDb();
    await applyElectoralLawProvision(franchiseOnly, { type: "electoral_law", votingAge: 18 }, "US");
    expect(
      (franchiseOnly as unknown as { sets: Record<string, unknown>[] }).sets[0]
    ).not.toHaveProperty("registrationAccessBias");

    const accessOnly = fakeDb();
    await applyElectoralLawProvision(
      accessOnly,
      {
        type: "electoral_law",
        registrationAccess: 20,
      },
      "US"
    );
    expect(
      (accessOnly as unknown as { sets: Record<string, unknown>[] }).sets[0]
    ).not.toHaveProperty("votingAgeEligible");
  });

  it("is a no-op when the provision sets nothing", async () => {
    const db = fakeDb();
    const applied = await applyElectoralLawProvision(db, { type: "electoral_law" }, "US");
    expect(applied).toEqual({});
    expect((db as unknown as { sets: unknown[] }).sets).toEqual([]);
  });

  // The bug this guards, found by an adversarial review pass: the write used to
  // land on a single global gameState field, so a Japanese franchise bill set
  // the American voting age and a UK registration law scaled Brazil's Org->Reg
  // drift. Electoral law is NATIONAL law.
  it("scopes the franchise to the enacting country", async () => {
    const db = fakeDb();
    await applyElectoralLawProvision(db, { type: "electoral_law", votingAge: 18 }, "JP");
    const written = (db as unknown as { sets: Record<string, unknown>[] }).sets[0];
    expect(written).toEqual({ "votingAgeEligibleByCountry.JP": 18 });
    expect(written).not.toHaveProperty("votingAgeEligible");
  });

  it("scopes registration access to the enacting country", async () => {
    const db = fakeDb();
    await applyElectoralLawProvision(db, { type: "electoral_law", registrationAccess: 30 }, "UK");
    const written = (db as unknown as { sets: Record<string, unknown>[] }).sets[0];
    expect(written).toEqual({ "registrationAccessBiasByCountry.UK": 30 });
    expect(written).not.toHaveProperty("registrationAccessBias");
  });

  it("reads back per country, and does not leak across countries", () => {
    const gs = { votingAgeEligibleByCountry: { JP: 18 } };
    expect(resolveVotingAgeEligible(gs, 1953, "JP")).toBe(18);
    // The US has no law of its own, so it keeps the year default, not Japan's.
    expect(resolveVotingAgeEligible(gs, 1953, "US")).toBe(21);
  });

  it("clamps the access axis", () => {
    expect(clampRegistrationAccess(999)).toBe(REGISTRATION_ACCESS_MAX);
    expect(clampRegistrationAccess(-999)).toBe(REGISTRATION_ACCESS_MIN);
    expect(clampRegistrationAccess(NaN)).toBe(0);
  });

  describe("registration-access multipliers", () => {
    it("are neutral with no law, so existing worlds are unchanged", () => {
      expect(registrationDriftMultiplier(undefined)).toBe(1);
      expect(registrationDecayMultiplier(undefined)).toBe(1);
      expect(registrationDriftMultiplier(0)).toBe(1);
      expect(registrationDecayMultiplier(0)).toBe(1);
    });

    // Expanded access must pull voters onto the rolls (faster drift) AND keep
    // them there (slower decay). Restriction is the mirror. If the two moved the
    // same way the law would be self-cancelling.
    it("move in opposite directions", () => {
      expect(registrationDriftMultiplier(50)).toBeGreaterThan(1);
      expect(registrationDecayMultiplier(50)).toBeLessThan(1);
      expect(registrationDriftMultiplier(-50)).toBeLessThan(1);
      expect(registrationDecayMultiplier(-50)).toBeGreaterThan(1);
    });

    it("stay positive at the extremes, so no rate can invert", () => {
      for (const b of [-50, -25, 0, 25, 50]) {
        expect(registrationDriftMultiplier(b), `drift ${b}`).toBeGreaterThan(0);
        expect(registrationDecayMultiplier(b), `decay ${b}`).toBeGreaterThan(0);
      }
    });

    it("are symmetric about neutral", () => {
      expect(registrationDriftMultiplier(50) - 1).toBeCloseTo(
        1 - registrationDriftMultiplier(-50),
        9
      );
    });
  });

  it("summarises both axes for the bill view", () => {
    expect(describeElectoralLaw({ votingAge: 18, registrationAccess: 30 })).toBe(
      "Voting age 18 · Registration access: +30"
    );
    expect(describeElectoralLaw({ registrationAccess: -20 })).toBe("Registration access: -20");
    expect(describeElectoralLaw({})).toBe("No change");
  });
});
