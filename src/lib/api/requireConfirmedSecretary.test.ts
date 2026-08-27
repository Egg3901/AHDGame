import { describe, it, expect } from "vitest";
import { requireConfirmedSecretary } from "./requireConfirmedSecretary";
import { barredScopeMessage } from "@/lib/cabinet/actingScope";

describe("requireConfirmedSecretary", () => {
  it("lets a confirmed holder through", async () => {
    expect(requireConfirmedSecretary({ acting: false }, "stance")).toBeNull();
    expect(requireConfirmedSecretary({}, "procurement")).toBeNull();
  });

  it("refuses an acting holder with 403 and the scope's own sentence", async () => {
    const res = requireConfirmedSecretary({ acting: true }, "stance");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { error?: string; message?: string };
    // The API's wording and the disabled control's wording come from the same
    // constant, so a player reading either sees the same explanation.
    expect(JSON.stringify(body)).toContain(barredScopeMessage("stance"));
  });

  it("refuses every barred scope", () => {
    for (const scope of [
      "stance",
      "personnel",
      "doctrine",
      "procurement",
      "treasury",
      "assets",
    ] as const) {
      expect(requireConfirmedSecretary({ acting: true }, scope)?.status).toBe(403);
    }
  });

  it("exempts admins so ops can still repair a department held in an acting capacity", () => {
    // These routes are the only write path for most of these levers. There is no
    // admin-side stance or doctrine endpoint to fall back to.
    expect(requireConfirmedSecretary({ acting: true }, "stance", true)).toBeNull();
  });

  it("does not exempt a non-admin caller", () => {
    expect(requireConfirmedSecretary({ acting: true }, "stance", false)?.status).toBe(403);
  });

  it("lets a vacant seat through, leaving the holder check upstream to refuse", () => {
    // This guard is a ceiling on the office's powers, not an authorization check;
    // returning null here must not be read as granting anything.
    expect(requireConfirmedSecretary(null, "assets")).toBeNull();
  });
});
