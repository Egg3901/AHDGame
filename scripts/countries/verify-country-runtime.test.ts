import { describe, expect, it } from "vitest";
import { CONVERTED } from "@/lib/countries/singleCountryData";
import { verify } from "./verify-country-runtime";

/**
 * Runs the country-folder forwarding harness inside the test suite.
 *
 * ⚠️ WHY THIS WRAPPER EXISTS. The harness is the ONLY thing that proves each
 * country's folder and its registries are the same object rather than two
 * copies that happen to be equal -- 82 registries, checked by reference for all
 * 29 countries. It was a CLI script, so it was enforced by nobody: typecheck,
 * lint and every other test stay green if a registry quietly stops forwarding
 * and starts holding a literal again, which is the exact regression the whole
 * country-folder conversion exists to prevent.
 *
 * It has to live in `test:run` specifically. CI runs lint, architecture:audit,
 * format:check, tsc, test:run and verify:build as separate jobs and never runs
 * `npm run verify`, so adding it to that aggregator would not have reached CI.
 *
 * The harness prints its own FAIL lines; vitest surfaces them with the failure,
 * which is more useful than any message this file could assemble.
 */
describe("country folders forward to their registries", () => {
  it.each([...CONVERTED])(
    "%s: every registry resolves, forwards and matches",
    async (cc) => {
      expect(await verify(cc)).toBe(true);
    },
    120_000
  );

  /**
   * Guards the guard. `CONVERTED` is what the harness iterates, so an empty or
   * truncated roster would let every assertion above pass while checking
   * nothing.
   */
  it("checks every converted country", () => {
    expect([...CONVERTED].length).toBeGreaterThanOrEqual(29);
  });
});
