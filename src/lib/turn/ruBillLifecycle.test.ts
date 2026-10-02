import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processRussian1991Bills } from "./ruBillLifecycle";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

function scenario(
  markers: Record<string, number>,
  chamber: string,
  officeType: string,
  provision = false
) {
  const mem = createInMemoryDb();
  const voterId = new ObjectId();
  const againstId = new ObjectId();
  const billId = new ObjectId();
  mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 50 }]);
  mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
  mem.seed("governmentFormations", [{ _id: "RU", status: "formed" }]);
  mem.seed("bills", [
    {
      _id: billId,
      countryId: "RU",
      level: "national",
      status: "active",
      originChamber: chamber,
      currentChamber: chamber,
      title: "Test mandate",
      sponsorId: null,
      votingEndsOnTurn: 49,
      votes: { [`npp_${voterId}`]: "for", [`npp_${againstId}`]: "against" },
      provisions: provision ? [{ type: "nationalize" }] : [],
      createdAt: new Date(0),
    },
  ]);
  mem.seed("electedOfficials", [
    { _id: new ObjectId(), countryId: "RU", officeType, nppId: voterId, seatsHeld: 3 },
    { _id: new ObjectId(), countryId: "RU", officeType, nppId: againstId, seatsHeld: 2 },
  ]);
  return { mem, db: mem as unknown as Db, billId };
}

describe("ordinary Russian runtime bill resolution", () => {
  it.each([
    [{}, "unionCongress", "unionCongressDeputy"],
    [
      { ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: 10 },
      "congressOfPeoplesDeputies",
      "congressDeputy",
    ],
  ] as const)("enacts a real majority bill through %s", async (markers, chamber, office) => {
    const { mem, db } = scenario(markers, chamber, office);
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 1,
      failed: 0,
    });
    expect(mem.collection("bills").docs[0]).toMatchObject({
      status: "signed",
      votesFor: 3,
      votesAgainst: 2,
    });
  });
  it("activates a proposed Congress bill and resolves its office-key chamber", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    const bill = mem.collection("bills").docs[0];
    bill.status = "proposed";
    delete bill.currentChamber;
    await processRussian1991Bills(db, new Date(100000000), 50);
    expect(bill).toMatchObject({
      status: "active",
      currentChamber: "congressDeputy",
      votingEndsOnTurn: 74,
    });
    expect(await processRussian1991Bills(db, new Date(100000000), 75)).toEqual({
      enacted: 1,
      failed: 0,
    });
    expect(bill.status).toBe("signed");
  });
  it("leaves foreign joint bills untouched", async () => {
    const { mem, db } = scenario({ ruSovietSuccessionSinceTurn: 24 }, "joint", "congressDeputy");
    const bill = mem.collection("bills").docs[0];
    Object.assign(bill, {
      countryId: "CS",
      status: "active_both",
      otherChamberVotingEndsOnTurn: 49,
    });
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect(bill.status).toBe("active_both");
  });
  it("sends a winning Congress bill to the independently established president", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruPresidencySinceTurn: 40 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 1,
      failed: 0,
    });
    const bill = mem.collection("bills").docs[0];
    expect(bill).toMatchObject({ status: "enrolled", presidentActionDeadlineOnTurn: 60 });
    expect(await processRussian1991Bills(db, new Date(100000000), 59)).toEqual({
      enacted: 0,
      failed: 0,
    });
    await processRussian1991Bills(db, new Date(100000000), 60);
    expect(bill).toMatchObject({ status: "signed", presidentAction: "unsigned_law" });
  });
  it("sends an activated Duma bill to the Federation Council", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 40 },
      "stateDuma",
      "dumaDeputy"
    );
    const bill = mem.collection("bills").docs[0];
    bill.status = "proposed";
    delete bill.currentChamber;
    await processRussian1991Bills(db, new Date(100000000), 50);
    await processRussian1991Bills(db, new Date(100000000), 75);
    expect(bill).toMatchObject({
      status: "active_other",
      currentChamber: "federationCouncil",
      votesFor: 3,
    });
  });
  it("applies the non-one-party asset transfer threshold after succession", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: 10 },
      "congressOfPeoplesDeputies",
      "congressDeputy",
      true
    );
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 0,
      failed: 1,
    });
    expect(mem.collection("bills").docs[0].status).toBe("failed");
  });
  it("does not resolve or activate bills while Congress is dissolved", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruCongressDissolvedSinceTurn: 40 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect(mem.collection("bills").docs[0].status).toBe("active");
  });
  it("preserves government formation freeze", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    mem.collection("governmentFormations").docs[0].status = "pending";
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect(mem.collection("bills").docs[0].status).toBe("active");
  });
});

describe("Russian constitutional bill resolution", () => {
  it("rejects an ordinary majority when constitutional votes fall below full capacity", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: 10 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    mem.collection("bills").docs[0].russianConstitutionalMandate = {
      proposalId: "1991-default:ru-constitution:presidency",
      revision: 1,
      kind: "presidency",
    };
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 0,
      failed: 1,
    });
    expect(mem.collection("bills").docs[0].status).toBe("failed");
  });
  it("enacts a constitutional decision with two-thirds of the full chamber", async () => {
    const { mem, db } = scenario(
      { ruSovietSuccessionSinceTurn: 24, ruProvisionalCongressSeats: 6 },
      "congressOfPeoplesDeputies",
      "congressDeputy"
    );
    mem.collection("bills").docs[0].russianConstitutionalMandate = {
      proposalId: "1991-default:ru-constitution:presidency",
      revision: 1,
      kind: "presidency",
    };
    mem.collection("electedOfficials").docs[0].seatsHeld = 4;
    expect(await processRussian1991Bills(db, new Date(100000000), 50)).toEqual({
      enacted: 1,
      failed: 0,
    });
    expect(mem.collection("bills").docs[0].status).toBe("signed");
    expect(mem.collection("countryGameStates").docs[0]).not.toHaveProperty("ruPresidencySinceTurn");
  });
});

describe("Council formation statutory voting", () => {
  it.each([
    [225, false],
    [226, true],
  ] as const)("requires the full Duma majority with %s votes", async (forVotes, pass) => {
    const { mem, db } = scenario(
      {
        ruSovietSuccessionSinceTurn: 48,
        ruPresidencySinceTurn: 60,
        ruFederalAssemblySinceTurn: 145,
      },
      "stateDuma",
      "dumaDeputy"
    );
    mem.collection("electedOfficials").docs[0].seatsHeld = forVotes;
    mem.collection("bills").docs[0].russianCouncilFormationMandate = {
      proposalId: "1991-default:ru-council:regionalHeads",
      mode: "regionalHeads",
      revision: 1,
    };
    await processRussian1991Bills(db, new Date(100000000), 237);
    expect(mem.collection("bills").docs[0].status).toBe(pass ? "active_other" : "failed");
  });
  it.each([
    [89, false],
    [90, true],
  ] as const)(
    "retains the appointed Council's full-capacity majority with %s votes",
    async (forVotes, pass) => {
      const { mem, db } = scenario(
        {
          ruSovietSuccessionSinceTurn: 48,
          ruPresidencySinceTurn: 60,
          ruFederalAssemblySinceTurn: 145,
        },
        "federationCouncil",
        "federationCouncilMember"
      );
      mem.collection("countryGameStates").docs[0].ruCouncilComposition = {
        mode: "regionalHeads",
        proposalId: "heads",
        revision: 1,
        sinceTurn: 241,
        receiptId: "heads",
      };
      const bill = mem.collection("bills").docs[0];
      bill.status = "active_other";
      bill.otherChamberVotes = bill.votes;
      bill.otherChamberVotingEndsOnTurn = 49;
      bill.russianCouncilFormationMandate = {
        proposalId: "1991-default:ru-council:regionalDelegates",
        mode: "regionalDelegates",
        revision: 1,
      };
      mem.collection("electedOfficials").docs[0].seatsHeld = forVotes;
      await processRussian1991Bills(db, new Date(100000000), 461);
      expect(bill.status).toBe(pass ? "enrolled" : "failed");
    }
  );
});
