import { describe, expect, it } from "vitest";
import {
  applyRussianAssemblyOwnerEligibility as apply,
  type RussianAssemblyOwnerStatus,
  russianFirstAssemblyTermEndTurn,
  russianFirstAssemblyOfficeCompatible,
} from "./assemblyOwnerEligibility";
import type { RussianAssemblySeat } from "./assemblySeating";
const seat: RussianAssemblySeat = {
  candidateId: "winner",
  ownerId: "owner",
  isNpc: true,
  name: "Winner",
  party: "1",
  officeType: "dumaDeputy",
  state: "RU",
  seatId: "list",
  electionId: "poll",
  seatsHeld: 226,
  seatSource: "list",
};
const owner: RussianAssemblyOwnerStatus = {
  ownerId: "owner",
  isNpc: true,
  countryId: "RU",
  pendingRelocation: false,
  retired: false,
  isTechnocrat: false,
  incompatibleOffice: false,
};
describe("Assembly owner eligibility", () => {
  it.each([
    ["missing-owner", undefined],
    ["nonresident-owner", { countryId: "CS" }],
    ["pending-relocation", { pendingRelocation: true }],
    ["retired-owner", { retired: true }],
    ["technocrat-owner", { isTechnocrat: true }],
    ["incompatible-office", { incompatibleOffice: true }],
  ] as const)("records %s as a vacancy without transferring its mandate", (reason, defect) => {
    const result = apply([seat], defect ? [{ ...owner, ...defect }] : []);
    expect(result.seats).toEqual([]);
    expect(result.vacancies).toEqual([{ ...seat, reason }]);
    expect(result).toMatchObject({
      dumaVacancies: 450,
      councilVacancies: 178,
      canReplaceCongress: false,
    });
  });
  it("keeps identities of human and NPC owners separate", () => {
    expect(apply([seat], [{ ...owner, isNpc: false }]).vacancies[0].reason).toBe("missing-owner");
  });
  it("rejects ambiguous duplicate owner facts", () => {
    expect(() => apply([seat], [owner, owner])).toThrow("unique owner");
  });
  it("allows viable chambers with lawful vacancies and fixed constitutional majorities", () => {
    const council = {
      ...seat,
      candidateId: "council-winner",
      ownerId: "council-owner",
      officeType: "federationCouncilMember" as const,
      seatsHeld: 90,
    };
    const statuses = [owner, { ...owner, ownerId: "council-owner" }];
    const before = structuredClone({ seats: [seat, council], statuses });
    expect(apply([seat, council], statuses)).toMatchObject({
      dumaSeats: 226,
      councilSeats: 90,
      dumaVacancies: 224,
      councilVacancies: 88,
      canReplaceCongress: true,
    });
    expect(apply([{ ...seat, seatsHeld: 225 }, council], statuses).canReplaceCongress).toBe(false);
    expect(apply([seat, { ...council, seatsHeld: 89 }], statuses).canReplaceCongress).toBe(false);
    expect({ seats: [seat, council], statuses }).toEqual(before);
  });
});

describe("First Assembly term clock", () => {
  it("uses original poll dates rather than a delayed handover or repeat poll", () => {
    expect(russianFirstAssemblyTermEndTurn([141, 141], 48)).toBe(237);
    expect(russianFirstAssemblyTermEndTurn([149, 151], 48)).toBe(247);
  });
  it.each([[], [0], [Infinity], [1.5], [Number.MAX_SAFE_INTEGER]].map((turns) => ({ turns })))(
    "rejects unsafe original dates %j",
    ({ turns }) => {
      expect(() => russianFirstAssemblyTermEndTurn(turns, 48)).toThrow();
    }
  );
});

describe("First Assembly Government compatibility", () => {
  it.each(["primeMinister", "parliamentaryCabinet"])(
    "permits first-Duma %s without allowing dual chamber membership",
    (office) => {
      expect(russianFirstAssemblyOfficeCompatible("dumaDeputy", office, "RU")).toBe(true);
      expect(russianFirstAssemblyOfficeCompatible("federationCouncilMember", office, "RU")).toBe(
        false
      );
      expect(russianFirstAssemblyOfficeCompatible("dumaDeputy", office, "UK")).toBe(false);
    }
  );
  it.each(["president", "vicePresident", "governor", "federationCouncilMember"])(
    "keeps %s incompatible",
    (office) => {
      expect(russianFirstAssemblyOfficeCompatible("dumaDeputy", office, "RU")).toBe(false);
    }
  );
});
