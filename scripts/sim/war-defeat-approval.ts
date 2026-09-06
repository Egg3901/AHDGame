import {
  WAR_DEFEAT_PENALTY_CAP,
  resolvedWarDefeatEffect,
} from "../../src/lib/military/rules/warDefeat";
import type { ConflictDoc } from "../../src/lib/db/types/conflict";

const base = {
  _id: "german-question",
  conflictId: 1,
  name: "German Question",
  hostCountry: "DE",
  region: "weu",
  type: "interstate",
  sideA: { label: "West", countries: ["US", "UK"], kind: "coalition" },
  sideB: { label: "East", countries: ["DD"], kind: "coalition" },
  bloc: "contested",
  terrain: "plains",
  severity: "HIGH",
  baseStrength: 1,
  supplyA: 1,
  supplyB: 1,
  terr: 1,
  infra: 1,
  enemyMix: [],
  intensity: 1,
  control: 100,
  status: "resolved",
  createdBy: "player",
  startTurn: 1,
  endTurn: 545,
  outcome: { winner: "B", note: "East wins" },
} as unknown as ConflictDoc;

const endTurn = 545;
const turns = [endTurn, 655, endTurn + 142, endTurn + 143, endTurn + 144];
const outputs = turns.map((turn) => {
  const us = resolvedWarDefeatEffect(base, "US", turn);
  const uk = resolvedWarDefeatEffect(base, "UK", turn);
  const dd = resolvedWarDefeatEffect(base, "DD", turn);
  const total = Math.max(WAR_DEFEAT_PENALTY_CAP, us + uk);
  return { turn, us, uk, dd, aggregate: total };
});

for (const output of outputs) console.log(JSON.stringify(output));
