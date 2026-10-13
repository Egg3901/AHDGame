import { describe, expect, it } from "vitest";
import { governmentWhipApplies, nppGovernmentWhipFor } from "./governmentWhip";

const whip = nppGovernmentWhipFor({
  governingPartyId: "1",
  nppLed: true,
  partyPlayerLed: false,
  goalDomains: ["Healthcare"],
});
const bill = { nppSponsored: true, sponsorParty: "1" };

describe("NPP engine 6.7 government whip", () => {
  it("is withheld from player-led parties, player heads and goal-less governments", () => {
    const base = { governingPartyId: "1", nppLed: true, partyPlayerLed: false, goalDomains: ["x"] };
    expect(nppGovernmentWhipFor({ ...base, partyPlayerLed: true })).toBeNull();
    expect(nppGovernmentWhipFor({ ...base, nppLed: false })).toBeNull();
    expect(nppGovernmentWhipFor({ ...base, goalDomains: [] })).toBeNull();
  });

  it("applies to governing-party members on its own goal bills", () => {
    expect(governmentWhipApplies(whip, bill, "1", "healthcare")).toBe(true);
  });

  it("does not reach other parties, other domains, or bills it did not sponsor", () => {
    expect(governmentWhipApplies(whip, bill, "2", "healthcare")).toBe(false);
    expect(governmentWhipApplies(whip, bill, "1", "defense")).toBe(false);
    expect(governmentWhipApplies(whip, { ...bill, nppSponsored: false }, "1", "healthcare")).toBe(
      false
    );
    expect(governmentWhipApplies(whip, { ...bill, sponsorParty: "2" }, "1", "healthcare")).toBe(
      false
    );
  });
});
