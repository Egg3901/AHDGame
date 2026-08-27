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
  it("refuses every barred scope for an acting holder", () => {
    for (const scope of ALL_SCOPES) {
      expect(actingScopeRefusal({ acting: true }, scope)).toBe(barredScopeMessage(scope));
    }
  });

  it("refuses nothing for a confirmed holder", () => {
    for (const scope of ALL_SCOPES) {
      expect(actingScopeRefusal({ acting: false }, scope)).toBeNull();
      expect(actingScopeRefusal({}, scope)).toBeNull();
    }
  });

  it("names the Senate as the unlock rather than only refusing", () => {
    // The refusal is read by someone who was just handed the seat, so it has to
    // say what changes it, not merely that they cannot.
    expect(actingScopeRefusal({ acting: true }, "stance")).toMatch(/Senate confirms/);
  });
});

describe("barredScopesFor", () => {
  it("returns every scope for an acting holder", () => {
    expect(barredScopesFor({ acting: true }).sort()).toEqual([...ALL_SCOPES].sort());
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
      expect(isScopeBarredWhenActing(scope)).toBe(true);
    }
  });

  it("gives every scope a distinct player-facing sentence", () => {
    const messages = ALL_SCOPES.map(barredScopeMessage);
    expect(new Set(messages).size).toBe(ALL_SCOPES.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });
});
