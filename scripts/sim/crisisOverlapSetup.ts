/** Explicit composition of previously qualified crisis states in a retained economy. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Db, Document, MongoClient } from "mongodb";
import { allLivingConflictDefs, livingConflictDef } from "../../src/lib/livingConflict/registry";
import { emptyConflictState, normalizeConflictState } from "../../src/lib/livingConflict/engine";
import type { LivingConflictState } from "../../src/lib/livingConflict/types";

export const MODERN_KEYS = [
  "northern_ireland",
  "yugoslav_dissolution",
  "transnational_terrorism",
  "global_financial_crisis",
  "arab_uprisings",
  "russia_ukraine_security",
  "pandemic",
];
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report = (name: string) =>
  JSON.parse(readFileSync(new URL(`./reports/${name}`, import.meta.url), "utf8"));
export async function prepareOverlap(
  client: MongoClient,
  sourceName: string,
  financeName: string,
  arabName: string
) {
  const source = client.db(sourceName),
    finance = client.db(financeName),
    arab = client.db(arabName);
  const countries = ["US", "UK", "DE", "IE", "PL", "TR"];
  const cohorts = await source
    .collection("regionDemographics")
    .find({ countryId: { $in: countries } })
    .sort({ _id: 1 })
    .toArray();
  const ids = countries
    .map((id) => cohorts.find((row) => row.countryId === id)?._id)
    .filter(Boolean);
  assert(ids.length >= 4);
  const saved: [string, Document[]][] = [];
  const reads: { db: Db; collection: string; filter: Document; hash: string }[] = [];
  async function retain(db: Db, collection: string, filter: Document = {}) {
    const rows = await db.collection(collection).find(filter).sort({ _id: 1 }).toArray();
    reads.push({ db, collection, filter, hash: digest(rows) });
    saved.push([collection, rows]);
  }
  for (const name of [
    "gameState",
    "gameConfig",
    "countryGameStates",
    "federalBudget",
    "centralBanks",
    "corporations",
    "corporateSectors",
    "exchangeRates",
    "commodityPrices",
    "systemSettings",
    "bankLoans",
    "bankGuarantees",
    "depositInsuranceFunds",
    "interbankLoans",
    "bonds",
    "bondMarketPools",
  ])
    await retain(finance, name);
  for (const name of [
    "states",
    "regionDemographics",
    "macroMetrics",
    "politicalMetrics",
    "stateMetrics",
  ])
    await retain(source, name, { _id: { $in: ids } });
  for (const name of [
    "governmentApprovals",
    "statePolicies",
    "enactedLaws",
    "regionalBudgets",
    "stateBudgets",
    "militaryUnits",
    "countryMilitary",
  ])
    await retain(source, name);
  await retain(source, "macroCountries", {
    entityId: {
      $in: [
        "UKR",
        "RU",
        "SY",
        "EG",
        "LY",
        "TR",
        "JO",
        "LB",
        "IQ",
        "DE",
        "AT",
        "PL",
        "BR",
        "CA",
        "YU",
        "RS",
      ],
    },
  });
  const stateRows = await source
    .collection<LivingConflictState>("livingConflicts")
    .find({ defKey: { $in: MODERN_KEYS } })
    .toArray();
  const financeState = await finance
    .collection<LivingConflictState>("livingConflicts")
    .findOne({ defKey: "global_financial_crisis" });
  const arabState = await arab
    .collection<LivingConflictState>("livingConflicts")
    .findOne({ defKey: "arab_uprisings" });
  assert(financeState && arabState?.arabRegional);
  const security = report("issue-2156-security-acceptance.json");
  const pandemic = report("issue-2155-pandemic-acceptance.json");
  const financial = report("issue-2154-financial-acceptance.json");
  const imported: Record<string, LivingConflictState> = {
    russia_ukraine_security: security.scenarios.results.find(
      (row: { strategy: string }) => row.strategy === "prolonged"
    ).final,
    transnational_terrorism: security.overlap.results[0].overlapFinal,
    pandemic: pandemic.results.find((row: { strategy: string }) => row.strategy === "inaction")
      .finalState,
    global_financial_crisis: financeState,
    arab_uprisings: arabState,
  };
  const states = MODERN_KEYS.map((key) => {
    const def = livingConflictDef(key)!;
    const prior =
      imported[key] ?? stateRows.find((row) => row.defKey === key) ?? emptyConflictState(key);
    // The dormant Balkan initial state is explicitly opened for this concurrent
    // pressure fixture. No war, damage, ballot, authority or consent is assigned.
    const state = normalizeConflictState(def, {
      ...prior,
      hasOpened: true,
      phaseLevel: Math.max(1, prior.phaseLevel),
      status: prior.status === "dormant" ? "active" : prior.status,
    });
    return { ...state, lastProcessedTurn: 1999, emitPhaseEntryNextTurn: true };
  });
  for (const def of allLivingConflictDefs())
    if (!MODERN_KEYS.includes(def.key))
      states.push({
        ...emptyConflictState(def.key),
        status: "closed",
        lastProcessedTurn: 1999,
        emitPhaseEntryNextTurn: false,
      });
  const failedPrincipal = financial.main.results.failedBank.fundedLoan as number;
  assert(
    failedPrincipal > 0 && financial.main.results.failedBank.failureTurns.at(-1).status === "failed"
  );
  return {
    saved,
    states,
    failedPrincipal,
    provenance: {
      sourceName,
      financeName,
      arabName,
      retainedCollections: saved.map(([name, rows]) => ({ name, count: rows.length })),
      sourceHash: digest(saved),
      regionIds: ids,
      crisisStateHash: digest(states),
      financeReplayCommit: financial.main.replayCommit,
      securityReplayCommit: security.scenarios.sourceCommit,
      pandemicReplayCommit: pandemic.sourceCommit,
    },
    async assertPreserved() {
      for (const entry of reads)
        assert.equal(
          digest(
            await entry.db
              .collection(entry.collection)
              .find(entry.filter)
              .sort({ _id: 1 })
              .toArray()
          ),
          entry.hash,
          `Source changed: ${entry.collection}`
        );
    },
  };
}
