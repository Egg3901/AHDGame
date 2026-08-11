/**
 * Tests for test fixture factories — ensures factories produce valid objects
 * with correct defaults and accept overrides.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  makeCharacter,
  makeBill,
  makeElection,
  makeCandidate,
  makeNPP,
  makeCorporation,
  makeParty,
  makeOfficial,
  makeCursor,
} from "./factories";

describe("makeCharacter", () => {
  it("creates a character with sensible defaults", () => {
    const char = makeCharacter();
    expect(char._id).toBeInstanceOf(ObjectId);
    expect(char.name).toBe("Test Character");
    expect(char.countryId).toBe("US");
    expect(char.homeState).toBe("CA");
    expect(char.policies.economic).toBe(0);
    expect(char.policies.social).toBe(0);
    expect(char.party).toBe("independent");
    expect(char.currentOffice).toBeNull();
    expect(char.funds).toBe(100_000);
    expect(char.actions).toBe(5);
  });

  it("accepts partial overrides", () => {
    const char = makeCharacter({
      name: "Alice",
      party: "DEM",
      funds: 500_000,
      homeState: "NY",
    });
    expect(char.name).toBe("Alice");
    expect(char.party).toBe("DEM");
    expect(char.funds).toBe(500_000);
    expect(char.homeState).toBe("NY");
    // Defaults still apply for non-overridden fields
    expect(char.countryId).toBe("US");
    expect(char.favorability).toBe(50);
  });

  it("produces unique IDs for each call", () => {
    const a = makeCharacter();
    const b = makeCharacter();
    expect(a._id.toString()).not.toBe(b._id.toString());
    expect(a.userId.toString()).not.toBe(b.userId.toString());
  });
});

describe("makeBill", () => {
  it("creates a bill with required fields", () => {
    const bill = makeBill();
    expect(bill.title).toBe("Test Bill");
    expect(bill.originChamber).toBe("house");
    expect(bill.status).toBe("active");
    expect(bill.votesFor).toBe(0);
    expect(bill.votesAgainst).toBe(0);
    expect(bill.coSponsors).toEqual([]);
  });

  it("accepts overrides for specific fields", () => {
    const bill = makeBill({
      title: "Tax Reform Act",
      status: "enrolled",
      votesFor: 250,
      votesAgainst: 180,
      originChamber: "senate",
    });
    expect(bill.title).toBe("Tax Reform Act");
    expect(bill.status).toBe("enrolled");
    expect(bill.votesFor).toBe(250);
    expect(bill.originChamber).toBe("senate");
  });
});

describe("makeElection", () => {
  it("creates a senate election by default", () => {
    const election = makeElection();
    expect(election.electionType).toBe("senate");
    expect(election.state).toBe("CA");
    expect(election.status).toBe("active");
    expect(election.countryId).toBe("US");
  });

  it("can create a presidential election", () => {
    const election = makeElection({
      electionType: "president",
      state: "US",
    });
    expect(election.electionType).toBe("president");
    expect(election.state).toBe("US");
  });
});

describe("makeCandidate", () => {
  it("creates a player candidate by default", () => {
    const candidate = makeCandidate();
    expect(candidate.isNPP).toBe(false);
    expect(candidate.status).toBe("active");
    expect(candidate.party).toBe("DEM");
  });

  it("can create an NPP candidate", () => {
    const nppId = new ObjectId();
    const candidate = makeCandidate({ isNPP: true, nppId });
    expect(candidate.isNPP).toBe(true);
    expect(candidate.nppId).toEqual(nppId);
  });
});

describe("makeNPP", () => {
  it("creates an NPP with personality traits", () => {
    const npp = makeNPP();
    expect(npp.personality.loyalty).toBe(50);
    expect(npp.personality.ambition).toBe(50);
    expect(npp.personality.stubbornness).toBe(50);
    expect(npp.retiredAt).toBeNull();
  });
});

describe("makeCorporation", () => {
  it("creates a corporation with financial defaults", () => {
    const corp = makeCorporation();
    expect(corp.liquidCapital).toBe(1_000_000);
    expect(corp.sharePrice).toBe(10);
    expect(corp.totalShares).toBe(1_000_000);
    expect(corp.type).toBe("manufacturing");
  });
});

describe("makeParty", () => {
  it("creates a non-default party", () => {
    const party = makeParty();
    expect(party.isDefault).toBe(false);
    expect(party.economicPosition).toBe(0);
    expect(party.socialPosition).toBe(0);
  });
});

describe("makeOfficial", () => {
  it("creates a house official by default", () => {
    const official = makeOfficial();
    expect(official.officeType).toBe("house");
    expect(official.isNPP).toBe(false);
    expect(official.seatsHeld).toBe(1);
  });
});

describe("makeCursor", () => {
  it("returns docs from toArray", async () => {
    const docs = [{ _id: "1" }, { _id: "2" }];
    const cursor = makeCursor(docs);
    const result = await cursor.toArray();
    expect(result).toEqual(docs);
  });

  it("supports chainable methods", async () => {
    const cursor = makeCursor([{ a: 1 }]);
    const result = await cursor.sort().limit().skip().project().toArray();
    expect(result).toEqual([{ a: 1 }]);
  });
});
