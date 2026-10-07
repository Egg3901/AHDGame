import { describe, expect, it } from "vitest";
import { currentTurnBuild } from "./turnBuild";

describe("currentTurnBuild", () => {
  it("prefers the Railway deployment commit", () => {
    expect(
      currentTurnBuild({ RAILWAY_GIT_COMMIT_SHA: "ABCDEF1234567", BUILD_GIT_COMMIT_SHA: "1111111" })
    ).toEqual({ commit: "abcdef1234567" });
  });

  it("falls back to the build commit", () => {
    expect(
      currentTurnBuild({ BUILD_GIT_COMMIT_SHA: " 0123456789abcdef0123456789abcdef01234567 " })
    ).toEqual({
      commit: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("omits anything that is not a commit SHA", () => {
    expect(currentTurnBuild({})).toBeUndefined();
    expect(currentTurnBuild({ RAILWAY_GIT_COMMIT_SHA: "main" })).toBeUndefined();
    expect(currentTurnBuild({ RAILWAY_GIT_COMMIT_SHA: "" })).toBeUndefined();
  });
});
