import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { ngElectionsLive } from "./perpetualElections";

/**
 * NG election spawning is gated on the RUNTIME status (countryGameStates.status),
 * resolved via getCountryAccessFromDb — the same two-tier source the admin panel
 * and country layout use — NOT the static config. "beta" and "active" are live;
 * "coming-soon" is not. A missing countryGameStates doc falls back to the config
 * status ("coming-soon" for NG), so an un-toggled NG stays gated off.
 */
describe("ngElectionsLive", () => {
  it("is live when the runtime status is beta", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "NG", status: "beta" });
    expect(await ngElectionsLive(db as unknown as Db)).toBe(true);
  });

  it("is live when the runtime status is active", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "NG", status: "active" });
    expect(await ngElectionsLive(db as unknown as Db)).toBe(true);
  });

  it("is NOT live when the runtime status is coming-soon", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "NG",
      status: "coming-soon",
    });
    expect(await ngElectionsLive(db as unknown as Db)).toBe(false);
  });

  it("falls back to the config status (coming-soon → not live) when no runtime doc exists", async () => {
    const db = createMockDb();
    // countryGameStates.findOne defaults to null in the mock → config fallback.
    expect(await ngElectionsLive(db as unknown as Db)).toBe(false);
  });

  it("is NOT live for an unexpected status (allow-list, not !== coming-soon)", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "NG",
      status: "disabled",
    });
    expect(await ngElectionsLive(db as unknown as Db)).toBe(false);
  });
});
