import { describe, expect, it } from "vitest";
import type { Bloc } from "../blocs";
import {
  buildChamberLeadershipContext,
  describeEligibility,
  eligiblePartySlugsFor,
  isPartyEligible,
  POLICY_BY_ROLE,
  type ChamberLeadershipContext,
  type RoleEligibilityPolicy,
} from "./rolePolicy";

function makeBloc(partySlugs: string[], displayName = "Bloc"): Bloc {
  return {
    kind: "coalition",
    id: "bloc-1",
    displayName,
    displayColor: "#000",
    partySlugs: new Set(partySlugs),
    seats: partySlugs.length,
    dominantPartySlug: partySlugs[0] ?? "",
    dominantPartySeats: 1,
  };
}

function makeCtx(overrides: Partial<ChamberLeadershipContext> = {}): ChamberLeadershipContext {
  return {
    allChamberPartySlugs: new Set(["dem", "rep", "lib", "grn"]),
    majorityParty: "dem",
    majorityBloc: makeBloc(["dem", "lib"], "Dem-Lib"),
    majorityPartyName: "Democrats",
    ...overrides,
  };
}

describe("POLICY_BY_ROLE", () => {
  it("maps every LeadershipRole to a policy", () => {
    expect(POLICY_BY_ROLE.speaker_of_the_house).toEqual({ kind: "any-seated" });
    expect(POLICY_BY_ROLE.president_pro_tempore).toEqual({ kind: "largest-single-party" });
    expect(POLICY_BY_ROLE.speaker_of_the_bundestag).toEqual({ kind: "any-seated" });
    expect(POLICY_BY_ROLE.majority_leader_house).toEqual({ kind: "largest-single-party" });
    expect(POLICY_BY_ROLE.majority_leader_senate).toEqual({ kind: "largest-single-party" });
    expect(POLICY_BY_ROLE.majority_whip_house).toEqual({ kind: "largest-single-party" });
    expect(POLICY_BY_ROLE.majority_whip_senate).toEqual({ kind: "largest-single-party" });
    expect(POLICY_BY_ROLE.minority_leader_house).toEqual({ kind: "non-coalition" });
    expect(POLICY_BY_ROLE.minority_leader_senate).toEqual({ kind: "non-coalition" });
    expect(POLICY_BY_ROLE.minority_whip_house).toEqual({ kind: "non-coalition" });
    expect(POLICY_BY_ROLE.minority_whip_senate).toEqual({ kind: "non-coalition" });
  });
});

describe("buildChamberLeadershipContext", () => {
  it("excludes __vacant__ from allChamberPartySlugs", () => {
    const ctx = buildChamberLeadershipContext({
      composition: [
        { party: "dem", partyName: "Democrats" },
        { party: "__vacant__" },
        { party: "rep", partyName: "Republicans" },
      ],
      majorityParty: "dem",
      majorityBloc: null,
    });
    expect(ctx.allChamberPartySlugs).toEqual(new Set(["dem", "rep"]));
    expect(ctx.majorityPartyName).toBe("Democrats");
  });

  it("returns undefined majorityPartyName when no majority party is set", () => {
    const ctx = buildChamberLeadershipContext({
      composition: [{ party: "dem", partyName: "Democrats" }],
      majorityParty: null,
      majorityBloc: null,
    });
    expect(ctx.majorityPartyName).toBeUndefined();
  });
});

describe("isPartyEligible — any-seated", () => {
  const policy: RoleEligibilityPolicy = { kind: "any-seated" };
  it("accepts every chamber party", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "dem", ctx)).toBe(true);
    expect(isPartyEligible(policy, "rep", ctx)).toBe(true);
    expect(isPartyEligible(policy, "lib", ctx)).toBe(true);
    expect(isPartyEligible(policy, "grn", ctx)).toBe(true);
  });
  it("rejects parties not in the chamber", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "soc", ctx)).toBe(false);
    expect(isPartyEligible(policy, null, ctx)).toBe(false);
    expect(isPartyEligible(policy, "", ctx)).toBe(false);
  });
});

describe("isPartyEligible — largest-single-party", () => {
  const policy: RoleEligibilityPolicy = { kind: "largest-single-party" };
  it("accepts only the majority party", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "dem", ctx)).toBe(true);
    expect(isPartyEligible(policy, "lib", ctx)).toBe(false);
    expect(isPartyEligible(policy, "rep", ctx)).toBe(false);
  });
  it("rejects all parties when majorityParty is null", () => {
    const ctx = makeCtx({ majorityParty: null });
    expect(isPartyEligible(policy, "dem", ctx)).toBe(false);
  });
});

describe("isPartyEligible — non-coalition", () => {
  const policy: RoleEligibilityPolicy = { kind: "non-coalition" };
  it("accepts parties outside the majority bloc", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "rep", ctx)).toBe(true);
    expect(isPartyEligible(policy, "grn", ctx)).toBe(true);
  });
  it("rejects parties inside the majority bloc (including junior partners)", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "dem", ctx)).toBe(false);
    expect(isPartyEligible(policy, "lib", ctx)).toBe(false);
  });
  it("falls back to all chamber parties when no bloc exists", () => {
    const ctx = makeCtx({ majorityBloc: null });
    expect(isPartyEligible(policy, "rep", ctx)).toBe(true);
    expect(isPartyEligible(policy, "dem", ctx)).toBe(true);
  });
});

describe("isPartyEligible — majority-coalition", () => {
  const policy: RoleEligibilityPolicy = { kind: "majority-coalition" };
  it("accepts parties in the majority bloc", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "dem", ctx)).toBe(true);
    expect(isPartyEligible(policy, "lib", ctx)).toBe(true);
  });
  it("rejects parties outside the majority bloc", () => {
    const ctx = makeCtx();
    expect(isPartyEligible(policy, "rep", ctx)).toBe(false);
    expect(isPartyEligible(policy, "grn", ctx)).toBe(false);
  });
  it("rejects every party when bloc is null", () => {
    const ctx = makeCtx({ majorityBloc: null });
    expect(isPartyEligible(policy, "dem", ctx)).toBe(false);
  });
});

describe("eligiblePartySlugsFor", () => {
  it("any-seated returns every chamber party", () => {
    expect(eligiblePartySlugsFor({ kind: "any-seated" }, makeCtx())).toEqual(
      new Set(["dem", "rep", "lib", "grn"])
    );
  });
  it("largest-single-party returns just the majority party", () => {
    expect(eligiblePartySlugsFor({ kind: "largest-single-party" }, makeCtx())).toEqual(
      new Set(["dem"])
    );
  });
  it("non-coalition returns chamber minus majority bloc", () => {
    expect(eligiblePartySlugsFor({ kind: "non-coalition" }, makeCtx())).toEqual(
      new Set(["rep", "grn"])
    );
  });
  it("majority-coalition returns the bloc's party slugs", () => {
    expect(eligiblePartySlugsFor({ kind: "majority-coalition" }, makeCtx())).toEqual(
      new Set(["dem", "lib"])
    );
  });
});

describe("describeEligibility", () => {
  it("returns expected labels", () => {
    const ctx = makeCtx();
    expect(describeEligibility({ kind: "any-seated" }, ctx)).toBe("any seated chamber member");
    expect(describeEligibility({ kind: "largest-single-party" }, ctx)).toBe(
      "the majority party (Democrats)"
    );
    expect(describeEligibility({ kind: "majority-coalition" }, ctx)).toBe(
      "the majority coalition (Dem-Lib)"
    );
    expect(describeEligibility({ kind: "non-coalition" }, ctx)).toBe(
      "non-majority-coalition parties"
    );
  });
});
