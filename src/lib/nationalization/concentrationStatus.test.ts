import { describe, expect, it } from "vitest";
import { concentrationStatus } from "./concentrationStatus";
import { SOCI_DANGER_ZONE } from "./constants";

describe("concentrationStatus", () => {
  it("reports None at zero and flags the danger zone past the knee", () => {
    expect(concentrationStatus(0).tier).toBe("none");
    expect(concentrationStatus(0).inDangerZone).toBe(false);
    expect(concentrationStatus(SOCI_DANGER_ZONE + 1).inDangerZone).toBe(true);
    expect(concentrationStatus(90).tier).toBe("high");
  });

  it("derives the danger-zone flag from SOCI_DANGER_ZONE (single source)", () => {
    expect(concentrationStatus(SOCI_DANGER_ZONE - 0.01).inDangerZone).toBe(false);
    expect(concentrationStatus(SOCI_DANGER_ZONE + 0.01).inDangerZone).toBe(true);
  });
});
