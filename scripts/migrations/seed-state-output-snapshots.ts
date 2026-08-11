/**
 * One-time migration: seed stateOutputSnapshots from current owned + unowned
 * sector revenue. Sets previousOutput = currentOutput so the first turn after
 * deployment sees ~0% growth (correct — no prior data to compare against).
 *
 * Usage: npx tsx scripts/migrations/seed-state-output-snapshots.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

const NATIONAL_IDS = new Set([
  "federal",
  "uk_national",
  "ca_national",
  "de_national",
  "jp_national",
]);

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  const [ownedSectors, unownedSectors, states, gameState, corps, exchangeRates] = await Promise.all(
    [
      db
        .collection("corporateSectors")
        .find({}, { projection: { stateId: 1, corporationId: 1, revenue: 1 } })
        .toArray(),
      db
        .collection("unownedSectors")
        .find({}, { projection: { stateId: 1, revenue: 1 } })
        .toArray(),
      db.collection("states").find({}).toArray(),
      db
        .collection<{ _id: string; currentTurn: number }>("gameState")
        .findOne({ _id: "current" as never }),
      db
        .collection("corporations")
        .find({}, { projection: { _id: 1, countryId: 1, liquidCurrencyCode: 1 } })
        .toArray(),
      db
        .collection("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
    ]
  );

  // Post-v0.2.6: corporateSectors.revenue is in each corp's liquidCurrencyCode,
  // so cross-corp state sums must anchor-normalize. unownedSectors.revenue is
  // already ₳ (per corp-turn cross-corp shed), so it passes through.
  const rateByCurrency = new Map<string, number>();
  for (const r of exchangeRates) {
    const code = r.currencyCode as string;
    const rate = Number(r.rate);
    if (code && Number.isFinite(rate) && rate > 0) rateByCurrency.set(code, rate);
  }
  const COUNTRY_TO_CURRENCY: Record<string, string> = {
    US: "USD",
    UK: "GBP",
    JP: "JPY",
    CA: "CAD",
    DE: "EUR",
  };
  const corpAnchorRate = new Map<string, number>();
  for (const c of corps) {
    const corpId = String(c._id);
    const code =
      (c.liquidCurrencyCode as string | undefined) ??
      (c.countryId ? COUNTRY_TO_CURRENCY[c.countryId as string] : undefined);
    if (!code) {
      corpAnchorRate.set(corpId, 1);
      continue;
    }
    const rate = rateByCurrency.get(code);
    // Divide local by rate to get ₳; missing rate → passthrough (pre-forex).
    corpAnchorRate.set(corpId, rate && rate > 0 ? 1 / rate : 1);
  }

  const outputByState = new Map<string, number>();
  for (const s of ownedSectors) {
    const sid = s.stateId as string;
    const corpId = String(s.corporationId);
    const factor = corpAnchorRate.get(corpId) ?? 1;
    const revenueAnchor = (s.revenue as number) * factor;
    outputByState.set(sid, (outputByState.get(sid) ?? 0) + revenueAnchor);
  }
  for (const u of unownedSectors) {
    const sid = u.stateId as string;
    outputByState.set(sid, (outputByState.get(sid) ?? 0) + (u.revenue as number));
  }

  const currentTurn = gameState?.currentTurn ?? 1;
  const now = new Date();

  const ops = [];
  for (const state of states) {
    const stateId = String(state._id);
    if (NATIONAL_IDS.has(stateId)) continue;
    const output = outputByState.get(stateId) ?? 0;
    ops.push({
      updateOne: {
        filter: { _id: stateId },
        update: {
          $set: {
            currentOutput: output,
            previousOutput: output,
            turn: currentTurn,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    const result = await db
      .collection<{ _id: string }>("stateOutputSnapshots")
      .bulkWrite(ops as never);
    console.log(
      `Seeded ${result.upsertedCount + result.modifiedCount} state output snapshots at turn ${currentTurn}`
    );
  } else {
    console.log("No states found to seed");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
