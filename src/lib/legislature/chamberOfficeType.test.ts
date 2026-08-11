import { describe, it, expect } from "vitest";
import {
  getOfficeTypeForChamber,
  getChamberKeyForOfficeType,
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
  getCabinetEligibleOfficeTypes,
} from "./chamberOfficeType";

describe("chamberOfficeType helpers", () => {
  describe("getOfficeTypeForChamber", () => {
    it("returns the office type key when a chamberKey mapping exists", () => {
      expect(getOfficeTypeForChamber("CN", "npc")).toBe("npcDelegate");
    });

    it("falls back to the chamber key when no mapping exists", () => {
      expect(getOfficeTypeForChamber("US", "house")).toBe("house");
      expect(getOfficeTypeForChamber("US", "senate")).toBe("senate");
    });
  });

  describe("getChamberKeyForOfficeType", () => {
    it("maps CN office type 'npcDelegate' back to chamber key 'npc' (Bug #0734)", () => {
      expect(getChamberKeyForOfficeType("CN", "npcDelegate")).toBe("npc");
    });

    it("is the inverse of getOfficeTypeForChamber for CN", () => {
      const officeType = getOfficeTypeForChamber("CN", "npc");
      expect(getChamberKeyForOfficeType("CN", officeType)).toBe("npc");
    });

    it("is the identity for countries where office key equals chamber key", () => {
      expect(getChamberKeyForOfficeType("US", "house")).toBe("house");
      expect(getChamberKeyForOfficeType("US", "senate")).toBe("senate");
      expect(getChamberKeyForOfficeType("UK", "commons")).toBe("commons");
      expect(getChamberKeyForOfficeType("JP", "shugiin")).toBe("shugiin");
      expect(getChamberKeyForOfficeType("JP", "sangiin")).toBe("sangiin");
    });

    it("falls back to the office type when it is not a recognized office key", () => {
      expect(getChamberKeyForOfficeType("CN", "unknown")).toBe("unknown");
    });
  });

  describe("getLowerChamberOfficeType", () => {
    it("US → house", () => {
      expect(getLowerChamberOfficeType("US")).toBe("house");
    });

    it("UK → commons", () => {
      expect(getLowerChamberOfficeType("UK")).toBe("commons");
    });

    it("DE → bundestag", () => {
      expect(getLowerChamberOfficeType("DE")).toBe("bundestag");
    });

    it("CN → npcDelegate", () => {
      expect(getLowerChamberOfficeType("CN")).toBe("npcDelegate");
    });

    it("JP → shugiin", () => {
      expect(getLowerChamberOfficeType("JP")).toBe("shugiin");
    });

    it("BR → chamber", () => {
      expect(getLowerChamberOfficeType("BR")).toBe("chamber");
    });
  });

  describe("getUpperChamberOfficeType", () => {
    it("US → senate", () => {
      expect(getUpperChamberOfficeType("US")).toBe("senate");
    });

    it("UK → undefined (Lords are appointed, no elected office type)", () => {
      expect(getUpperChamberOfficeType("UK")).toBeUndefined();
    });

    it("CN → undefined (no elected upper-chamber office type)", () => {
      expect(getUpperChamberOfficeType("CN")).toBeUndefined();
    });
  });

  describe("getCabinetEligibleOfficeTypes", () => {
    it("US returns house and senate", () => {
      expect(getCabinetEligibleOfficeTypes("US")).toEqual(["house", "senate"]);
    });

    it("UK returns commons only (lords are appointed, no elected office type)", () => {
      expect(getCabinetEligibleOfficeTypes("UK")).toEqual(["commons"]);
    });

    it("CN returns npcDelegate only", () => {
      expect(getCabinetEligibleOfficeTypes("CN")).toEqual(["npcDelegate"]);
    });
  });
});
