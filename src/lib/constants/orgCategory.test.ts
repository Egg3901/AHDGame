import { describe, it, expect } from "vitest";
import {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_CATEGORY_META,
  canTableResolutionType,
  categoryPowers,
  isOrganizationCategory,
} from "./orgCategory";

describe("orgCategory", () => {
  it("has metadata for every category", () => {
    for (const c of ORGANIZATION_CATEGORIES) {
      const meta = ORGANIZATION_CATEGORY_META[c];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.powers.length).toBeGreaterThan(0);
    }
  });

  it("economic orgs can pass FTAs and sanctions", () => {
    expect(categoryPowers("economic")).toContain("free_trade_agreement");
    expect(categoryPowers("economic")).toContain("sanctions");
  });

  it("a security alliance has no trade or sanctions powers", () => {
    // FTAs and sanctions are economic/political instruments, not a defense bloc's.
    expect(canTableResolutionType("security", "free_trade_agreement")).toBe(false);
    expect(canTableResolutionType("security", "sanctions")).toBe(false);
    // It keeps its security instruments + the universal dues power.
    expect(canTableResolutionType("security", "set_posture")).toBe(true);
    expect(canTableResolutionType("security", "joint_statement")).toBe(true);
    expect(canTableResolutionType("security", "set_dues")).toBe(true);
  });

  it("validates category strings", () => {
    expect(isOrganizationCategory("political")).toBe(true);
    expect(isOrganizationCategory("banana")).toBe(false);
  });

  it("canTableResolutionType gates by category powers AND implemented effects", () => {
    // economic has sanctions power + sanctions is implemented → allowed
    expect(canTableResolutionType("economic", "sanctions")).toBe(true);
    // political lacks sanctions power → blocked
    expect(canTableResolutionType("political", "sanctions")).toBe(false);
    // FTA is economic/development only → political (a diplomatic forum) can't table it
    expect(canTableResolutionType("political", "free_trade_agreement")).toBe(false);
    expect(canTableResolutionType("economic", "free_trade_agreement")).toBe(true);
    expect(canTableResolutionType("development", "free_trade_agreement")).toBe(true);
    // development lacks the directive power → blocked (even though it's implemented)
    expect(canTableResolutionType("development", "directive")).toBe(false);
    // dues are a baseline power available to every category
    expect(canTableResolutionType("development", "set_dues")).toBe(true);
  });
});
