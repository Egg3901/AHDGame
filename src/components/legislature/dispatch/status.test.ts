import { describe, it, expect } from "vitest";
import { dispatchStatusMeta, posName } from "./status";

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
    // Every real BillStatus must map to a non-fallback tone (fallback is muted+label===status).
    const liveVoting = [
      "active",
      "active_other",
      "veto_override",
      "cabinet_review",
      "override_shugiin",
    ];
    for (const s of liveVoting) {
      expect(dispatchStatusMeta(s)).toMatchObject({ tone: "warning", live: true });
    }
    expect(dispatchStatusMeta("passed_origin").tone).toBe("info");
    expect(dispatchStatusMeta("enrolled").tone).toBe("info");
    expect(dispatchStatusMeta("signed").tone).toBe("success");
    for (const s of ["failed", "vetoed", "override_failed", "withdrawn", "filibustered"]) {
      expect(dispatchStatusMeta(s).tone).toBe("error");
    }
    expect(dispatchStatusMeta("proposed").tone).toBe("muted");
    // none of these should fall through to the raw-status label
    for (const s of [
      ...liveVoting,
      "passed_origin",
      "enrolled",
      "signed",
      "failed",
      "vetoed",
      "override_failed",
      "withdrawn",
      "filibustered",
      "proposed",
    ]) {
      expect(dispatchStatusMeta(s).label).not.toBe(s);
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
