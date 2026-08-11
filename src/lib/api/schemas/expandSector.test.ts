import { describe, expect, it } from "vitest";
import { expandSectorSchema } from "./corporations";

/**
 * `stateId` is validated for SHAPE only. The authoritative check lives in
 * `expandSector`, which resolves the id against the `states` collection scoped
 * to the corporation's own country — strictly stronger than any id allowlist
 * this layer could hold, and the only check that works outside the US.
 *
 * Regression guard: this field used to be refined against `STATE_IDS` (the 50
 * US `HOUSE_SEATS` keys), which rejected every non-US region id before the
 * route ran and left every non-US corporation unable to open or split a
 * sector at all.
 */
describe("expandSectorSchema", () => {
  it("accepts a US state id", () => {
    const r = expandSectorSchema.safeParse({ stateId: "NY", sectorType: "retail" });
    expect(r.success).toBe(true);
  });

  it.each([
    ["UK", "SEE"],
    ["UK", "LON"],
    ["UK", "SCO"],
    ["RU", "CEN"],
  ])("accepts a %s region id (%s)", (_country, stateId) => {
    const r = expandSectorSchema.safeParse({ stateId, sectorType: "retail" });
    expect(r.success).toBe(true);
  });

  /**
   * The longest region id currently seeded (13 chars). A length cap of 12 was
   * briefly shipped alongside this fix and silently excluded it — region ids
   * are not two-letter codes outside the US, so the bound has to be measured
   * against the seeds rather than guessed. See `MAX_REGION_ID_LENGTH`.
   */
  it("accepts the longest seeded region id (NG NORTH_CENTRAL, 13 chars)", () => {
    const r = expandSectorSchema.safeParse({ stateId: "NORTH_CENTRAL", sectorType: "retail" });
    expect(r.success).toBe(true);
  });

  it("still rejects an implausibly long id", () => {
    const r = expandSectorSchema.safeParse({ stateId: "THIS_IS_TOO_LONG", sectorType: "retail" });
    expect(r.success).toBe(false);
  });

  it("accepts a region id without a sectorType (pre-plants callers)", () => {
    const r = expandSectorSchema.safeParse({ stateId: "SEE" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty state id", () => {
    const r = expandSectorSchema.safeParse({ stateId: "", sectorType: "retail" });
    expect(r.success).toBe(false);
  });

  it("rejects a missing state id", () => {
    const r = expandSectorSchema.safeParse({ sectorType: "retail" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown sector type", () => {
    const r = expandSectorSchema.safeParse({ stateId: "SEE", sectorType: "nonsense" });
    expect(r.success).toBe(false);
  });
});
