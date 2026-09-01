import { describe, it, expect } from "vitest";
import { cabinetRemapFor, remapCabinetPosition } from "./dissolvingCabinetRemap";
import { DD_CABINET_POSITIONS } from "@/lib/constants/ddCabinet";
import { DE_CABINET_POSITIONS } from "@/lib/constants/deCabinet";

describe("dissolvingCabinetRemap", () => {
  it("maps East Germany's council onto Germany's cabinet", () => {
    expect(remapCabinetPosition("DD", "DE", "minister_of_defence")).toBe("defense_minister");
    expect(remapCabinetPosition("DD", "DE", "minister_of_finance")).toBe("finance_minister");
    expect(remapCabinetPosition("DD", "DE", "minister_of_foreign_affairs")).toBe(
      "foreign_minister"
    );
    expect(remapCabinetPosition("DD", "DE", "minister_of_health")).toBe("health_minister");
    expect(remapCabinetPosition("DD", "DE", "minister_of_higher_education")).toBe(
      "education_minister"
    );
    expect(remapCabinetPosition("DD", "DE", "minister_of_railways")).toBe("transport_minister");
  });

  it("maps the planning chief onto the economy ministry", () => {
    // The same pairing `COMMAND_ECONOMY_OFFICES` uses for a planned Germany.
    expect(remapCabinetPosition("DD", "DE", "chairman_of_gosplan")).toBe("economy_minister");
  });

  it("retires portfolios the Federal Republic does not run", () => {
    expect(remapCabinetPosition("DD", "DE", "minister_of_foreign_trade")).toBeNull();
    expect(remapCabinetPosition("DD", "DE", "minister_of_internal_trade")).toBeNull();
    expect(remapCabinetPosition("DD", "DE", "minister_of_machine_building")).toBeNull();
    expect(remapCabinetPosition("DD", "DE", "first_deputy_premier")).toBeNull();
  });

  it("retires a portfolio the table does not name at all", () => {
    expect(remapCabinetPosition("DD", "DE", "ministry_of_nothing")).toBeNull();
  });

  it("has no table for a pair that does not merge", () => {
    expect(cabinetRemapFor("UK", "IE")).toBeNull();
    expect(remapCabinetPosition("UK", "IE", "defense_minister")).toBeNull();
  });

  it("maps the other direction too, for a settlement the GDR survives", () => {
    expect(remapCabinetPosition("DE", "DD", "defense_minister")).toBe("minister_of_defence");
    expect(remapCabinetPosition("DE", "DD", "finance_minister")).toBe("minister_of_finance");
    expect(remapCabinetPosition("DE", "DD", "economy_minister")).toBe("chairman_of_gosplan");
    // The Council of Ministers has no seat for these.
    expect(remapCabinetPosition("DE", "DD", "justice_minister")).toBeNull();
    expect(remapCabinetPosition("DE", "DD", "labour_minister")).toBeNull();
  });

  it("names only real portfolios in the reverse direction, and never twice", () => {
    const known = new Set(DD_CABINET_POSITIONS.map((p) => p.id));
    const deKnown = new Set(DE_CABINET_POSITIONS.map((p) => p.id));
    const table = cabinetRemapFor("DE", "DD")!;
    for (const key of Object.keys(table)) {
      expect(deKnown, `DE has no portfolio "${key}"`).toContain(key);
    }
    const targets = Object.values(table).filter((v): v is string => v !== null);
    for (const target of targets) {
      expect(known, `DD has no portfolio "${target}"`).toContain(target);
    }
    expect(new Set(targets).size).toBe(targets.length);
  });

  /**
   * The two guards that keep the table honest against the configs it bridges.
   * A portfolio renamed on either side would otherwise silently start retiring
   * every minister who held it.
   */
  it("names only real East German portfolios", () => {
    const known = new Set(DD_CABINET_POSITIONS.map((p) => p.id));
    for (const key of Object.keys(cabinetRemapFor("DD", "DE")!)) {
      expect(known, `DD has no portfolio "${key}"`).toContain(key);
    }
  });

  it("targets only real German portfolios, and never twice", () => {
    const known = new Set(DE_CABINET_POSITIONS.map((p) => p.id));
    const targets = Object.values(cabinetRemapFor("DD", "DE")!).filter(
      (v): v is string => v !== null
    );
    for (const target of targets) {
      expect(known, `DE has no portfolio "${target}"`).toContain(target);
    }
    // Two absorbed ministers landing in one portfolio would have the second
    // silently overwrite the first.
    expect(new Set(targets).size).toBe(targets.length);
  });
});
