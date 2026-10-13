import { describe, it, expect } from "vitest";
import { requireConfirmedSecretary } from "./requireConfirmedSecretary";

describe("requireConfirmedSecretary", () => {
  it("allows every scope for acting and confirmed holders, with or without admin access", () => {
    for (const scope of [
      "stance",
      "personnel",
      "doctrine",
      "procurement",
      "treasury",
      "assets",
    ] as const) {
      for (const member of [{ acting: true }, { acting: false }, {}]) {
        expect(requireConfirmedSecretary(member, scope, false)).toBeNull();
        expect(requireConfirmedSecretary(member, scope, true)).toBeNull();
      }
    }
  });

  it("leaves vacant-seat authorization to the upstream holder check", () => {
    expect(requireConfirmedSecretary(null, "assets")).toBeNull();
  });
});
