/** Edge-case probe against the REAL modules, not a copy of their logic. */
import { repairedIntegrity, freeRepairCeiling } from "@/lib/navair/repair";
import { wornPenalty } from "@/lib/navair/blockade";
import { lotsToRepair } from "@/lib/military/arsenal";
import type { BasingKey } from "@/lib/navair/config";
import type { NavairUnit } from "@/lib/navair/types";

const u = (o: Record<string, unknown>) => ({ domain: "naval", ...o }) as unknown as NavairUnit;
let bad = 0;
const fail = (m: string, d: unknown) => {
  console.log("VIOLATION", m, JSON.stringify(d));
  bad++;
};

for (const cur of [0, 0.1, 50, 79.9, 80, 99.9, 100])
  for (const b of ["home", "allied", "neutral", "hostile"] as BasingKey[])
    for (const mission of ["PORT", "STANDDOWN", "BLOCKADE", "SEA_CONTROL", null])
      for (const supply of [undefined, 0, 35, 35.1, 99, 100])
        for (const engaged of [true, false]) {
          const v = repairedIntegrity(u({ integrity: cur, supply, mission, engaged }), b);
          if (v < cur - 1e-9) fail("decreased", { cur, b, mission, supply, engaged, v });
          if (v > 100 + 1e-9) fail("over 100", { cur, b, mission, supply, engaged, v });
          if (!Number.isFinite(v)) fail("non-finite", { cur, b, mission, supply, engaged, v });
          if (
            v > freeRepairCeiling(b, mission === "PORT" || mission === "STANDDOWN") + 1e-9 &&
            v > cur
          )
            fail("past ceiling", { cur, b, mission, supply, v });
        }

for (const i of [-10, 0, 0.1, 25, 49.9, 50, 100, 120, undefined, Number.NaN, Infinity]) {
  const v = wornPenalty(i);
  if (!Number.isFinite(v) || v < 0 || v > 1) fail("wornPenalty out of range", { i, v });
}

for (const i of [0, 1, 50, 99, 100, undefined])
  for (const full of [0, 1, 5, 20, 100]) {
    const v = lotsToRepair({ integrity: i }, full);
    if (v < 0 || !Number.isInteger(v)) fail("lotsToRepair", { i, full, v });
  }

console.log(bad === 0 ? "CLEAN: no violations across all probes" : `${bad} VIOLATIONS`);
