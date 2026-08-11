import { describe, expect, it } from "vitest";
import { CN_CABINET_POSITIONS } from "./cnCabinet";
import {
  getAllCabinetMechanics,
  getCabinetPositions,
  type CabinetPositionDef,
} from "./cabinetMechanics";
import { getMinisterialOrders } from "./cabinetOrders";
import {
  getCabinetEligibleOfficeTypes,
  getOfficeTypeForChamber,
  getLowerChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { COUNTRY_CONFIGS, getCabinetEligibleChamberKeys } from "./countries";

describe("CN cabinet constants", () => {
  it("has 16 State Council positions registered", () => {
    expect(CN_CABINET_POSITIONS).toHaveLength(16);
    const ids = CN_CABINET_POSITIONS.map((p: { id: string }) => p.id);
    expect(ids).toEqual([
      "premier",
      "vice_premier",
      "state_councillor",
      "minister_of_foreign_affairs",
      "minister_of_finance",
      "minister_of_defense",
      "minister_of_education",
      "minister_of_health",
      "pboc_governor",
      "minister_of_public_security",
      "minister_of_commerce",
      "minister_of_human_resources_social_security",
      "minister_of_ecology_environment",
      "minister_of_transport",
      "minister_of_agriculture_rural_affairs",
      "minister_of_housing_urban_rural",
    ]);
  });

  it("position names are non-empty", () => {
    for (const pos of CN_CABINET_POSITIONS) {
      expect(pos.name).toBeTruthy();
    }
  });

  it("positions are ordered by order field", () => {
    for (let i = 0; i < CN_CABINET_POSITIONS.length - 1; i++) {
      expect(CN_CABINET_POSITIONS[i]!.order).toBeLessThanOrEqual(
        CN_CABINET_POSITIONS[i + 1]!.order
      );
    }
  });
});

describe("head-of-government cabinet position", () => {
  it("flags CN premier as the head-of-government seat", () => {
    const premier = getCabinetPositions("CN").find((p: CabinetPositionDef) => p.id === "premier");
    expect(premier?.isHeadOfGovernment).toBe(true);
  });

  it("flags IE taoiseach as the head-of-government seat", () => {
    const taoiseach = getCabinetPositions("IE").find(
      (p: CabinetPositionDef) => p.id === "taoiseach"
    );
    expect(taoiseach?.isHeadOfGovernment).toBe(true);
  });

  it("does not flag ordinary ministers as head-of-government", () => {
    const vicePremier = getCabinetPositions("CN").find(
      (p: CabinetPositionDef) => p.id === "vice_premier"
    );
    expect(vicePremier?.isHeadOfGovernment).toBeFalsy();
  });
});

describe("CN cabinet mechanics registry", () => {
  it("registers mechanics for every CN position", () => {
    const mechanics = getAllCabinetMechanics("CN");
    for (const pos of CN_CABINET_POSITIONS) {
      expect(mechanics[pos.id]).toBeDefined();
      expect(mechanics[pos.id]!.positionId).toBe(pos.id);
    }
  });

  it("registers position objects for every CN position", () => {
    const positions = getCabinetPositions("CN");
    for (const pos of CN_CABINET_POSITIONS) {
      const registered = positions.find((p: { id: string }) => p.id === pos.id);
      expect(registered).toBeDefined();
      expect(registered!.name).toBe(pos.name);
    }
  });
});

describe("CN ministerial orders registry", () => {
  it("registers two orders per position", () => {
    for (const pos of CN_CABINET_POSITIONS) {
      const orders = getMinisterialOrders("CN", pos.id);
      expect(orders).toHaveLength(2);
      for (const order of orders) {
        expect(order.id).toBeTruthy();
        expect(order.name).toBeTruthy();
        expect(order.duration).toBeGreaterThan(0);
      }
    }
  });
});

describe("CN cabinet eligibility via chamberOfficeType", () => {
  it("maps npc chamber key to npcDelegate office type", () => {
    expect(getOfficeTypeForChamber("CN", "npc")).toBe("npcDelegate");
  });

  it("getCabinetEligibleOfficeTypes returns only npcDelegate for CN", () => {
    const types = getCabinetEligibleOfficeTypes("CN");
    expect(types).toEqual(["npcDelegate"]);
  });

  it("cabinetEligibleChamberKeys resolves to [npc] via lower-chamber default", () => {
    expect(getCabinetEligibleChamberKeys(COUNTRY_CONFIGS.CN)).toEqual(["npc"]);
  });

  it("lower chamber office type resolves to npcDelegate", () => {
    expect(getLowerChamberOfficeType("CN")).toBe("npcDelegate");
  });
});
