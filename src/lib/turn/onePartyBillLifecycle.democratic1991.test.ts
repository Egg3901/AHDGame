import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "./onePartyBillLifecycle";
import { processRulingPartyConfidenceTurn } from "./rulingPartyConfidenceTurn";
import { onBillEnacted } from "@/lib/billEnactment";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({
  onBillEnacted: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("./rulingPartyConfidenceTurn", () => ({ processRulingPartyConfidenceTurn: vi.fn() }));
vi.mock("@/lib/analytics/billStatusAnalytics", () => ({ captureBillStatusChanged: vi.fn() }));

const NOW = new Date("2026-10-03T00:00:00Z");
const COUNTRIES: CountryId[] = ["PL", "CS", "HU", "RO", "BG", "YU"];

describe("1991 democratic registry bill dispatch", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createInMemoryDb();
    db.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 100 }]);
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(getGameState).mockResolvedValue({
      preset: "1991-default",
      currentTurn: 100,
    } as Awaited<ReturnType<typeof getGameState>>);
  });

  function seedBill(countryId: CountryId, against = false) {
    const country = getCountryConfig(countryId, "1991-default");
    const offices = resolveCountryOfficeLayout(country);
    db.seed("countryState", [{ ...seedCountryStateFromConfig(countryId, NOW, "1991-default") }]);
    db.seed("governmentFormations", [{ _id: countryId, status: "formed" }]);
    const voter = new ObjectId();
    const departedVoter = new ObjectId();
    const upperVoter = new ObjectId();
    db.seed("electedOfficials", [
      { countryId, officeType: offices.lowerOfficeType, nppId: voter, seatsHeld: 3 },
      ...(offices.upperOfficeType
        ? [{ countryId, officeType: offices.upperOfficeType, nppId: upperVoter, seatsHeld: 2 }]
        : []),
    ]);
    const id = new ObjectId();
    db.seed("bills", [
      {
        _id: id,
        title: "Synthetic parliamentary bill",
        category: "government",
        countryId,
        status: "active",
        originChamber: country.legislature.lowerChamber.key,
        currentChamber: country.legislature.lowerChamber.key,
        votingEndsOnTurn: 99,
        votes: {
          [`npp_${voter}`]: against ? "against" : "for",
          [`npp_${departedVoter}`]: "against",
        },
        votesFor: 0,
        votesAgainst: 999,
        votesAbstain: 0,
        coSponsors: [],
        provisions: [],
      },
    ]);
    return { id, upperVoter, country };
  }

  it.each(COUNTRIES)(
    "advances %s through its actual chambers and executive, once",
    async (countryId) => {
      const { id, upperVoter } = seedBill(countryId);
      const hasUpper = ["PL", "CS", "RO"].includes(countryId);
      const hasExecutive = countryId === "RO";
      let result = await processOnePartyBillLifecycleForCountry(countryId, NOW);
      let bill = await db.collection("bills").findOne({ _id: id });
      expect(bill?.votesFor).toBe(3);
      expect(bill?.votesAgainst).toBe(0);
      expect(bill?.voteSnapshot).toMatchObject({ totals: { for: 3, against: 0, abstain: 0 } });
      if (hasUpper) {
        expect(bill?.status).toBe("active_other");
        expect(result).toEqual({ enacted: 0, failed: 0 });
        await db.collection("bills").updateOne(
          { _id: id },
          {
            $set: {
              otherChamberVotingEndsOnTurn: 100,
              otherChamberVotes: { [`npp_${upperVoter}`]: "for" },
            },
          }
        );
        result = await processOnePartyBillLifecycleForCountry(countryId, NOW);
        bill = await db.collection("bills").findOne({ _id: id });
        expect(bill?.otherChamberVotesFor).toBe(2);
      }
      if (hasExecutive) {
        expect(bill?.status).toBe("enrolled");
        expect(result).toEqual({ enacted: 0, failed: 0 });
        vi.mocked(getGameState).mockResolvedValue({
          preset: "1991-default",
          currentTurn: 111,
        } as Awaited<ReturnType<typeof getGameState>>);
        result = await processOnePartyBillLifecycleForCountry(
          countryId,
          new Date(NOW.getTime() + 11 * 3600000)
        );
      }
      expect(result).toEqual({ enacted: 1, failed: 0 });
      expect((await db.collection("bills").findOne({ _id: id }))?.status).toBe("signed");
      expect(await processOnePartyBillLifecycleForCountry(countryId, NOW)).toEqual({
        enacted: 0,
        failed: 0,
      });
      expect(onBillEnacted).toHaveBeenCalledTimes(1);
      expect(processRulingPartyConfidenceTurn).not.toHaveBeenCalled();
    }
  );

  it.each(COUNTRIES)("rejects %s bills on current-seat votes", async (countryId) => {
    const { id } = seedBill(countryId, true);
    expect(await processOnePartyBillLifecycleForCountry(countryId, NOW)).toEqual({
      enacted: 0,
      failed: 1,
    });
    expect((await db.collection("bills").findOne({ _id: id }))?.status).toBe("failed");
    expect(onBillEnacted).not.toHaveBeenCalled();
  });

  it.each(["CS", "YU"] as const)("keeps retired %s legislation frozen", async (countryId) => {
    const { id } = seedBill(countryId);
    db.seed("countryGameStates", [{ _id: countryId, dissolvedTurn: 90 }]);
    expect(await processOnePartyBillLifecycleForCountry(countryId, NOW)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect((await db.collection("bills").findOne({ _id: id }))?.status).toBe("active");
  });

  it("waits for an existing government formation before processing proposed or active bills", async () => {
    const { id } = seedBill("HU");
    await db
      .collection("governmentFormations")
      .updateOne({ _id: "HU" }, { $set: { status: "pending" } });
    const proposed = new ObjectId();
    db.seed("bills", [
      { _id: proposed, countryId: "HU", status: "proposed", originChamber: "nationalAssembly" },
    ]);
    expect(await processOnePartyBillLifecycleForCountry("HU", NOW)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect((await db.collection("bills").findOne({ _id: id }))?.status).toBe("active");
    expect((await db.collection("bills").findOne({ _id: proposed }))?.status).toBe("proposed");
  });

  it.each(["PL", "CS", "RO"] as const)(
    "rejects %s when the second chamber refuses",
    async (countryId) => {
      const { id, upperVoter } = seedBill(countryId);
      await processOnePartyBillLifecycleForCountry(countryId, NOW);
      await db.collection("bills").updateOne(
        { _id: id },
        {
          $set: {
            otherChamberVotingEndsOnTurn: 100,
            otherChamberVotes: { [`npp_${upperVoter}`]: "against" },
          },
        }
      );
      expect(await processOnePartyBillLifecycleForCountry(countryId, NOW)).toEqual({
        enacted: 0,
        failed: 1,
      });
      expect((await db.collection("bills").findOne({ _id: id }))?.status).toBe("failed");
      expect(onBillEnacted).not.toHaveBeenCalled();
    }
  );

  it("preserves the converted Chinese one-party guard in a 1991 world", async () => {
    db.seed("countryState", [
      {
        ...seedCountryStateFromConfig("CN", NOW, "1991-default"),
        governmentType: "parliamentaryRepublic",
      },
    ]);
    db.seed("bills", [
      {
        _id: new ObjectId(),
        countryId: "CN",
        status: "active",
        originChamber: "npc",
        votingEndsOnTurn: 99,
        votesFor: 10,
        votesAgainst: 0,
      },
    ]);
    expect(await processOnePartyBillLifecycleForCountry("CN", NOW)).toEqual({
      enacted: 0,
      failed: 0,
    });
    expect(db.collection("bills").docs[0].status).toBe("active");
    expect(processRulingPartyConfidenceTurn).not.toHaveBeenCalled();
  });
});
