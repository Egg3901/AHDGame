/** Country GDP comparisons qualify against authored seeds on isolated Mongo. */
import { BSON, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { sovietUnionRegions1991 } from "@/lib/countries/ru/data/sovietUnionRegions1991";
import { ruRegions1991 } from "@/lib/countries/ru/data/ruRegions1991";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { loadUsdGdpByCountry } from "@/lib/internationalOrganizations/countryGdp";

const uri = process.env.FEDERATION_TEST_MONGO_URI;
describe.skipIf(!uri)("1991 native GDP consumers on isolated Mongo", () => {
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
  it("loads the active preset and values all regions in two projected reads", async () => {
    const db = client.db(`ahd_test_native_gdp_${new ObjectId()}`);
    try {
      await db
        .collection<{ _id: string; preset: string }>("gameState")
        .insertOne({ _id: "current", preset: "1991-default" });
      const regions = [...ngRegions1991, ...sovietUnionRegions1991, ...plRegions1991];
      await db.collection<{ _id: string; [key: string]: unknown }>("states").insertMany(
        regions.map((row) => ({
          ...row,
          _id: `${row.countryId}_${row._id}`,
          ignoredPayload: "x".repeat(100_000),
        }))
      );
      commands = 0;
      replyBytes = 0;
      const values = await loadUsdGdpByCountry(db, ["NG", "RU", "PL"]);
      const metrics = { commands, replyBytes };
      for (const country of ["NG", "RU", "PL"] as CountryId[]) {
        const local = regions
          .filter((row) => row.countryId === country)
          .reduce((sum, row) => sum + row.gdp, 0);
        expect(values.get(country)).toBeCloseTo(local / INITIAL_RATES_1991[country]!, 7);
      }
      expect(metrics.commands).toBe(2);
      expect(metrics.replyBytes).toBeLessThan(10_000);
      process.stdout.write(
        JSON.stringify({
          journey: "national-gdp",
          ...metrics,
          anchorMillions: Object.fromEntries(values),
        }) + "\n"
      );
      // Model a territorial split: only the departing regions leave. Existing
      // Russian output amounts keep their original-ruble denomination.
      await db.collection<{ _id: string; countryId: CountryId }>("states").deleteMany({
        countryId: "RU",
        _id: {
          $in: sovietUnionRegions1991
            .filter((row) => row._id.startsWith("SU_"))
            .map((row) => `RU_${row._id}`),
        },
      });
      const after = await loadUsdGdpByCountry(db, ["RU"], "1991-default");
      expect(after.get("RU")).toBeCloseTo(
        ruRegions1991.reduce((sum, row) => sum + row.gdp, 0) / INITIAL_RATES_1991.RU!,
        7
      );
    } finally {
      await db.dropDatabase();
    }
  });
});
