import { describe, expect, it } from "vitest";
import {
  canHoldAdditionalAppointment,
  isCandidateEligibleForVacancy,
  isSharedPoolStale,
  roleSlotForPosition,
  roleSlotForUkPosition,
  sharedPoolFromRows,
  unionLegislativeDomains,
  UK_CENTRAL_POSITION_IDS,
} from "./rules";

describe("role slots", () => {
  it("classifies the two central titles and everything else as departmental", () => {
    expect(UK_CENTRAL_POSITION_IDS).toEqual(["deputy_prime_minister", "first_secretary_of_state"]);
    expect(roleSlotForUkPosition("deputy_prime_minister")).toBe("central");
    expect(roleSlotForUkPosition("first_secretary_of_state")).toBe("central");
    expect(roleSlotForUkPosition("chancellor")).toBe("departmental");
    expect(roleSlotForUkPosition("foreign_secretary")).toBe("departmental");
  });

  it("returns null slots outside the UK", () => {
    expect(roleSlotForPosition("US", "secretary_of_state")).toBeNull();
    expect(roleSlotForPosition("DE", "finance_minister")).toBeNull();
    expect(roleSlotForPosition("UK", "chancellor")).toBe("departmental");
    expect(roleSlotForPosition("UK", "deputy_prime_minister")).toBe("central");
  });
});

describe("canHoldAdditionalAppointment", () => {
  it("allows one department plus one central title in either direction", () => {
    expect(canHoldAdditionalAppointment("UK", [], "departmental")).toEqual({ ok: true });
    expect(canHoldAdditionalAppointment("UK", [], "central")).toEqual({ ok: true });
    expect(canHoldAdditionalAppointment("UK", ["departmental"], "central")).toEqual({ ok: true });
    expect(canHoldAdditionalAppointment("UK", ["central"], "departmental")).toEqual({ ok: true });
  });

  it("rejects two departments, both central titles, and a third seat in the UK", () => {
    expect(canHoldAdditionalAppointment("UK", ["departmental"], "departmental")).toEqual({
      ok: false,
      reason: "A minister may not hold two departmental portfolios",
    });
    expect(canHoldAdditionalAppointment("UK", ["central"], "central")).toEqual({
      ok: false,
      reason: "A minister may not hold both central titles",
    });
    expect(
      canHoldAdditionalAppointment("UK", ["departmental", "central"], "departmental").ok
    ).toBe(false);
    expect(canHoldAdditionalAppointment("UK", ["departmental", "central"], "central").ok).toBe(
      false
    );
  });

  it("keeps one seat per character outside the UK", () => {
    expect(canHoldAdditionalAppointment("US", [], null)).toEqual({ ok: true });
    expect(canHoldAdditionalAppointment("US", ["departmental"], null).ok).toBe(false);
    expect(canHoldAdditionalAppointment("DE", [], null)).toEqual({ ok: true });
    expect(canHoldAdditionalAppointment("DE", ["central"], null).ok).toBe(false);
  });
});

describe("sharedPoolFromRows", () => {
  it("takes the minimum remaining with its own reset day so no extra actions appear", () => {
    expect(
      sharedPoolFromRows(
        [
          { remaining: 4, resetDay: "2026-09-17" },
          { remaining: 1, resetDay: "2026-09-16" },
        ],
        4
      )
    ).toEqual({ remaining: 1, resetDay: "2026-09-16" });
  });

  it("passes a single row through and resolves empty input to a full pool", () => {
    expect(sharedPoolFromRows([{ remaining: 3, resetDay: "2026-09-17" }], 4)).toEqual({
      remaining: 3,
      resetDay: "2026-09-17",
    });
    expect(sharedPoolFromRows([], 4)).toEqual({ remaining: 4, resetDay: null });
  });

  it("treats missing days as null and compares stale days lexicographically", () => {
    expect(sharedPoolFromRows([{ remaining: 2, resetDay: undefined }], 4)).toEqual({
      remaining: 2,
      resetDay: null,
    });
    expect(isSharedPoolStale(null, "2026-09-17")).toBe(true);
    expect(isSharedPoolStale(undefined, "2026-09-17")).toBe(true);
    expect(isSharedPoolStale("2026-09-16", "2026-09-17")).toBe(true);
    expect(isSharedPoolStale("2026-09-17", "2026-09-17")).toBe(false);
  });
});

describe("isCandidateEligibleForVacancy", () => {
  it("admits single-slot holders only to the complementary UK vacancy", () => {
    expect(isCandidateEligibleForVacancy("UK", "central", [])).toBe(true);
    expect(isCandidateEligibleForVacancy("UK", "departmental", [])).toBe(true);
    expect(isCandidateEligibleForVacancy("UK", "central", ["departmental"])).toBe(true);
    expect(isCandidateEligibleForVacancy("UK", "departmental", ["central"])).toBe(true);
    expect(isCandidateEligibleForVacancy("UK", "central", ["central"])).toBe(false);
    expect(isCandidateEligibleForVacancy("UK", "departmental", ["departmental"])).toBe(false);
    expect(isCandidateEligibleForVacancy("UK", "central", ["departmental", "central"])).toBe(
      false
    );
  });

  it("keeps the legacy exclude-all-holders rule without a vacancy slot or outside the UK", () => {
    expect(isCandidateEligibleForVacancy("UK", null, [])).toBe(true);
    expect(isCandidateEligibleForVacancy("UK", null, ["departmental"])).toBe(false);
    expect(isCandidateEligibleForVacancy("US", null, [])).toBe(true);
    expect(isCandidateEligibleForVacancy("US", null, ["departmental"])).toBe(false);
    expect(isCandidateEligibleForVacancy("US", "central", ["departmental"])).toBe(false);
  });
});

describe("unionLegislativeDomains", () => {
  it("unions domains across both offices without duplicates", () => {
    expect(unionLegislativeDomains([["economy", "treasury"], ["constitution", "economy"]])).toEqual([
      "economy",
      "treasury",
      "constitution",
    ]);
    expect(unionLegislativeDomains([])).toEqual([]);
  });
});
