/** Replay campaign income phases against a copied, completed simulation cohort. */
import { MongoClient, ObjectId, BSON } from "mongodb";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ERA_PRICE_LEVEL } from "../../src/lib/campaigns/rules/priceLevel";
import { getGdpBaseline } from "../../src/lib/utils/fundGeneration";
import { getCampaignFundCost, getBuildDonorBaseFundCost } from "../../src/lib/actions/rules";

async function main() {
  const [sourceName, output] = process.argv.slice(2);
  const uri = process.env.CAMPAIGN_REPLAY_MONGO_URI;
  if (!uri || !/^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri))
    throw new Error("An explicit loopback sandbox Mongo URI on port 27018 is required");
  if (!sourceName?.startsWith("ahd_sim_") || !output)
    throw new Error("Supply a simulation database and report path");
  const client = await new MongoClient(uri, { monitorCommands: true }).connect();
  const source = client.db(sourceName);
  const run = await source.collection("simRuns").findOne({ status: "completed" });
  if (!run?.source?.executedCommit) throw new Error("Completed source provenance required");
  const allNpps = await source
    .collection("npps")
    .find(
      { retiredAt: null, isTechnocrat: { $ne: true } },
      {
        projection: {
          homeState: 1,
          countryId: 1,
          funds: 1,
          donorBaseLevel: 1,
          party: 1,
          actionPoints: 1,
          politicalInfluence: 1,
          favorability: 1,
        },
      }
    )
    .sort({ _id: 1 })
    .toArray();
  const countryCounts = new Map<string, number>();
  const cohort = allNpps.filter((n) => {
    const country = String(n.countryId ?? "US");
    const count = countryCounts.get(country) ?? 0;
    countryCounts.set(country, count + 1);
    return count < 8;
  });
  const collections = [
    "states",
    "exchangeRates",
    "politicalParties",
    "statePartyOrg",
    "gameConfig",
    "gameState",
  ];
  const saved = new Map(
    await Promise.all(
      collections.map(
        async (name) => [name, await source.collection(name).find({}).toArray()] as const
      )
    )
  );
  const targetName = `ahd_sim_campaign_price_replay_${Date.now()}`;
  const target = client.db(targetName);
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = targetName;
  global._mongoClientPromise = Promise.resolve(client);
  const { processNppFundGeneration } = await import("../../src/lib/turn/nppFundGeneration");
  const { processCampaignTurn } = await import("../../src/lib/turn/campaignTurn");
  let phase = "";
  const commands: Record<string, number[]> = { nppFunds: [], campaigns: [] };
  let roundTrips = 0;
  client.on("commandStarted", (e) => {
    if (phase && e.databaseName === targetName) roundTrips++;
  });
  const rows: Array<Record<string, any>> = [];
  let replyBytes = 0;
  const bytes: Record<string, number[]> = { nppFunds: [], campaigns: [] };
  client.on("commandSucceeded", (e) => {
    if (phase) replyBytes += BSON.calculateObjectSize(e.reply);
  });
  try {
    for (const { era, priceLevel, enabled } of [
      ...Object.entries(ERA_PRICE_LEVEL).map(([era, priceLevel]) => ({
        era,
        priceLevel,
        enabled: true,
      })),
      { era: "1991", priceLevel: 1, enabled: false },
    ]) {
      await target.dropDatabase();
      for (const [name, docs] of saved)
        if (docs.length) await target.collection(name).insertMany(docs);
      await target
        .collection("gameConfig")
        .updateOne(
          { _id: "default" as never },
          { $set: { campaignEraPriceLevelEnabled: enabled, ledgerShadow: false } }
        );
      await target
        .collection("gameState")
        .updateOne({ _id: "current" as never }, { $set: { preset: `${era}-default` } });
      await target
        .collection("npps")
        .insertMany(cohort.map((n) => ({ ...n, funds: (n.funds ?? 0) * priceLevel })));
      const candidates = cohort.filter((n) => n.countryId === "US").slice(0, 3);
      if (candidates.length !== 3)
        throw new Error("Three US NPPs required for synthetic campaign fixtures");
      const campaigns = candidates.map((n, i) => ({
        _id: new ObjectId(),
        electionId: new ObjectId(),
        candidateId: n._id,
        candidateIsNPP: true,
        party: n.party,
        status: "active",
        funds: (i === 2 ? 0 : 100000) * priceLevel,
        actions: 10,
        fundraisingLevel: i === 2 ? 0 : i,
        groundGameLevel: i === 2 ? 10 : i,
        mediaSpendingLevel: i === 2 ? 10 : i,
        oppositionResearchLevel: 0,
        totalFundsGenerated: 0,
        totalActionsGenerated: 0,
      }));
      await target.collection("campaigns").insertMany(campaigns);
      await target.collection("elections").insertMany(
        campaigns.map((c) => ({
          _id: c.electionId,
          countryId: "US",
          electionType: "president",
          status: "active",
          endTurn: 1000,
          primaryEndTurn: 1000,
        }))
      );
      let generated = 0,
        maintenance = 0,
        processed = 0,
        downgraded = 0;
      for (let turn = 14; turn < 38; turn++) {
        phase = "nppFunds";
        roundTrips = 0;
        replyBytes = 0;
        await processNppFundGeneration(target, turn);
        commands.nppFunds.push(roundTrips);
        bytes.nppFunds.push(replyBytes);
        phase = "campaigns";
        roundTrips = 0;
        replyBytes = 0;
        const c = await processCampaignTurn(turn);
        commands.campaigns.push(roundTrips);
        bytes.campaigns.push(replyBytes);
        phase = "";
        generated += c.totalFundsGenerated;
        maintenance += c.totalMaintenancePaid;
        processed += c.campaignsProcessed;
        downgraded += c.campaignsAutoDowngraded;
      }
      const balances = await target
        .collection("npps")
        .find({}, { projection: { funds: 1 } })
        .toArray();
      const campaignBalances = await target
        .collection("campaigns")
        .find({}, { projection: { funds: 1 } })
        .toArray();
      const baseline = getGdpBaseline("US", `${era}-default`);
      rows.push({
        era,
        enabled,
        priceLevel,
        turns: 24,
        npps: balances.length,
        nonfiniteOrNegative: balances.filter((n) => !Number.isFinite(n.funds) || n.funds < 0)
          .length,
        normalizedNppFunds: balances.reduce((sum, n) => sum + n.funds / priceLevel, 0),
        campaignFixtures: campaigns.length,
        processed,
        generated,
        maintenance,
        downgraded,
        normalizedCampaignFunds: campaignBalances.map((c) => c.funds / priceLevel),
        campaignActionCost: getCampaignFundCost(
          0,
          baseline,
          1_000_000,
          "US",
          `${era}-default`,
          priceLevel
        ),
        firstDonorBaseCost: getBuildDonorBaseFundCost(
          0,
          baseline,
          1_000_000,
          "US",
          `${era}-default`,
          priceLevel
        ),
      });
    }
    const report = {
      source: {
        runId: run.runId,
        sourceCommit: run.source.executedCommit,
        completedTurn: run.currentTurn,
      },
      replay: {
        commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        dirty:
          execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
        turnsPerEra: 24,
        retainedCohort: "First eight active NPPs by identifier per country",
        syntheticCampaigns:
          "Three US NPP campaigns per era: level zero, level one, and an insolvent zero-fund campaign with level-ten maintenance and no fundraising upgrades",
        limitation:
          "Phase replay, not a new full world or historical macro validation. Prices vary while retained populations, currencies and actor distributions are held fixed.",
      },
      roundTrips: Object.fromEntries(
        Object.entries(commands).map(([key, values]) => [
          key,
          { min: Math.min(...values), max: Math.max(...values) },
        ])
      ),
      replyBsonBytes: Object.fromEntries(
        Object.entries(bytes).map(([key, values]) => [
          key,
          { min: Math.min(...values), max: Math.max(...values) },
        ])
      ),
      rows,
    };
    if (
      rows.some(
        (r) =>
          r.nonfiniteOrNegative !== 0 ||
          r.processed !== 72 ||
          r.firstDonorBaseCost <= 0 ||
          r.downgraded < 1
      )
    )
      throw new Error("Replay invariant failed");
    const legacy = rows.at(-1)!;
    const modern = rows.find((r) => r.era === "2019")!;
    if (
      legacy.normalizedNppFunds !== modern.normalizedNppFunds ||
      JSON.stringify(legacy.normalizedCampaignFunds) !==
        JSON.stringify(modern.normalizedCampaignFunds)
    )
      throw new Error("Legacy flag-off parity failed");
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  } finally {
    phase = "";
    await target.dropDatabase();
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
