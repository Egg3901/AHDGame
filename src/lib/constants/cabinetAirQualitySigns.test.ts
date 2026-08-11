import { describe, expect, it } from "vitest";
import { US_CABINET_MECHANICS } from "./usCabinetMechanics";
import { UK_CABINET_MECHANICS } from "./ukCabinetMechanics";
import { DE_CABINET_MECHANICS } from "./deCabinetMechanics";
import { CN_CABINET_MECHANICS } from "./cnCabinetMechanics";
import { IE_CABINET_MECHANICS } from "./ieCabinetMechanics";
import { JP_CABINET_MECHANICS } from "./jpCabinetMechanics";
import { RU_CABINET_MECHANICS } from "./ruCabinetMechanics";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";

/**
 * P3c sign guard — airQuality is an AQI (LOWER is better), carbonEmissions is
 * tons/capita (LOWER is better). Any single cabinet effects object that moves
 * BOTH must move them in the SAME direction (a coherent policy cleans or
 * dirties them together). The pre-P3c constants were authored under a
 * higher-is-better airQuality assumption, so green tiers actively WORSENED
 * air — this pins the corrected convention.
 */
function collectEffectObjects(root: unknown, out: Array<Record<string, number>>): void {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const item of root) collectEffectObjects(item, out);
    return;
  }
  const obj = root as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "effects" || key === "sideEffects" || key === "nonTargetEffects") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out.push(value as Record<string, number>);
      }
      if (Array.isArray(value)) {
        // order-style: [{ metric, modifier }] → fold into a single record
        const rec: Record<string, number> = {};
        for (const e of value as Array<{ metric?: string; modifier?: number }>) {
          if (e?.metric && typeof e.modifier === "number") rec[e.metric] = e.modifier;
        }
        out.push(rec);
      }
    } else {
      collectEffectObjects(value, out);
    }
  }
}

function leaf(key: string): string {
  return key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
}

describe("cabinet airQuality/carbonEmissions sign coherence (P3c)", () => {
  const ALL = [
    US_CABINET_MECHANICS,
    UK_CABINET_MECHANICS,
    DE_CABINET_MECHANICS,
    CN_CABINET_MECHANICS,
    IE_CABINET_MECHANICS,
    JP_CABINET_MECHANICS,
    RU_CABINET_MECHANICS,
    DD_CABINET_MECHANICS,
  ];

  it("any effects object moving both airQuality and carbonEmissions moves them together", () => {
    const offenders: string[] = [];
    for (const mechanics of ALL) {
      const objects: Array<Record<string, number>> = [];
      collectEffectObjects(mechanics, objects);
      for (const eff of objects) {
        let air: number | undefined;
        let carbon: number | undefined;
        for (const [k, v] of Object.entries(eff)) {
          if (leaf(k) === "airQuality") air = v;
          if (leaf(k) === "carbonEmissions") carbon = v;
        }
        if (air !== undefined && carbon !== undefined && air !== 0 && carbon !== 0) {
          if (Math.sign(air) !== Math.sign(carbon)) {
            offenders.push(JSON.stringify(eff));
          }
        }
      }
    }
    expect(offenders, `incoherent air/carbon signs:\n${offenders.join("\n")}`).toEqual([]);
  });
});
