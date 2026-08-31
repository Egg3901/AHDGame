/**
 * Full-bloc entry balance report for the live War for Germany.
 *
 * Read only. It compares the current belligerents with the force each modeled
 * NATO and Warsaw Pact member would add through the autonomous 20% commitment
 * rule, plus the deliberately extreme case where every ready reserve formation
 * deploys. Combat uses the production battle module, doctrines, generals, supply,
 * terrain, frontage, and live unit state.
 *
 *   npx tsx scripts/sim/blocEntryBalance2026-08-28.ts
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { planAutonomousDeployment } from "@/lib/nppAutonomy/autonomousWarCommands";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const configuredUri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
if (!configuredUri) throw new Error("MONGODB_URI_LIVE or MONGODB_URI is required");
let uri: string = configuredUri;
if (!/directConnection=/.test(uri)) {
  uri += `${uri.includes("?") ? "&" : "?"}directConnection=true`;
}

const THEATER = "war_us_dd_415";
// Six sweeps total (two directions across three rosters). Eighty fixed seeds are
// enough to distinguish a coin flip from a rout while keeping the live-data report
// inside the repository's short diagnostic budget.
const SAMPLES = 80;
const num = (value: number) => Math.round(value).toLocaleString("en-US");

interface Scenario {
  label: string;
  west: Map<string, MilitaryUnit[]>;
  east: Map<string, MilitaryUnit[]>;
}

function atFront(units: MilitaryUnit[]): MilitaryUnit[] {
  return units.filter((unit) => unit.theaterId === THEATER && unit.personnel > 0);
}

function readyReserve(units: MilitaryUnit[], currentTurn: number): MilitaryUnit[] {
  return units.filter(
    (unit) =>
      unit.theaterId === "reserve" &&
      unit.personnel > 0 &&
      unit.readiness >= 55 &&
      (unit.readyAtTurn == null || unit.readyAtTurn <= currentTurn)
  );
}

function deploy(units: MilitaryUnit[]): MilitaryUnit[] {
  return units.map((unit) => ({ ...unit, theaterId: THEATER, posture: "standard" }));
}

function personnel(side: Map<string, MilitaryUnit[]>): number {
  return [...side.values()].flat().reduce((sum, unit) => sum + unit.personnel, 0);
}

async function buildCoalition(
  db: Db,
  conflict: ConflictDoc,
  roster: Map<string, MilitaryUnit[]>,
  side: "A" | "B"
): Promise<BattleSide[]> {
  const front = { [THEATER]: conflictToFront(conflict) };
  const supply = side === "A" ? conflict.supplyA : conflict.supplyB;
  return Promise.all(
    [...roster.entries()].map(([countryId, units]) =>
      buildBattleSide(db, countryId, units, front, supply, side)
    )
  );
}

async function reportScenario(db: Db, conflict: ConflictDoc, scenario: Scenario): Promise<void> {
  const west = await buildCoalition(db, conflict, scenario.west, "A");
  const east = await buildCoalition(db, conflict, scenario.east, "B");
  let westAttackWins = 0;
  let eastAttackWins = 0;
  let westAttackPower = 0;
  let eastDefensePower = 0;
  let eastAttackPower = 0;
  let westDefensePower = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const seed = sample * 7919 + 13;
    const westAttack = resolvePvpBattle(west, east, THEATER, seed);
    const eastAttack = resolvePvpBattle(east, west, THEATER, seed + 104729);
    if (westAttack.win) westAttackWins++;
    if (eastAttack.win) eastAttackWins++;
    westAttackPower = westAttack.attacker.power;
    eastDefensePower = westAttack.defender.power;
    eastAttackPower = eastAttack.attacker.power;
    westDefensePower = eastAttack.defender.power;
  }

  console.log(`\n### ${scenario.label}`);
  console.log(
    `West: ${[...scenario.west.keys()].join(", ")} | ${num(personnel(scenario.west))} personnel`
  );
  console.log(
    `East: ${[...scenario.east.keys()].join(", ")} | ${num(personnel(scenario.east))} personnel`
  );
  console.log(
    `West attacks: ${((westAttackWins / SAMPLES) * 100).toFixed(1)}% wins | power ${num(westAttackPower)} vs ${num(eastDefensePower)}`
  );
  console.log(
    `East attacks: ${((eastAttackWins / SAMPLES) * 100).toFixed(1)}% wins | power ${num(eastAttackPower)} vs ${num(westDefensePower)}`
  );
}

async function main(): Promise<void> {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as Db;
    const [conflict, gameState, memberships, allUnits] = await Promise.all([
      db.collection<ConflictDoc>("conflicts").findOne({ _id: THEATER }),
      db.collection<{ _id: string; currentTurn?: number }>("gameState").findOne({ _id: "current" }),
      db
        .collection<{ organizationId: string; countryId: string; status: string }>(
          "organizationMemberships"
        )
        .find({
          organizationId: { $in: ["NATO", "WARSAW_PACT"] },
          status: { $in: ["founding", "active"] },
        })
        .toArray(),
      db.collection<MilitaryUnit>("militaryUnits").find({}).toArray(),
    ]);
    if (!conflict) throw new Error(`Conflict ${THEATER} was not found`);
    const currentTurn = gameState?.currentTurn ?? 0;
    const unitsByCountry = new Map<string, MilitaryUnit[]>();
    for (const unit of allUnits) {
      unitsByCountry.set(unit.countryId, [...(unitsByCountry.get(unit.countryId) ?? []), unit]);
    }
    const members = (organizationId: string) =>
      memberships
        .filter((row) => row.organizationId === organizationId)
        .map((row) => row.countryId);

    const roster = (
      sideCountries: string[],
      organizationId: string,
      commitment: "current" | "autonomous" | "all",
      commitmentShare = 0.2,
      priority: "lowest" | "highest" = "lowest"
    ): Map<string, MilitaryUnit[]> => {
      const out = new Map<string, MilitaryUnit[]>();
      for (const countryId of new Set([...sideCountries, ...members(organizationId)])) {
        const units = unitsByCountry.get(countryId) ?? [];
        const present = atFront(units);
        const reserves = readyReserve(units, currentTurn);
        const added =
          commitment === "current"
            ? []
            : commitment === "autonomous"
              ? planAutonomousDeployment(reserves, commitmentShare, priority)
              : reserves;
        const combined = [...present, ...deploy(added)];
        if (combined.length > 0) out.set(countryId, combined);
      }
      return out;
    };

    const scenarios: Scenario[] = [
      {
        label: "Current front",
        west: roster(conflict.sideA.countries, "NATO", "current"),
        east: roster(conflict.sideB.countries, "WARSAW_PACT", "current"),
      },
      {
        label: "All modeled members, symmetric 20% commitment",
        west: roster(conflict.sideA.countries, "NATO", "autonomous"),
        east: roster(conflict.sideB.countries, "WARSAW_PACT", "autonomous"),
      },
      ...[0.3, 0.35, 0.4].map((eastShare) => ({
        label: `All modeled members, NATO 20% and Warsaw Pact ${Math.round(eastShare * 100)}% strongest-first`,
        west: roster(conflict.sideA.countries, "NATO", "autonomous", 0.2),
        east: roster(conflict.sideB.countries, "WARSAW_PACT", "autonomous", eastShare, "highest"),
      })),
      {
        label: "Upper bound, every ready reserve formation",
        west: roster(conflict.sideA.countries, "NATO", "all"),
        east: roster(conflict.sideB.countries, "WARSAW_PACT", "all"),
      },
    ];

    console.log("FULL BLOC ENTRY BALANCE REPORT");
    console.log(
      `Turn ${currentTurn}, control ${conflict.control.toFixed(2)}, supply A ${conflict.supplyA}, supply B ${conflict.supplyB}`
    );
    for (const scenario of scenarios) await reportScenario(db, conflict, scenario);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
