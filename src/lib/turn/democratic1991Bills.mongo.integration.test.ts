import { BSON, MongoClient, ObjectId } from "mongodb";
import type { CountryState } from "@/lib/db/types/countryState";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import { processOnePartyBillLifecycleForCountry } from "./onePartyBillLifecycle";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/analytics/billStatusAnalytics", () => ({ captureBillStatusChanged: vi.fn() }));

const uri = process.env.FEDERATION_TEST_MONGO_URI;
const NOW = new Date("2026-10-03T00:00:00Z");

describe.skipIf(!uri)("1991 democratic bill dispatch on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    commandBytes = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(address.hostname))
      throw new Error("Bill qualification requires explicit loopback Mongo");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", (event) => {
      commands++;
      commandBytes += BSON.calculateObjectSize(event.command);
    });
    client.on("commandSucceeded", (event) => {
      replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12;
    });
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
  });

  it.each(["PL", "CS", "HU", "RO", "BG", "YU"] as CountryId[])(
    "advances %s without another country's bills or regime writes",
    async (countryId) => {
      const db = client.db(`ahd_test_1991_bills_${new ObjectId().toHexString()}`);
      try {
        const country = getCountryConfig(countryId, "1991-default");
        const offices = resolveCountryOfficeLayout(country);
        vi.mocked(getDb).mockResolvedValue(db);
        vi.mocked(getGameState).mockResolvedValue({
          preset: "1991-default",
          currentTurn: 100,
        } as Awaited<ReturnType<typeof getGameState>>);
        await db
          .collection<{ _id: string; preset: string; currentTurn: number }>("gameState")
          .insertOne({ _id: "current", preset: "1991-default", currentTurn: 100 });
        await db
          .collection<CountryState>("countryState")
          .insertOne(seedCountryStateFromConfig(countryId, NOW, "1991-default"));
        await db
          .collection<{ _id: CountryId; status: string }>("governmentFormations")
          .insertOne({ _id: countryId, status: "formed" });
        const voter = new ObjectId(),
          upper = new ObjectId(),
          billId = new ObjectId(),
          foreignId = new ObjectId();
        await db
          .collection("electedOfficials")
          .insertMany([
            { nppId: voter, countryId, officeType: offices.lowerOfficeType, seatsHeld: 3 },
            ...(offices.upperOfficeType
              ? [{ nppId: upper, countryId, officeType: offices.upperOfficeType, seatsHeld: 2 }]
              : []),
          ]);
        const bill = {
          status: "active",
          originChamber: country.legislature.lowerChamber.key,
          currentChamber: country.legislature.lowerChamber.key,
          votingEndsOnTurn: 99,
          votes: { [`npp_${voter}`]: "for" },
          votesFor: 0,
          votesAgainst: 10,
          votesAbstain: 0,
          coSponsors: [],
          provisions: [],
        };
        await db.collection("bills").insertMany([
          { ...bill, _id: billId, countryId },
          { ...bill, _id: foreignId, countryId: "ZZ" },
        ]);
        commands = commandBytes = replyBytes = 0;
        await processOnePartyBillLifecycleForCountry(countryId, NOW);
        console.info({
          fixture: `1991-${countryId}-bill-first-stage`,
          commands,
          commandBytes,
          replyBytes,
        });
        let stored = await db.collection("bills").findOne({ _id: billId });
        expect(stored?.votesFor).toBe(3);
        expect(stored?.votesAgainst).toBe(0);
        if (["PL", "CS", "RO"].includes(countryId)) {
          expect(stored?.status).toBe("active_other");
          await db.collection("bills").updateOne(
            { _id: billId },
            {
              $set: {
                otherChamberVotingEndsOnTurn: 100,
                otherChamberVotes: { [`npp_${upper}`]: "for" },
              },
            }
          );
          await processOnePartyBillLifecycleForCountry(countryId, NOW);
          stored = await db.collection("bills").findOne({ _id: billId });
        }
        if (countryId === "RO") {
          expect(stored?.status).toBe("enrolled");
          vi.mocked(getGameState).mockResolvedValue({
            preset: "1991-default",
            currentTurn: 111,
          } as Awaited<ReturnType<typeof getGameState>>);
          await processOnePartyBillLifecycleForCountry(
            countryId,
            new Date(NOW.getTime() + 11 * 3600000)
          );
        }
        expect((await db.collection("bills").findOne({ _id: billId }))?.status).toBe("signed");
        expect((await db.collection("bills").findOne({ _id: foreignId }))?.status).toBe("active");
        expect(await processOnePartyBillLifecycleForCountry(countryId, NOW)).toEqual({
          enacted: 0,
          failed: 0,
        });
        expect(await db.collection("countryLeaderStates").countDocuments()).toBe(0);
        expect(await db.collection("purgeEvents").countDocuments()).toBe(0);
      } finally {
        await db.dropDatabase();
      }
    }
  );
});
