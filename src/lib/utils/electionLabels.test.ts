import { describe, it, expect } from "vitest";
import {
  officeKeyForElectionType,
  ELECTION_TYPE_LABEL_MAP,
  MULTI_SEAT_TYPES,
  formatElectionTypeLabel,
} from "./electionLabels";

describe("formatElectionTypeLabel", () => {
  it("returns plain House/Senate for the US (no U.S. prefix)", () => {
    expect(formatElectionTypeLabel("house", "US")).toBe("House");
    expect(formatElectionTypeLabel("senate", "US")).toBe("Senate");
    expect(formatElectionTypeLabel("house")).toBe("House");
  });

  it("applies NG overrides", () => {
    expect(formatElectionTypeLabel("house", "NG")).toBe("House of Representatives");
    expect(formatElectionTypeLabel("senate", "NG")).toBe("Senate");
    expect(formatElectionTypeLabel("regionalCouncil", "NG")).toBe("State House of Assembly");
  });
});

describe("officeKeyForElectionType", () => {
  it("maps snap_commons → commons", () => {
    expect(officeKeyForElectionType("snap_commons")).toBe("commons");
  });

  it("maps snap_shugiin → shugiin", () => {
    expect(officeKeyForElectionType("snap_shugiin")).toBe("shugiin");
  });

  it("returns regular types unchanged", () => {
    expect(officeKeyForElectionType("commons")).toBe("commons");
    expect(officeKeyForElectionType("shugiin")).toBe("shugiin");
    expect(officeKeyForElectionType("senate")).toBe("senate");
    expect(officeKeyForElectionType("house")).toBe("house");
    expect(officeKeyForElectionType("governor")).toBe("governor");
  });

  it("returns unknown types unchanged (identity fallback)", () => {
    expect(officeKeyForElectionType("future_country_lower")).toBe("future_country_lower");
  });

  it("maps beta-parliament chamber keys to office-type keys", () => {
    expect(officeKeyForElectionType("cameraDeputati")).toBe("deputy");
    expect(officeKeyForElectionType("assembleeNationale")).toBe("deputy");
    expect(officeKeyForElectionType("congresoDiputados")).toBe("deputy");
    expect(officeKeyForElectionType("milletMeclisi")).toBe("deputy");
    expect(officeKeyForElectionType("riksdag")).toBe("member");
    expect(officeKeyForElectionType("senato")).toBe("senator");
    expect(officeKeyForElectionType("senat")).toBe("senator");
    expect(officeKeyForElectionType("senado")).toBe("senator");
  });
});

describe("ELECTION_TYPE_LABEL_MAP snap coverage", () => {
  it("includes snap_commons and snap_shugiin", () => {
    expect(ELECTION_TYPE_LABEL_MAP.snap_commons).toBe("Snap Commons");
    expect(ELECTION_TYPE_LABEL_MAP.snap_shugiin).toBe("Snap Shūgiin");
  });
});

describe("MULTI_SEAT_TYPES snap coverage", () => {
  it("treats snap types as multi-seat (matching their regular counterparts)", () => {
    expect(MULTI_SEAT_TYPES.has("snap_commons")).toBe(true);
    expect(MULTI_SEAT_TYPES.has("snap_shugiin")).toBe(true);
  });
});

describe("IE label + multi-seat coverage", () => {
  it("registers human-readable labels for IE election types", () => {
    expect(ELECTION_TYPE_LABEL_MAP.dail).toBe("Dáil Éireann");
    expect(ELECTION_TYPE_LABEL_MAP.seanad).toBe("Seanad Éireann");
    expect(ELECTION_TYPE_LABEL_MAP.uachtaran).toBe("Uachtarán na hÉireann");
    expect(ELECTION_TYPE_LABEL_MAP.localCouncil).toBe("Local Council");
  });

  it("treats IE Dáil, Seanad, and Local Council as multi-seat (PR-STV)", () => {
    expect(MULTI_SEAT_TYPES.has("dail")).toBe(true);
    expect(MULTI_SEAT_TYPES.has("seanad")).toBe(true);
    expect(MULTI_SEAT_TYPES.has("localCouncil")).toBe(true);
  });

  it("keeps IE Uachtarán out of MULTI_SEAT_TYPES (single-seat nationwide)", () => {
    expect(MULTI_SEAT_TYPES.has("uachtaran")).toBe(false);
  });
});

describe("DD Volkskammer multi-seat coverage (issue #3896)", () => {
  it("treats volkskammerDeputy as multi-seat", () => {
    // Regression: volkskammerDeputy was absent from MULTI_SEAT_TYPES, so
    // allocateSeats fell through to the single-winner branch and every DD
    // region seated exactly 1 of its `totalSeats` regardless of size (the
    // founding cycle's six races summed to 500 configured seats but only
    // seated 6 deputies total).
    expect(MULTI_SEAT_TYPES.has("volkskammerDeputy")).toBe(true);
  });
});
