import { describe, expect, it } from "vitest";
import { CHARACTER_GATE_COOKIE, isCharacterGatedPath, needsCharacterHint } from "./characterGate";

describe("CHARACTER_GATE_COOKIE", () => {
  it("is the stable hint cookie name", () => {
    expect(CHARACTER_GATE_COOKIE).toBe("ahd-needs-character");
  });
});

describe("isCharacterGatedPath", () => {
  it("gates the main authenticated app routes", () => {
    for (const path of [
      "/dashboard",
      "/profile",
      "/actions",
      "/elections",
      "/map",
      "/parties",
      "/country/US",
      "/stockmarket",
    ]) {
      expect(isCharacterGatedPath(path)).toBe(true);
    }
  });

  it("allows the singleplayer start screen, which exists to replace a wiped character", () => {
    expect(isCharacterGatedPath("/singleplayer")).toBe(false);
  });

  it("allows the character-creation destinations", () => {
    expect(isCharacterGatedPath("/create-character")).toBe(false);
    expect(isCharacterGatedPath("/create-imperial-character")).toBe(false);
  });

  it("allows auth + session entry/exit routes", () => {
    for (const path of ["/login", "/register", "/logout", "/auth/discord"]) {
      expect(isCharacterGatedPath(path)).toBe(false);
    }
  });

  it("allows status pages reachable without a character", () => {
    for (const path of ["/banned", "/maintenance", "/unauthorized", "/retired"]) {
      expect(isCharacterGatedPath(path)).toBe(false);
    }
  });

  it("allows account management so a character-less user is not trapped", () => {
    expect(isCharacterGatedPath("/settings")).toBe(false);
    expect(isCharacterGatedPath("/settings/account")).toBe(false);
  });

  it("allows the landing page and public/legal/info pages", () => {
    for (const path of [
      "/",
      "/about",
      "/terms",
      "/privacy",
      "/contact",
      "/faq",
      "/changelog",
      "/api-guide",
      "/guides",
      "/feedback",
    ]) {
      expect(isCharacterGatedPath(path)).toBe(false);
    }
  });

  it("never gates API routes (they self-guard; redirecting them returns HTML to fetch)", () => {
    expect(isCharacterGatedPath("/api/auth/me")).toBe(false);
    expect(isCharacterGatedPath("/api/game/states")).toBe(false);
  });

  it("never gates Next internals or static assets", () => {
    expect(isCharacterGatedPath("/_next/static/chunk.js")).toBe(false);
    expect(isCharacterGatedPath("/logo.png")).toBe(false);
    expect(isCharacterGatedPath("/robots.txt")).toBe(false);
  });

  it("matches allowlist prefixes on a path boundary, not a substring", () => {
    // "/api" must not accidentally allow "/api-guide" via the wrong path, and
    // an unrelated route that merely starts with allowlisted letters stays gated.
    expect(isCharacterGatedPath("/loginbonus")).toBe(true);
    expect(isCharacterGatedPath("/registry")).toBe(true);
  });
});

describe("needsCharacterHint", () => {
  it("is true for a player with no character", () => {
    expect(needsCharacterHint({ role: "player", isAdmin: false, hasCharacter: false })).toBe(true);
  });

  it("is false once the player has a character", () => {
    expect(needsCharacterHint({ role: "player", isAdmin: false, hasCharacter: true })).toBe(false);
  });

  it("exempts admins even without a character", () => {
    expect(needsCharacterHint({ role: "player", isAdmin: true, hasCharacter: false })).toBe(false);
    expect(needsCharacterHint({ role: "admin", isAdmin: true, hasCharacter: false })).toBe(false);
  });

  it("exempts moderators even without a character", () => {
    expect(needsCharacterHint({ role: "moderator", isAdmin: false, hasCharacter: false })).toBe(
      false
    );
  });
});
