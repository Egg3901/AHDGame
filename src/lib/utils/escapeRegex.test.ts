import { describe, it, expect } from "vitest";
import { escapeRegex } from "./escapeRegex";

describe("escapeRegex", () => {
  it("escapes regex special characters", () => {
    expect(escapeRegex("(a+)+$")).toBe("\\(a\\+\\)\\+\\$");
    expect(escapeRegex(".*?")).toBe("\\.\\*\\?");
    expect(escapeRegex("[test]")).toBe("\\[test\\]");
    expect(escapeRegex("a|b")).toBe("a\\|b");
  });

  it("allows literal match of ReDoS-prone input", () => {
    const input = "(a+)+$";
    const escaped = escapeRegex(input);
    const regex = new RegExp(`^${escaped}$`, "i");
    expect("(a+)+$").toMatch(regex);
    expect("(a+)+$").toBe(input);
  });

  it("does not hang on malicious input", () => {
    const malicious = "(a+)+$";
    const escaped = escapeRegex(malicious);
    const regex = new RegExp(`^${escaped}$`, "i");
    const start = Date.now();
    expect(regex.test("(a+)+$")).toBe(true);
    expect(regex.test("normal")).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
