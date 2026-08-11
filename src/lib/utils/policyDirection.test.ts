import { describe, it, expect } from "vitest";
import { pushesValueUp } from "./policyDirection";

describe("pushesValueUp", () => {
  it("higher-is-better: improving intent pushes the value up", () => {
    expect(pushesValueUp(5, true)).toBe(true);
    expect(pushesValueUp(-5, true)).toBe(false);
  });

  it("lower-is-better: improving intent pushes the value DOWN (flip)", () => {
    // A policy that improves a lower-is-better metric (e.g. cuts unemployment)
    // has a positive good/bad direction but moves the value down.
    expect(pushesValueUp(5, false)).toBe(false);
    // A worsening policy on a lower-is-better metric moves the value up.
    expect(pushesValueUp(-5, false)).toBe(true);
  });

  it("zero direction does not push up", () => {
    expect(pushesValueUp(0, true)).toBe(false);
    expect(pushesValueUp(0, false)).toBe(false);
  });
});
