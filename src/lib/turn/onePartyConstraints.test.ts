/**
 * Unit tests for one-party-state constraint guards.
 *
 * The gates derive ruling-party identity from `PoliticalParty.regimeStatus`
 * rather than hardcoded country/party IDs, so the same five guards work
 * for any country configured with `governmentType: "onePartyState"`.
 */
import { describe, it, expect } from "vitest";
import {
  isRulingParty,
  isApprovedParty,
  isBannedParty,
  canFormGovernment,
  canTriggerNoConfidence,
  canCollapseGovernment,
  canFieldExecutiveCandidate,
  canInviteToCoalition,
  resolveRegimeMultiplier,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";
import { DEFAULT_OPS_VOTE_MULTIPLIERS, type CountryConfig } from "@/lib/constants/countries";

const ONE_PARTY = { governmentType: "onePartyState" as const };
const PRESIDENTIAL = { governmentType: "presidential" as const };
const PARLIAMENTARY = { governmentType: "parliamentaryRepublic" as const };

const ruling = { regimeStatus: "ruling" as const };
const approved = { regimeStatus: "approved" as const };
const banned = { regimeStatus: "banned" as const };

describe("regimeStatus predicates", () => {
  it("isRulingParty is true only for ruling in a one-party state", () => {
    expect(isRulingParty(ONE_PARTY, ruling)).toBe(true);
    expect(isRulingParty(ONE_PARTY, approved)).toBe(false);
    expect(isRulingParty(ONE_PARTY, banned)).toBe(false);
    expect(isRulingParty(ONE_PARTY, null)).toBe(false);
    expect(isRulingParty(PRESIDENTIAL, ruling)).toBe(false);
  });

  it("isApprovedParty is true only for approved in a one-party state", () => {
    expect(isApprovedParty(ONE_PARTY, approved)).toBe(true);
    expect(isApprovedParty(ONE_PARTY, ruling)).toBe(false);
    expect(isApprovedParty(ONE_PARTY, banned)).toBe(false);
    expect(isApprovedParty(PRESIDENTIAL, approved)).toBe(false);
  });

  it("isBannedParty is true only for banned in a one-party state", () => {
    expect(isBannedParty(ONE_PARTY, banned)).toBe(true);
    expect(isBannedParty(ONE_PARTY, approved)).toBe(false);
    expect(isBannedParty(ONE_PARTY, null)).toBe(false);
    expect(isBannedParty(PRESIDENTIAL, banned)).toBe(false);
  });
});

describe("canFormGovernment", () => {
  it("allows any party in non-one-party countries", () => {
    expect(canFormGovernment(PRESIDENTIAL, ruling)).toBe(true);
    expect(canFormGovernment(PRESIDENTIAL, approved)).toBe(true);
    expect(canFormGovernment(PRESIDENTIAL, banned)).toBe(true);
    expect(canFormGovernment(PARLIAMENTARY, null)).toBe(true);
  });

  it("allows only ruling in a one-party state", () => {
    expect(canFormGovernment(ONE_PARTY, ruling)).toBe(true);
    expect(canFormGovernment(ONE_PARTY, approved)).toBe(false);
    expect(canFormGovernment(ONE_PARTY, banned)).toBe(false);
    expect(canFormGovernment(ONE_PARTY, null)).toBe(false);
  });
});

describe("canTriggerNoConfidence", () => {
  it("allows any party in non-one-party countries", () => {
    expect(canTriggerNoConfidence(PARLIAMENTARY, approved)).toBe(true);
    expect(canTriggerNoConfidence(PRESIDENTIAL, banned)).toBe(true);
  });

  it("allows only ruling in a one-party state", () => {
    expect(canTriggerNoConfidence(ONE_PARTY, ruling)).toBe(true);
    expect(canTriggerNoConfidence(ONE_PARTY, approved)).toBe(false);
    expect(canTriggerNoConfidence(ONE_PARTY, banned)).toBe(false);
  });
});

describe("canCollapseGovernment", () => {
  it("allows collapse in non-one-party countries", () => {
    expect(canCollapseGovernment(PRESIDENTIAL)).toBe(true);
    expect(canCollapseGovernment(PARLIAMENTARY)).toBe(true);
  });

  it("blocks collapse in a one-party state", () => {
    expect(canCollapseGovernment(ONE_PARTY)).toBe(false);
  });
});

describe("canFieldExecutiveCandidate", () => {
  it("allows any party in non-one-party countries", () => {
    expect(canFieldExecutiveCandidate(PRESIDENTIAL, approved, "president")).toBe(true);
    expect(canFieldExecutiveCandidate(PARLIAMENTARY, banned, "prime_minister")).toBe(true);
  });

  it("allows only ruling for executive offices in a one-party state", () => {
    expect(canFieldExecutiveCandidate(ONE_PARTY, ruling, "premier")).toBe(true);
    expect(canFieldExecutiveCandidate(ONE_PARTY, approved, "premier")).toBe(false);
    expect(canFieldExecutiveCandidate(ONE_PARTY, banned, "premier")).toBe(false);
    expect(canFieldExecutiveCandidate(ONE_PARTY, ruling, "president")).toBe(true);
    expect(canFieldExecutiveCandidate(ONE_PARTY, approved, "president")).toBe(false);
  });

  it("allows ruling and approved for non-executive offices in a one-party state", () => {
    expect(canFieldExecutiveCandidate(ONE_PARTY, ruling, "npcDelegate")).toBe(true);
    expect(canFieldExecutiveCandidate(ONE_PARTY, approved, "npcDelegate")).toBe(true);
  });

  it("blocks banned from any candidacy in a one-party state", () => {
    expect(canFieldExecutiveCandidate(ONE_PARTY, banned, "npcDelegate")).toBe(false);
    expect(canFieldExecutiveCandidate(ONE_PARTY, banned, "governor")).toBe(false);
    expect(canFieldExecutiveCandidate(ONE_PARTY, banned, "premier")).toBe(false);
  });
});

describe("canInviteToCoalition", () => {
  it("allows any party in non-one-party countries", () => {
    expect(canInviteToCoalition(PARLIAMENTARY, approved)).toBe(true);
  });

  it("allows only ruling in a one-party state", () => {
    expect(canInviteToCoalition(ONE_PARTY, ruling)).toBe(true);
    expect(canInviteToCoalition(ONE_PARTY, approved)).toBe(false);
    expect(canInviteToCoalition(ONE_PARTY, banned)).toBe(false);
  });
});

describe("resolveRegimeMultiplier", () => {
  const opsConfig = { governmentType: "onePartyState" } as Pick<
    CountryConfig,
    "governmentType" | "opsVoteMultipliers"
  >;
  const presConfig = { governmentType: "presidential" } as Pick<
    CountryConfig,
    "governmentType" | "opsVoteMultipliers"
  >;
  const parlConfig = { governmentType: "parliamentaryRepublic" } as Pick<
    CountryConfig,
    "governmentType" | "opsVoteMultipliers"
  >;

  it("returns 1.0 for non-OPS countries regardless of party", () => {
    expect(resolveRegimeMultiplier(presConfig, null)).toBe(1.0);
    expect(resolveRegimeMultiplier(presConfig, { regimeStatus: "ruling" })).toBe(1.0);
    expect(resolveRegimeMultiplier(parlConfig, { regimeStatus: "approved" })).toBe(1.0);
    expect(resolveRegimeMultiplier(parlConfig, { regimeStatus: "banned" })).toBe(1.0);
  });

  it("returns DEFAULT_OPS_VOTE_MULTIPLIERS.ruling for a ruling party in OPS", () => {
    expect(resolveRegimeMultiplier(opsConfig, { regimeStatus: "ruling" })).toBe(
      DEFAULT_OPS_VOTE_MULTIPLIERS.ruling
    );
  });

  it("returns DEFAULT_OPS_VOTE_MULTIPLIERS.approved for an approved party in OPS", () => {
    expect(resolveRegimeMultiplier(opsConfig, { regimeStatus: "approved" })).toBe(
      DEFAULT_OPS_VOTE_MULTIPLIERS.approved
    );
  });

  it("returns 0 for a banned party in OPS", () => {
    expect(resolveRegimeMultiplier(opsConfig, { regimeStatus: "banned" })).toBe(0);
  });

  it("returns 0 for null / independent party in OPS (same as banned)", () => {
    expect(resolveRegimeMultiplier(opsConfig, null)).toBe(0);
    expect(resolveRegimeMultiplier(opsConfig, { regimeStatus: null })).toBe(0);
    expect(resolveRegimeMultiplier(opsConfig, { regimeStatus: undefined })).toBe(0);
  });

  it("honours per-country override via opsVoteMultipliers", () => {
    const customConfig = {
      governmentType: "onePartyState" as const,
      opsVoteMultipliers: {
        ruling: 5.0,
        approved: 0.2,
        independent: 0.1,
        banned: 0.0,
      },
    };
    expect(resolveRegimeMultiplier(customConfig, { regimeStatus: "ruling" })).toBe(5.0);
    expect(resolveRegimeMultiplier(customConfig, { regimeStatus: "approved" })).toBe(0.2);
    expect(resolveRegimeMultiplier(customConfig, null)).toBe(0.1);
    expect(resolveRegimeMultiplier(customConfig, { regimeStatus: "banned" })).toBe(0);
  });
});

describe("canFieldLegislativeCandidate", () => {
  it("returns true for any party in non-OPS countries (including null)", () => {
    expect(canFieldLegislativeCandidate(PRESIDENTIAL, null)).toBe(true);
    expect(canFieldLegislativeCandidate(PRESIDENTIAL, ruling)).toBe(true);
    expect(canFieldLegislativeCandidate(PRESIDENTIAL, banned)).toBe(true);
    expect(canFieldLegislativeCandidate(PARLIAMENTARY, null)).toBe(true);
    expect(canFieldLegislativeCandidate(PARLIAMENTARY, banned)).toBe(true);
  });

  it("returns true for ruling parties in OPS", () => {
    expect(canFieldLegislativeCandidate(ONE_PARTY, ruling)).toBe(true);
  });

  it("returns true for approved parties in OPS", () => {
    expect(canFieldLegislativeCandidate(ONE_PARTY, approved)).toBe(true);
  });

  it("returns false for banned parties in OPS", () => {
    expect(canFieldLegislativeCandidate(ONE_PARTY, banned)).toBe(false);
  });

  it("returns false for null / independent in OPS (no recognised party)", () => {
    expect(canFieldLegislativeCandidate(ONE_PARTY, null)).toBe(false);
    expect(canFieldLegislativeCandidate(ONE_PARTY, { regimeStatus: null })).toBe(false);
    expect(canFieldLegislativeCandidate(ONE_PARTY, { regimeStatus: undefined })).toBe(false);
  });
});
