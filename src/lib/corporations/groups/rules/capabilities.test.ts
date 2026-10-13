import { describe, it, expect } from "vitest";
import { groupCapabilities } from "./capabilities";
describe("independent Group capabilities", () => {
  it("runs strategic directions without activating the separate supply engine", () => {
    expect(
      groupCapabilities({
        subsidiariesEnabled: true,
        marketSystemMode: "plants",
        groupSupplyCoordinationEnabled: false,
      })
    ).toEqual({ directionsEnabled: true, supplyEngineEnabled: false, internalSupplyEnabled: true });
  });
  it("preserves exclusive supply routing and its world/market gates", () => {
    for (const subsidiariesEnabled of [false, true])
      for (const marketSystemMode of ["off", "capital", "plants"])
        for (const groupSupplyCoordinationEnabled of [false, true]) {
          const c = groupCapabilities({
            subsidiariesEnabled,
            marketSystemMode,
            groupSupplyCoordinationEnabled,
          });
          expect(c.directionsEnabled).toBe(subsidiariesEnabled);
          expect(c.supplyEngineEnabled).toBe(
            subsidiariesEnabled && marketSystemMode === "plants" && groupSupplyCoordinationEnabled
          );
          expect(c.internalSupplyEnabled).toBe(
            marketSystemMode === "plants" && !c.supplyEngineEnabled
          );
        }
  });
});
