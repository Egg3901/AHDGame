/**
 * Unit tests for the shared office-action-bonus resolver.
 *
 * The resolver decides a character's per-turn office AP bonus. Cabinet bonuses
 * STACK on the underlying legislative seat (mirroring the central-bank chair
 * bonus), and the seat is recovered from electedOfficials because cabinet
 * appointment overwrites `currentOffice` with a cabinet office key.
 */
import { describe, it, expect } from "vitest";
import {
  CABINET_OFFICE_TYPES,
  cabinetOfficeTypeForCountry,
  resolveOfficeActionBonus,
  resolveOfficeActionBonusBreakdown,
} from "./officeActionBonus";

const OAB = {
  bundestag: 1,
  commons: 1,
  ministerPresident: 2,
  governor: 2,
  parliamentaryCabinet: 1,
  ukCabinet: 1,
  usCabinet: 1,
};

describe("cabinetOfficeTypeForCountry", () => {
  it("maps US to usCabinet, UK to ukCabinet, others to parliamentaryCabinet", () => {
    expect(cabinetOfficeTypeForCountry("US")).toBe("usCabinet");
    expect(cabinetOfficeTypeForCountry("UK")).toBe("ukCabinet");
    expect(cabinetOfficeTypeForCountry("DE")).toBe("parliamentaryCabinet");
    expect(cabinetOfficeTypeForCountry("JP")).toBe("parliamentaryCabinet");
    expect(cabinetOfficeTypeForCountry("IE")).toBe("parliamentaryCabinet");
  });
});

describe("CABINET_OFFICE_TYPES", () => {
  it("contains the three cabinet office keys", () => {
    expect(CABINET_OFFICE_TYPES.has("parliamentaryCabinet")).toBe(true);
    expect(CABINET_OFFICE_TYPES.has("ukCabinet")).toBe(true);
    expect(CABINET_OFFICE_TYPES.has("usCabinet")).toBe(true);
    expect(CABINET_OFFICE_TYPES.has("bundestag")).toBe(false);
  });
});

describe("resolveOfficeActionBonus", () => {
  it("returns the plain office bonus for a non-cabinet office holder", () => {
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "bundestag",
        electedSeatOfficeType: "bundestag",
        isCabinetMember: false,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: OAB,
      })
    ).toBe(1);
  });

  it("stacks cabinet bonus on the legislative seat when currentOffice was overwritten to the cabinet key", () => {
    // DE minister: currentOffice overwritten to parliamentaryCabinet, still holds a bundestag seat.
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "parliamentaryCabinet",
        electedSeatOfficeType: "bundestag",
        isCabinetMember: true,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: OAB,
      })
    ).toBe(2); // seat 1 + cabinet 1
  });

  it("stacks cabinet bonus on a non-cabinet currentOffice (cabinet member whose currentOffice stayed a real office)", () => {
    // Lukas Streibl case: cabinet member whose currentOffice is ministerPresident.
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "ministerPresident",
        electedSeatOfficeType: "ministerPresident",
        isCabinetMember: true,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: OAB,
      })
    ).toBe(3); // seat 2 + cabinet 1
  });

  it("gives only the cabinet bonus for a US cabinet member with no legislative seat", () => {
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "usCabinet",
        electedSeatOfficeType: undefined,
        isCabinetMember: true,
        cabinetOfficeType: "usCabinet",
        officeActionBonus: OAB,
      })
    ).toBe(1); // seat 0 + cabinet 1
  });

  it("does not double-count: the overwritten cabinet key is never added as both seat and cabinet", () => {
    // UK minister: currentOffice=ukCabinet, seat=commons.
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "ukCabinet",
        electedSeatOfficeType: "commons",
        isCabinetMember: true,
        cabinetOfficeType: "ukCabinet",
        officeActionBonus: OAB,
      })
    ).toBe(2); // commons 1 + ukCabinet 1, NOT ukCabinet twice
  });

  it("falls back to 0 gracefully when config is missing the cabinet key (pre-heal live config)", () => {
    const noCabinetKeys = { bundestag: 1 };
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "parliamentaryCabinet",
        electedSeatOfficeType: "bundestag",
        isCabinetMember: true,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: noCabinetKeys,
      })
    ).toBe(1); // seat 1 + cabinet 0 (missing key) — at minimum the seat is restored
  });

  it("returns 0 when the character holds no office", () => {
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: undefined,
        electedSeatOfficeType: undefined,
        isCabinetMember: false,
        cabinetOfficeType: undefined,
        officeActionBonus: OAB,
      })
    ).toBe(0);
  });

  it("returns 0 when a cabinet-key currentOffice has no recoverable seat and is not flagged a cabinet member", () => {
    // Defensive: currentOffice is a cabinet key but cabinetMembers lookup found nothing.
    expect(
      resolveOfficeActionBonus({
        currentOfficeType: "parliamentaryCabinet",
        electedSeatOfficeType: undefined,
        isCabinetMember: false,
        cabinetOfficeType: undefined,
        officeActionBonus: OAB,
      })
    ).toBe(0);
  });
});

describe("resolveOfficeActionBonusBreakdown", () => {
  it("splits seat and cabinet for an overwritten cabinet office, exposing the recovered seat type", () => {
    expect(
      resolveOfficeActionBonusBreakdown({
        currentOfficeType: "parliamentaryCabinet",
        electedSeatOfficeType: "bundestag",
        isCabinetMember: true,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: OAB,
      })
    ).toEqual({ seatType: "bundestag", seatBonus: 1, cabinetBonus: 1 });
  });

  it("reports a real (non-cabinet) office as the seat with zero cabinet bonus", () => {
    expect(
      resolveOfficeActionBonusBreakdown({
        currentOfficeType: "bundestag",
        electedSeatOfficeType: "bundestag",
        isCabinetMember: false,
        cabinetOfficeType: "parliamentaryCabinet",
        officeActionBonus: OAB,
      })
    ).toEqual({ seatType: "bundestag", seatBonus: 1, cabinetBonus: 0 });
  });

  it("reports no seat for a US cabinet member with only the cabinet bonus", () => {
    expect(
      resolveOfficeActionBonusBreakdown({
        currentOfficeType: "usCabinet",
        electedSeatOfficeType: undefined,
        isCabinetMember: true,
        cabinetOfficeType: "usCabinet",
        officeActionBonus: OAB,
      })
    ).toEqual({ seatType: undefined, seatBonus: 0, cabinetBonus: 1 });
  });

  it("sums to resolveOfficeActionBonus", () => {
    const args = {
      currentOfficeType: "parliamentaryCabinet",
      electedSeatOfficeType: "bundestag",
      isCabinetMember: true,
      cabinetOfficeType: "parliamentaryCabinet",
      officeActionBonus: OAB,
    } as const;
    const b = resolveOfficeActionBonusBreakdown(args);
    expect(b.seatBonus + b.cabinetBonus).toBe(resolveOfficeActionBonus(args));
  });
});
