import { describe, expect, it } from "vitest";
import { claimNetworkRetry, clearNetworkRetry, isNetworkFetchFailure } from "./routeErrorRecovery";

describe("country route transport recovery", () => {
  it.each([
    "network error",
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
  ])("recognizes native fetch transport message %s", (message) => {
    const error = new TypeError(message);
    expect(isNetworkFetchFailure(error)).toBe(true);
  });

  it("does not retry application TypeErrors, aborts, or unrelated errors", () => {
    expect(isNetworkFetchFailure(new TypeError("Cannot read properties of null"))).toBe(false);
    expect(isNetworkFetchFailure(new DOMException("Aborted", "AbortError"))).toBe(false);
    expect(isNetworkFetchFailure(new Error("network error"))).toBe(false);
  });

  it("claims one retry per route and permits another after the cooldown", () => {
    const route = "/country/us/approval";
    clearNetworkRetry(route);

    expect(claimNetworkRetry(route, 100)).toBe(true);
    expect(claimNetworkRetry(route, 101)).toBe(false);
    expect(claimNetworkRetry("/country/uk/approval", 101)).toBe(true);
    expect(claimNetworkRetry(route, 60_101)).toBe(true);

    clearNetworkRetry(route);
    clearNetworkRetry("/country/uk/approval");
  });
});
