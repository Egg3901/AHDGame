import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolveWhipForNPP, getNPPCountry } from "./whipResolution";
import type { NPP, BillWhip, StatePartyOrg } from "@/lib/db/types";

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "US_CA",
    party: "party1",
    countryId: "US",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 50, stubbornness: 50 },
    ...overrides,
  } as NPP;
}

function makeWhip(overrides: Partial<BillWhip> = {}): BillWhip {
  return {
    _id: new ObjectId(),
    partyId: "party1",
    chamber: "house",
    direction: "for" as const,
    issuedBy: "nationalParty" as const,
    ...overrides,
  } as BillWhip;
}

describe("getNPPCountry", () => {
  it("returns countryId when set", () => {
    const npp = makeNPP({ countryId: "UK" });
    expect(getNPPCountry(npp)).toBe("UK");
  });

  it("defaults to US when countryId is absent (post-migration all NPPs have countryId)", () => {
    const npp = makeNPP({ countryId: undefined });
    expect(getNPPCountry(npp)).toBe("US");
  });
});

describe("resolveWhipForNPP", () => {
  it("returns null when no whips match party", () => {
    const npp = makeNPP({ party: "party1" });
    const whips = [makeWhip({ partyId: "party2" })];
    expect(resolveWhipForNPP(npp, whips, new Map(), "house")).toBeNull();
  });

  it("returns null when no whips match chamber", () => {
    const npp = makeNPP();
    const whips = [makeWhip({ chamber: "senate" })];
    expect(resolveWhipForNPP(npp, whips, new Map(), "house")).toBeNull();
  });

  it("returns national party whip when no state party leadership exists", () => {
    const npp = makeNPP();
    const whip = makeWhip({ issuedBy: "nationalParty" });
    const result = resolveWhipForNPP(npp, [whip], new Map(), "house");
    expect(result).toBe(whip);
  });

  it("skips national party whip when state party leadership exists", () => {
    const npp = makeNPP({ homeState: "US_CA", party: "party1" });
    const whip = makeWhip({ issuedBy: "nationalParty" });
    const stateOrgs = new Map<string, StatePartyOrg>();
    stateOrgs.set("US_CA_party1", { chairId: new ObjectId() } as StatePartyOrg);

    const result = resolveWhipForNPP(npp, [whip], stateOrgs, "house");
    expect(result).toBeNull();
  });

  it("prefers state party whip over national", () => {
    const npp = makeNPP({ homeState: "US_CA", party: "party1" });
    const nationalWhip = makeWhip({ issuedBy: "nationalParty" });
    const stateWhip = makeWhip({ issuedBy: "stateParty", stateId: "US_CA" });

    const result = resolveWhipForNPP(npp, [nationalWhip, stateWhip], new Map(), "house");
    expect(result).toBe(stateWhip);
  });

  it("prefers the latest state-party whip attempt when multiple state whips exist", () => {
    const npp = makeNPP({ homeState: "US_CA", party: "party1" });
    const earlier = makeWhip({
      issuedBy: "stateParty",
      stateId: "US_CA",
      attemptNumber: 1,
      mode: "soft",
      createdAt: new Date("2026-04-30T11:00:00Z"),
    });
    const later = makeWhip({
      issuedBy: "stateParty",
      stateId: "US_CA",
      attemptNumber: 2,
      mode: "hard",
      createdAt: new Date("2026-04-30T12:00:00Z"),
    });

    const result = resolveWhipForNPP(npp, [earlier, later], new Map(), "house");
    expect(result).toBe(later);
  });

  it("prefers the latest national whip attempt when no state leadership exists", () => {
    const npp = makeNPP({ homeState: "US_CA", party: "party1" });
    const earlier = makeWhip({
      issuedBy: "nationalParty",
      attemptNumber: 1,
      mode: "soft",
      createdAt: new Date("2026-04-30T11:00:00Z"),
    });
    const later = makeWhip({
      issuedBy: "nationalParty",
      attemptNumber: 2,
      mode: "hard",
      createdAt: new Date("2026-04-30T12:00:00Z"),
    });

    const result = resolveWhipForNPP(npp, [earlier, later], new Map(), "house");
    expect(result).toBe(later);
  });

  it("skips cross-country whips when country context is provided", () => {
    const npp = makeNPP({ countryId: "US", party: "party1" });
    const whip = makeWhip({ issuedBy: "stateParty", stateId: "LON", countryId: "UK" });
    const countryCtx = {
      partyByCompositeKey: new Map(),
      partyCountries: new Map([["party1", ["US" as const, "UK" as const]]]),
    };

    const result = resolveWhipForNPP(npp, [whip], new Map(), "house", countryCtx);
    expect(result).toBeNull();
  });

  it("allows same-country whips when country context is provided", () => {
    const npp = makeNPP({ countryId: "US", homeState: "US_CA", party: "party1" });
    const whip = makeWhip({ issuedBy: "stateParty", stateId: "US_CA" });
    const countryCtx = {
      partyByCompositeKey: new Map(),
      partyCountries: new Map([["party1", ["US" as const]]]),
    };

    const result = resolveWhipForNPP(npp, [whip], new Map(), "house", countryCtx);
    expect(result).toBe(whip);
  });

  it("works without country context (bill voting mode)", () => {
    const npp = makeNPP({ homeState: "US_CA", party: "party1" });
    const stateWhip = makeWhip({ issuedBy: "stateParty", stateId: "US_CA" });

    const result = resolveWhipForNPP(npp, [stateWhip], new Map(), "house");
    expect(result).toBe(stateWhip);
  });
});
