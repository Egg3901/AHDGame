/** Opening policy rates qualify through the real, idempotent bank seeder. */
import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateCentralBanks } from "./migration";
import { getBankId } from "@/lib/centralBank/helpers";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

const uri = process.env.FEDERATION_TEST_MONGO_URI;
describe.skipIf(!uri)("Opening central-bank rates on isolated Mongo", () => {
  let client: MongoClient;
  let commands = 0,
    replyBytes = 0;
  beforeAll(async () => {
    const address = new URL(uri!);
    if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
      throw new Error("Isolated loopback Mongo required");
    client = new MongoClient(uri!, { monitorCommands: true, serverSelectionTimeoutMS: 5000 });
    client.on("commandStarted", () => commands++);
    client.on(
      "commandSucceeded",
      (event) => (replyBytes += BSON.calculateObjectSize({ reply: event.reply }) - 12)
    );
    await client.connect();
  });
  afterAll(async () => {
    await client?.close();
  });
  it("seeds affordable opening rates in one bounded batch and preserves subsequent policy", async () => {
    const db = client.db(`ahd_test_opening_bank_${new ObjectId()}`);
    try {
      commands = 0;
      replyBytes = 0;
      await updateCentralBanks(db, "1991-default");
      const metrics = { commands, replyBytes };
      expect(metrics.commands).toBeLessThanOrEqual(2);
      for (const [country, expected] of [
        ["US", 4],
        ["UK", 4.5],
        ["JP", 3],
        ["DE", 4],
        ["IE", 4.5],
      ] as const) {
        expect(
          (
            await db
              .collection<{ _id: string; primeRate: number }>("centralBanks")
              .findOne({ _id: getBankId(country) })
          )?.primeRate
        ).toBe(expected);
      }
      await db
        .collection<{ _id: string; primeRate: number }>("centralBanks")
        .updateOne(
          { _id: getBankId("US") },
          { $set: { primeRate: 8.125, forexRevenue: 123, rateHistory: [{ turn: 2, rate: 8.125 }] } }
        );
      await updateCentralBanks(db, "1991-default");
      expect(
        await db
          .collection<{ _id: string; primeRate: number }>("centralBanks")
          .findOne({ _id: getBankId("US") })
      ).toMatchObject({
        primeRate: 8.125,
        forexRevenue: 123,
        rateHistory: [{ turn: 2, rate: 8.125 }],
      });
      process.stdout.write(JSON.stringify({ journey: "opening-bank-seed", ...metrics }) + "\n");
    } finally {
      await db.dropDatabase();
    }
  });
  it.each(["1953-default", "1979-default", "2027-default"])(
    "preserves existing seeder defaults for %s",
    async (preset) => {
      const db = client.db(`ahd_test_opening_bank_${new ObjectId()}`);
      try {
        await updateCentralBanks(db, preset);
        for (const country of ["US", "UK", "JP", "DE", "IE"] as CountryId[]) {
          expect(
            (
              await db
                .collection<{ _id: string; primeRate: number }>("centralBanks")
                .findOne({ _id: getBankId(country) })
            )?.primeRate
          ).toBe(COUNTRY_CONFIGS[country].centralBank.defaultPrimeRate);
        }
      } finally {
        await db.dropDatabase();
      }
    }
  );
});
