import { describe, it, expect } from "vitest";
import { DEFECTS, getDefect, requireDefect, validateRegistry } from "./registry";
import type { Defect } from "./types";

function makeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "AHD-x",
    title: "x",
    severity: "P2",
    envs: ["sandbox"],
    idempotent: true,
    seedFix: { status: "not-needed", note: "test fixture" },
    guards: ["max-affected:10"],
    detect: async () => ({ affected: 0, sample: [] }),
    plan: async () => ({ affected: 0, touched: [], moneyDelta: 0, summary: "" }),
    apply: async () => ({}),
    verify: async () => ({ ok: true, remaining: 0, notes: [] }),
    ...overrides,
  };
}

describe("the shipped ledger", () => {
  it("is structurally valid", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("has unique ids", () => {
    const ids = DEFECTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves defects by id", () => {
    expect(getDefect("AHD-951")?.title).toContain("Orphan null-party");
    expect(getDefect("nope")).toBeUndefined();
    expect(() => requireDefect("nope")).toThrow(/unknown defect/);
  });
});

describe("validateRegistry", () => {
  it("catches a duplicate id", () => {
    const problems = validateRegistry([makeDefect(), makeDefect()]);
    expect(problems.join(" ")).toContain("duplicate defect id");
  });

  it("catches a missing cap", () => {
    const problems = validateRegistry([makeDefect({ guards: ["turn-lock-free"] })]);
    expect(problems.join(" ")).toContain("no max-affected cap");
  });

  it("catches a defect registered for no env", () => {
    const problems = validateRegistry([makeDefect({ envs: [] })]);
    expect(problems.join(" ")).toContain("no envs registered");
  });

  it("catches a non-idempotent entry", () => {
    const problems = validateRegistry([makeDefect({ idempotent: false as unknown as true })]);
    expect(problems.join(" ")).toContain("migration");
  });
});
