import { describe, expect, it } from "vitest";
import { classifyBoundaryError } from "./useReportedError";

describe("classifyBoundaryError", () => {
  it("detects network failures", () => {
    expect(classifyBoundaryError(new Error("Failed to fetch"))).toBe("NETWORK_ERROR");
  });
  it("treats a digest as a server render error", () => {
    expect(classifyBoundaryError(Object.assign(new Error("x"), { digest: "123" }))).toBe(
      "SERVER_RENDER_ERROR"
    );
  });
  it("defaults to CLIENT_ERROR and honors an explicit catalog code", () => {
    expect(classifyBoundaryError(new Error("x"))).toBe("CLIENT_ERROR");
    expect(classifyBoundaryError(Object.assign(new Error("x"), { code: "RATE_LIMITED" }))).toBe(
      "RATE_LIMITED"
    );
  });
});
