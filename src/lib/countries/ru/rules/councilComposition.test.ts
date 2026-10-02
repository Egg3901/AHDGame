import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import {
  planRussianCouncilComposition as plan,
  russianCouncilCompositionAvailable as available,
  passesRussianCouncilFormationLaw as passes,
  russianRegionalCouncilOfficeCompatible as officeCompatible,
  type RussianCouncilRegionalAuthority,
} from "./councilComposition";
describe("regional Council office compatibility", () => {
  it("allows a human regional head's ex-officio role but excludes national and foreign offices", () => {
    expect(officeCompatible({ officeType: "governor", countryId: "RU", isNpc: false })).toBe(true);
    expect(officeCompatible({ officeType: "governor", countryId: "RU", isNpc: true })).toBe(false);
    expect(
      officeCompatible({ officeType: "federationCouncilMember", countryId: "RU", isNpc: true })
    ).toBe(true);
    expect(officeCompatible({ officeType: "dumaDeputy", countryId: "RU", isNpc: false })).toBe(
      false
    );
    expect(officeCompatible({ officeType: "primeMinister", countryId: "RU", isNpc: true })).toBe(
      false
    );
    expect(officeCompatible({ officeType: "governor", countryId: "US", isNpc: false })).toBe(false);
  });
});
function authorities(): RussianCouncilRegionalAuthority[] {
  return RUSSIAN_COUNCIL_SUBJECTS_1993.flatMap(([id, , regionId]) =>
    (["executive", "legislative"] as const).map((branch) => ({
      subjectId: `RU-council-${id}`,
      regionId,
      branch,
      revision: 1,
      sinceTurn: 235,
      termEndTurn: 427,
      head: {
        personId: `head:${id}:${branch}`,
        ownerId: "profile:regional",
        isNpc: true,
        name: `Regional head ${id} ${branch}`,
        party: "1",
        eligible: true,
      },
      delegate: {
        personId: `delegate:${id}:${branch}`,
        ownerId: "profile:regional",
        isNpc: true,
        name: `Regional representative ${id} ${branch}`,
        party: "1",
        eligible: true,
        appointedByPersonId: `head:${id}:${branch}`,
        appointedOnTurn: 237,
      },
    }))
  );
}
describe("Council formation law and regional mandate rules", () => {
  it.each([
    ["regionalHeads", 234, false],
    ["regionalHeads", 237, true],
    ["regionalDelegates", 460, false],
    ["regionalDelegates", 461, true],
  ] as const)("opens %s at calendar %s only when dated", (mode, turn, expected) => {
    expect(
      available({
        mode,
        preset: "1991-default",
        calendarTurn: turn,
        currentTurn: turn,
        assemblySinceTurn: 145,
      }).available
    ).toBe(expected);
  });
  it("requires a seated Assembly and preserves a later accepted formation choice", () => {
    expect(
      available({
        mode: "regionalHeads",
        preset: "1991-default",
        calendarTurn: 477,
        currentTurn: 477,
      }).reason
    ).toBe("awaiting-assembly");
    expect(
      available({
        mode: "regionalHeads",
        preset: "1991-default",
        calendarTurn: 477,
        currentTurn: 477,
        assemblySinceTurn: 145,
        enactedMode: "regionalDelegates",
      }).reason
    ).toBe("already-authorized");
  });
  it.each([
    [225, 450, false],
    [226, 450, true],
    [89, 178, false],
    [90, 178, true],
    [-1, 178, false],
    [179, 178, false],
  ])("uses full chamber statutory majority %s/%s", (yes, seats, result) => {
    expect(passes(yes, seats)).toBe(result);
  });
  it.each(["regionalHeads", "regionalDelegates"] as const)(
    "seats two distinct representatives per subject in %s",
    (mode) => {
      const result = plan({ mode, turn: 240, authorities: authorities() });
      expect(result.seats).toHaveLength(178);
      expect(new Set(result.seats.map((row) => row.personId)).size).toBe(178);
      expect(result.seatsByParty).toEqual({ "1": 178 });
      expect(result.viable).toBe(true);
      expect(result.seats.every((row) => row.termEndTurn === 427)).toBe(true);
    }
  );
  it.each([
    "missing",
    "duplicate",
    "region",
    "head-person",
    "delegate-source",
    "delegate-person",
    "human-owner",
    "clock",
  ])("rejects malformed %s authority", (defect) => {
    const rows = authorities();
    if (defect === "missing") rows.pop();
    if (defect === "duplicate") rows[1] = rows[0];
    if (defect === "region") rows[0].regionId = "missing";
    if (defect === "head-person") rows[1].head.personId = rows[0].head.personId;
    if (defect === "delegate-source") rows[0].delegate!.appointedByPersonId = "foreign";
    if (defect === "delegate-person") rows[1].delegate!.personId = rows[0].delegate!.personId;
    if (defect === "human-owner") {
      rows[0].delegate!.isNpc = false;
      rows[1].delegate!.isNpc = false;
    }
    if (defect === "clock") rows[0].sinceTurn = 241;
    expect(() => plan({ mode: "regionalDelegates", turn: 240, authorities: rows })).toThrow();
  });
  it("keeps expired, missing and ineligible appointments vacant without extending regional terms", () => {
    const rows = authorities();
    rows[0].termEndTurn = 240;
    rows[1].delegate = undefined;
    rows[2].delegate!.eligible = false;
    const result = plan({ mode: "regionalDelegates", turn: 240, authorities: rows });
    expect(result.seats).toHaveLength(175);
    expect(result.vacancies.map((row) => row.reason)).toEqual([
      "expired-authority",
      "missing-delegate",
      "ineligible-owner",
    ]);
    expect(rows[0].termEndTurn).toBe(240);
  });
});
