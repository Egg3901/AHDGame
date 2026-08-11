import { describe, it, expect } from "vitest";
import { TARGETS } from "./targets";
import { evaluateCell } from "./evaluate";
import { isExcluded } from "./types";
import type { EraId } from "@/lib/seeds/presetSelector";

// Hard by default since 0.4.0 — all 35 country-era cells calibrate to loss 0.
// Set CALIBRATION_HARD=0 only as a temporary local escape hatch while iterating
// on position data; CI must always run hard.
const HARD = process.env.CALIBRATION_HARD !== "0";

describe("demographic calibration", () => {
  for (const [country, eras] of Object.entries(TARGETS)) {
    for (const era of Object.keys(eras ?? {}) as EraId[]) {
      const name = `${country} ${era}`;
      it(name, () => {
        expect(isExcluded(country, era)).toBe(false);
        const r = evaluateCell(country, era)!;
        if (HARD) {
          expect(r.failures, r.failures.join("\n")).toEqual([]);
        } else if (r.failures.length) {
          console.warn(
            `[calibration pending] ${name} loss=${r.loss}\n  ` + r.failures.join("\n  ")
          );
        }
      });
    }
  }
});
