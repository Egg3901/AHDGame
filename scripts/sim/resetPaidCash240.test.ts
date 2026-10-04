import { describe, expect, it } from "vitest";
import { runPaidCash240 } from "./resetPaidCash240";

describe("paid sovereign and departmental 240-turn stress", () => {
  for (const country of ["US", "UK", "JP"] as const) {
    for (const scenario of ["unchanged", "shock", "no_issuance"] as const) {
      it(`${country} ${scenario} reconciles and never pays fictional authority`, () => {
        const result = runPaidCash240(country, scenario);
        expect(result.turns).toBe(240);
        expect(result.maximumResidual).toBe(0);
        expect(result.openingDepartmentCash + result.paidAuthority).toBeGreaterThanOrEqual(
          result.departmentalOutlay
        );
        expect(result.unpaidAuthority).toBe(0);
        expect(result.emergencyAdvance).toBeGreaterThanOrEqual(0);
        expect(result.lowestPaidRatio).toBe(1);
      });
    }
  }
});
