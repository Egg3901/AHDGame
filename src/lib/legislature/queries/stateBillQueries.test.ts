import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getStateLegislatureBillDetail, listStateLegislatureBills } from "./stateBillQueries";

describe("listStateLegislatureBills — regional budget gate", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("US (no regional model) does NOT query regionalBudgets and returns null budget", async () => {
    // Pre-create the collection so the spy exists even though the code should
    // never touch it for the US.
    db.collection("regionalBudgets");

    const page = await listStateLegislatureBills(db as unknown as Db, {
      countryId: "US",
      stateId: "AZ",
      authUser: null,
    });

    expect(page.budget).toBeNull();
    expect(db.collectionMocks["regionalBudgets"]!.findOne).not.toHaveBeenCalled();
  });

  it("UK (regional model) queries regionalBudgets and surfaces the budget", async () => {
    // Pre-create the collection so we can stub its findOne.
    db.collection("regionalBudgets");
    db.collectionMocks["regionalBudgets"]!.findOne.mockResolvedValue({
      _id: "SCT",
      totalBudget: 100,
      enactedBillCosts: 10,
      surplus: 90,
      isOverBudget: false,
      turnsOverBudget: 0,
    });

    const page = await listStateLegislatureBills(db as unknown as Db, {
      countryId: "UK",
      stateId: "SCT",
      authUser: null,
    });

    expect(db.collectionMocks["regionalBudgets"]!.findOne).toHaveBeenCalledWith({ _id: "SCT" });
    expect(page.budget?.totalBudget).toBe(100);
  });
});

describe("getStateLegislatureBillDetail — provision descriptions", () => {
  const BILL_ID = "507f1f77bcf86cd799439011";

  const legType = {
    _id: "ie_electoral_reform",
    name: "Electoral Commission and Seanad Reform Act",
    policyDomain: "governance",
    effectTargetsWeighted: [
      { metricCategoryId: "governance", metricId: "voterTurnout", weight: 0.6 },
    ],
    policyOptions: [
      {
        id: "ie_electoral_reform_opt_0",
        name: "Direct Democracy Expansion Act",
        explanation: "_Acht_ — citizens' assembly",
        stance: "left",
        effectDirection: 1,
        economic: -3,
        social: -4,
      },
      {
        id: "ie_electoral_reform_opt_1",
        name: "Statutory Electoral Commission Act",
        explanation: "Maintain current remit",
        stance: "center",
        effectDirection: 0,
        economic: 0,
        social: 0,
      },
    ],
  };

  const bill = {
    _id: BILL_ID,
    stateId: "ie_dublin",
    countryId: "IE",
    title: "Reform Bill",
    summary: "A reform",
    sponsorName: "Jo",
    sponsorParty: "1",
    status: "voting",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: new Date("2026-06-07T00:00:00Z"),
    legislationTypeId: "ie_electoral_reform",
    provisions: [
      {
        legislationTypeId: "ie_electoral_reform",
        policyOptionId: "ie_electoral_reform_opt_0",
        effectDirection: 1,
      },
    ],
  };

  const cursorOf = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  });

  it("populates proposed + current option names, descriptions, and effects", async () => {
    const db = createMockDb();
    db.collection("stateBills");
    db.collectionMocks["stateBills"]!.findOne.mockResolvedValue(bill);
    db.collection("legislationTypes");
    db.collectionMocks["legislationTypes"]!.find.mockReturnValue(cursorOf([legType]));
    db.collection("statePolicies");
    db.collectionMocks["statePolicies"]!.find.mockReturnValue(
      cursorOf([
        { stateId: "ie_dublin", legislationTypeId: "ie_electoral_reform", policyOptionIndex: 1 },
      ])
    );

    const detail = await getStateLegislatureBillDetail(db as unknown as Db, {
      countryId: "IE",
      stateId: "ie_dublin",
      billId: BILL_ID,
      authUser: null,
    });

    expect(detail).not.toBeNull();
    const prov = detail!.provisions[0]!;
    expect(prov.policyOptionName).toBe("Direct Democracy Expansion Act");
    expect(prov.policyOptionDescription).toBe("_Acht_ — citizens' assembly");
    expect(prov.currentPolicyOptionName).toBe("Statutory Electoral Commission Act");
    expect(prov.currentPolicyOptionDescription).toBe("Maintain current remit");
    expect(prov.economic).toBe(-3);
    expect(prov.social).toBe(-4);
    expect(prov.effects && prov.effects.length).toBeGreaterThan(0);
  });
});

describe("getStateLegislatureBillDetail — vote tally scoped to current chamber", () => {
  const BILL_ID = "507f1f77bcf86cd799439099";
  const charStaying = new ObjectId();
  const charDeparted = new ObjectId();
  const charAgainst = new ObjectId();

  const cursorOf = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  });

  it("drops a departed voter and re-weights survivors so totals stay within seat count (bug #0836)", async () => {
    // Pre-election chamber: charStaying held 19, charDeparted held 8, charAgainst
    // held 4 — and the stored aggregate banked all of them (35 across a 31-seat
    // chamber). After the state legislature election charStaying holds 14,
    // charAgainst holds 17, and charDeparted lost their seat entirely.
    const bill = {
      _id: BILL_ID,
      stateId: "AZ",
      countryId: "US",
      title: "Roads Bill",
      summary: "Fix the roads",
      sponsorName: "Jo",
      sponsorParty: "1",
      status: "active",
      votesFor: 27,
      votesAgainst: 4,
      votesAbstain: 0,
      votes: {
        [charStaying.toString()]: "for",
        [charDeparted.toString()]: "for",
        [charAgainst.toString()]: "against",
      },
      proposedAt: new Date("2026-06-07T00:00:00Z"),
      provisions: [],
    };

    const db = createMockDb();
    db.collection("stateBills");
    db.collectionMocks["stateBills"]!.findOne.mockResolvedValue(bill);
    db.collection("states");
    db.collectionMocks["states"]!.findOne.mockResolvedValue({ stateSenateSeats: 31 });
    db.collection("politicalParties");
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      cursorOf([
        { sequentialId: 1, name: "Reform Party", abbreviation: "RP", color: "#0000ff" },
        { sequentialId: 2, name: "Republican Party", abbreviation: "GOP", color: "#ff0000" },
      ])
    );
    db.collection("characters");
    db.collectionMocks["characters"]!.find.mockReturnValue(
      cursorOf([
        { _id: charStaying, party: "1" },
        { _id: charDeparted, party: "1" },
        { _id: charAgainst, party: "2" },
      ])
    );
    db.collection("npps");
    db.collectionMocks["npps"]!.find.mockReturnValue(cursorOf([]));
    // CURRENT chamber officials — charDeparted is intentionally absent.
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf([
        { characterId: charStaying, countryId: "US", officeType: "stateSenate", seatsHeld: 14 },
        { characterId: charAgainst, countryId: "US", officeType: "stateSenate", seatsHeld: 17 },
      ])
    );

    const detail = await getStateLegislatureBillDetail(db as unknown as Db, {
      countryId: "US",
      stateId: "AZ",
      billId: BILL_ID,
      authUser: null,
    });

    expect(detail).not.toBeNull();
    // Headline totals reflect CURRENT seats (14 for / 17 against), not the stale
    // stored aggregate (27 / 4) that crossed the election boundary.
    expect(detail!.votesFor).toBe(14);
    expect(detail!.votesAgainst).toBe(17);
    expect(detail!.votesAbstain).toBe(0);
    const tallyTotal = detail!.voteByParty.reduce((sum, p) => sum + p.total, 0);
    expect(tallyTotal).toBe(31);
    expect(tallyTotal).toBeLessThanOrEqual(detail!.eligibleSeats);
  });
});

describe("getStateLegislatureBillDetail — frozen snapshot for concluded bills (#0982)", () => {
  const BILL_ID = "507f1f77bcf86cd7994390aa";
  const charForStaying = new ObjectId();
  const charAgainstDeparted = new ObjectId();

  const cursorOf = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  });

  function seedDb() {
    // Bill was signed into law 14 for / 17 against. After a state election the
    // "for" voter kept their seat but the "against" bloc departed — so live
    // re-scoping would collapse the record to "14 … 0" (the reported #0982 bug).
    const bill = {
      _id: BILL_ID,
      stateId: "AZ",
      countryId: "US",
      title: "Too many prisons",
      summary: "State prisons are expensive",
      sponsorName: "Jo",
      sponsorParty: "1",
      status: "enacted",
      votesFor: 14,
      votesAgainst: 17,
      votesAbstain: 0,
      votes: {
        [charForStaying.toString()]: "for",
        [charAgainstDeparted.toString()]: "against",
      },
      voteSnapshot: {
        votes: {
          [charForStaying.toString()]: "for",
          [charAgainstDeparted.toString()]: "against",
        },
        weights: {
          [charForStaying.toString()]: 14,
          [charAgainstDeparted.toString()]: 17,
        },
        totals: { for: 14, against: 17, abstain: 0 },
        resolvedAtTurn: 5,
      },
      proposedAt: new Date("2026-06-07T00:00:00Z"),
      provisions: [],
    };

    const db = createMockDb();
    db.collection("stateBills");
    db.collectionMocks["stateBills"]!.findOne.mockResolvedValue(bill);
    db.collection("states");
    db.collectionMocks["states"]!.findOne.mockResolvedValue({ stateSenateSeats: 31 });
    db.collection("politicalParties");
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(
      cursorOf([
        { sequentialId: 1, name: "Reform Party", abbreviation: "RP", color: "#0000ff" },
        { sequentialId: 2, name: "Republican Party", abbreviation: "GOP", color: "#ff0000" },
      ])
    );
    db.collection("characters");
    db.collectionMocks["characters"]!.find.mockReturnValue(
      cursorOf([
        { _id: charForStaying, party: "1" },
        { _id: charAgainstDeparted, party: "2" },
      ])
    );
    db.collection("npps");
    db.collectionMocks["npps"]!.find.mockReturnValue(cursorOf([]));
    // Post-election chamber: only the "for" voter is still seated. Live scoping
    // would therefore drop the 17 "against" votes and collapse the tally.
    db.collection("electedOfficials");
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursorOf([
        { characterId: charForStaying, countryId: "US", officeType: "stateSenate", seatsHeld: 14 },
      ])
    );
    return { db, bill };
  }

  it("shows the frozen snapshot tally, not a live-scoped collapse, after chamber turnover", async () => {
    const { db } = seedDb();

    const detail = await getStateLegislatureBillDetail(db as unknown as Db, {
      countryId: "US",
      stateId: "AZ",
      billId: BILL_ID,
      authUser: null,
    });

    expect(detail).not.toBeNull();
    // Frozen result — NOT the collapsed 14 / 0 a live re-scope would produce.
    expect(detail!.votesFor).toBe(14);
    expect(detail!.votesAgainst).toBe(17);
    expect(detail!.votesAbstain).toBe(0);
    // Per-party breakdown derives from the same snapshot, so it agrees with the headline.
    const partySum = detail!.voteByParty.reduce((n, p) => n + p.for + p.against + p.abstain, 0);
    expect(partySum).toBe(31);
  });

  it("scopes the same tally in the list view from the snapshot", async () => {
    const { db, bill } = seedDb();
    // The list view loads bills via find().sort().limit().toArray().
    db.collectionMocks["stateBills"]!.find.mockReturnValue(cursorOf([bill]));

    const page = await listStateLegislatureBills(db as unknown as Db, {
      countryId: "US",
      stateId: "AZ",
      authUser: null,
    });

    const card = page.bills.find((b) => b.id === BILL_ID);
    expect(card).toBeDefined();
    expect(card!.votesFor).toBe(14);
    expect(card!.votesAgainst).toBe(17);
  });
});
