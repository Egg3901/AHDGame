import { describe, it, expect } from "vitest";
import { referendumSideLabels } from "./sideLabels";

describe("referendumSideLabels", () => {
  it("uses reunification framing", () => {
    expect(referendumSideLabels("reunification")).toEqual({ yes: "Reunify", no: "Stay in UK" });
  });
  it("uses independence framing", () => {
    expect(referendumSideLabels("independence")).toEqual({ yes: "Independence", no: "Stay in UK" });
  });
});

it("labels peace agreement consent without promising a territorial change", () => {
  expect(referendumSideLabels("peace_agreement")).toEqual({
    yes: "Ratify agreement",
    no: "Reject agreement",
  });
});
