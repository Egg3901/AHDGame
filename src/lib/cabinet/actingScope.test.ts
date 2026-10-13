import { describe, it, expect } from "vitest";
import {
  actingScopeRefusal,
  barredScopeMessage,
  barredScopesFor,
  isActingMember,
  isScopeBarredWhenActing,
  type CabinetLeverScope,
} from "./actingScope";

const ALL_SCOPES: CabinetLeverScope[] = [
  "stance",
  "personnel",
  "doctrine",
  "procurement",
  "treasury",
  "assets",
];

describe("isActingMember", () => {
  it("treats a member with acting:true as acting", () => {
    expect(isActingMember({ acting: true })).toBe(true);
  });

  it("treats a missing acting field as confirmed, not as acting", () => {
    // Every member seated before acting appointments existed lacks the field, and
    // the confirmation path inserts a fresh document rather than clearing it. If
    // absent read as acting, confirming someone would silently lock their office.
    expect(isActingMember({})).toBe(false);
    expect(isActingMember({ acting: false })).toBe(false);
  });

  it("treats a missing member as not acting", () => {
    // A vacant seat has no holder to restrict; the holder check upstream refuses first.
    expect(isActingMember(null)).toBe(false);
    expect(isActingMember(undefined)).toBe(false);
  });
});

describe("actingScopeRefusal", () => {
  it("allows every departmental scope for an acting holder", () => {
    for (const scope of ALL_SCOPES) {
      expect(actingScopeRefusal({ acting: true }, scope)).toBeNull();
    }
  });

  it("refuses nothing for a confirmed holder", () => {
    for (const scope of ALL_SCOPES) {
      expect(actingScopeRefusal({ acting: false }, scope)).toBeNull();
      expect(actingScopeRefusal({}, scope)).toBeNull();
    }
  });
});

describe("barredScopesFor", () => {
  it("returns no barred scopes for an acting holder", () => {
    expect(barredScopesFor({ acting: true })).toEqual([]);
  });

  it("returns nothing for a confirmed holder, which the client reads as unrestricted", () => {
    expect(barredScopesFor({})).toEqual([]);
    expect(barredScopesFor(null)).toEqual([]);
  });

  it("agrees with actingScopeRefusal on every scope", () => {
    // The client disables from this list and the API refuses from the refusal
    // helper. If they ever disagree a control renders live over a guaranteed 403.
    const acting = { acting: true };
    const barred = barredScopesFor(acting);
    for (const scope of ALL_SCOPES) {
      expect(barred.includes(scope)).toBe(actingScopeRefusal(acting, scope) !== null);
    }
  });
});

describe("isScopeBarredWhenActing", () => {
  it("covers every declared scope", () => {
    for (const scope of ALL_SCOPES) {
      expect(isScopeBarredWhenActing(scope)).toBe(false);
    }
  });

  it("has no obsolete refusal messages", () => {
    for (const scope of ALL_SCOPES) expect(barredScopeMessage(scope)).toBeNull();
  });
});
