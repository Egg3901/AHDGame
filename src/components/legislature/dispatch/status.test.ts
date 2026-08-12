import { describe, it, expect } from "vitest";
import { dispatchStatusMeta, posName, type DispatchTone } from "./status";
import type { BillStatus } from "@/lib/db/types/legislation";

describe("dispatchStatusMeta", () => {
  it("maps known statuses to label + tone + live flag", () => {
    expect(dispatchStatusMeta("voting")).toEqual({
      label: "Voting Open",
      tone: "warning",
      live: true,
    });
    expect(dispatchStatusMeta("enrolled").tone).toBe("info");
    expect(dispatchStatusMeta("signed").tone).toBe("success");
    expect(dispatchStatusMeta("failed").tone).toBe("error");
    expect(dispatchStatusMeta("vetoed").tone).toBe("error");
  });

  it("covers the full app BillStatus vocabulary", () => {
    // A hand-written list here is an enumeration, not an inventory: it silently
    // stops covering the vocabulary the moment a status is added, which is how
    // `active_both` reached the Dispatch pill as a raw string. A Record keyed by
    // BillStatus does not compile until the new status is listed.
    const EXPECTED: Record<BillStatus, { tone: DispatchTone; live: boolean }> = {
      active: { tone: "warning", live: true },
      active_other: { tone: "warning", live: true },
      active_both: { tone: "warning", live: true },
      veto_override: { tone: "warning", live: true },
      cabinet_review: { tone: "warning", live: true },
      override_shugiin: { tone: "warning", live: true },
      passed_origin: { tone: "info", live: false },
      enrolled: { tone: "info", live: false },
      signed: { tone: "success", live: false },
      failed: { tone: "error", live: false },
      vetoed: { tone: "error", live: false },
      override_failed: { tone: "error", live: false },
      withdrawn: { tone: "error", live: false },
      filibustered: { tone: "error", live: false },
      proposed: { tone: "muted", live: false },
    };

    for (const [status, expected] of Object.entries(EXPECTED)) {
      expect(dispatchStatusMeta(status)).toMatchObject(expected);
      // A fallback pill labels itself with the raw status string.
      expect(dispatchStatusMeta(status).label).not.toBe(status);
    }
  });

  it("falls back gracefully for unknown statuses", () => {
    const meta = dispatchStatusMeta("something_new");
    expect(meta.tone).toBe("muted");
    expect(meta.live).toBe(false);
    expect(meta.label).toBe("something_new");
  });
});

describe("posName", () => {
  it("labels economic axis left/right with intensity", () => {
    expect(posName(0, "econ")).toBe("Centrist");
    expect(posName(-1, "econ")).toBe("Moderately Left");
    expect(posName(2, "econ")).toBe("Right");
    expect(posName(-3, "econ")).toBe("Very Left");
  });
  it("labels social axis authoritarian/libertarian", () => {
    expect(posName(-2, "social")).toBe("Authoritarian");
    expect(posName(2, "social")).toBe("Libertarian");
  });
});
