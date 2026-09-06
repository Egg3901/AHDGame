/**
 * Issue #1470: command-shortage physical-gap stress and recovery.
 *
 * This is a deterministic rules-level check. It uses the same pure kernels
 * that the turn phase calls and a basis-explicit country ledger observation.
 * The stress lasts 48 turns, then the observation disappears for 48 turns to
 * verify recovery and the absence of a stale diagnostic. RU and DD are command
 * economies; US is the non-command control and is never processed.
 *
 * Run with: npx tsx scripts/sim/commandShortageStressRecovery.ts
 */

import {
  accumulateOverhang,
  countryPhysicalDemandSupplyGapPct,
  shortageIndexFrom,
} from "@/lib/economy/commandEconomyState";

const STRESS_TURNS = 48;
const RECOVERY_TURNS = 48;
const COUNTRIES = ["RU", "DD", "US"] as const;

type Country = (typeof COUNTRIES)[number];

type Snapshot = {
  country: Country;
  turn: number;
  shortageIndex: number | null;
  physicalGapPct: number | null;
};

const stressedLedgerRows = [
  {
    basis: "country_scoped_ledger" as const,
    supply: 1_000,
    demand: 1_600,
    price: 1,
  },
];

function runCountry(country: Country): Snapshot[] {
  const command = country === "RU" || country === "DD";
  let overhang = 0;
  const snapshots: Snapshot[] = [];

  for (let turn = 1; turn <= STRESS_TURNS + RECOVERY_TURNS; turn += 1) {
    const observedGap =
      command && turn <= STRESS_TURNS
        ? countryPhysicalDemandSupplyGapPct(stressedLedgerRows)
        : null;

    if (!command) {
      snapshots.push({ country, turn, shortageIndex: null, physicalGapPct: null });
      continue;
    }

    // Equal nominal and real growth, no credit issuance, and no second economy
    // relief isolate the physical ledger signal from the other live drivers.
    overhang = accumulateOverhang(overhang, 0, 0, 1, 0, 0, 1);
    snapshots.push({
      country,
      turn,
      shortageIndex: shortageIndexFrom(overhang, observedGap ?? 0),
      physicalGapPct: observedGap,
    });
  }
  return snapshots;
}

function endpoint(rows: Snapshot[], turn: number): Snapshot {
  return rows.find((row) => row.turn === turn)!;
}

const results = new Map(COUNTRIES.map((country) => [country, runCountry(country)]));

for (const country of COUNTRIES) {
  const rows = results.get(country)!;
  const stress = endpoint(rows, STRESS_TURNS);
  const recovery = endpoint(rows, STRESS_TURNS + RECOVERY_TURNS);
  console.log(
    `${country} turn ${STRESS_TURNS}: gap=${stress.physicalGapPct?.toFixed(2) ?? "null"}% shortage=${stress.shortageIndex?.toFixed(2) ?? "null"}`
  );
  console.log(
    `${country} turn ${STRESS_TURNS + RECOVERY_TURNS}: gap=${recovery.physicalGapPct?.toFixed(2) ?? "null"}% shortage=${recovery.shortageIndex?.toFixed(2) ?? "null"}`
  );
  if (country !== "US" && !(stress.shortageIndex! > recovery.shortageIndex!)) {
    throw new Error(`${country} did not recover after the ledger observation disappeared`);
  }
  if (country === "US" && (stress.shortageIndex !== null || recovery.shortageIndex !== null)) {
    throw new Error("US control unexpectedly entered the command shortage path");
  }
}
