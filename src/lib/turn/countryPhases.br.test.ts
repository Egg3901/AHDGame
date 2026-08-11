import { describe, it, expect } from "vitest";
import { COUNTRY_ELECTION_PHASES } from "./countryPhases";

describe("COUNTRY_ELECTION_PHASES — BR registration", () => {
  it("registers a BR turn-phase so Câmara races respawn every turn (not only at bootstrap)", () => {
    const br = COUNTRY_ELECTION_PHASES.BR;
    expect(br, "BR must have a turn-phase entry").toBeDefined();
    expect(br?.some((p) => p.name === "brElections")).toBe(true);
  });
});
