import { describe, expect, it } from "vitest";
import en from "../../../messages/en/auth.json";
import de from "../../../messages/de/auth.json";
import { resolveResultKey, safeResultNext } from "./OAuthResultPage";

describe("safeResultNext", () => {
  it("keeps same-site paths and the vetted Lakeside continuation", () => {
    expect(safeResultNext("/profile")).toBe("/profile");
    expect(safeResultNext("/create-character?x=1")).toBe("/create-character?x=1");
    const lakeside = "https://auth.ahousedividedgame.com/auth/ahd?return=https%3A%2F%2Fops.example";
    expect(safeResultNext(lakeside)).toBe(new URL(lakeside).toString());
  });

  it("drops anything that could leave the site or run script", () => {
    for (const bad of [
      "javascript:alert(1)",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "data:text/html,x",
    ]) {
      expect(safeResultNext(bad)).toBe("/settings");
    }
    expect(safeResultNext(null)).toBe("/settings");
  });
});

describe("resolveResultKey", () => {
  // Every reason an OAuth callback (Google, Discord, Apple) can emit.
  const CALLBACK_REASONS = [
    "access_denied",
    "already_linked",
    "exchange_failed",
    "invalid_state",
    "maintenance",
    "missing_params",
    "not_configured",
    "rate_limited",
    "registration_blocked",
    "session_expired",
    "test_mode",
  ];

  it("maps every callback reason to its own copy, not the generic error", () => {
    for (const reason of CALLBACK_REASONS) {
      expect(resolveResultKey("error", reason).key, reason).not.toBe("error");
    }
    expect(resolveResultKey("error", "registration_blocked").key).toBe("registrationBlocked");
    expect(resolveResultKey("error", "maintenance").key).toBe("maintenance");
  });

  it("has copy in every locale for every resolved key", () => {
    for (const messages of [en, de]) {
      const result = messages.auth.oauthResult as unknown as Record<
        string,
        { title?: string; message?: string }
      >;
      for (const reason of [...CALLBACK_REASONS, null]) {
        const { key } = resolveResultKey("error", reason);
        expect(result[key]?.title, key).toBeTruthy();
        expect(result[key]?.message, key).toBeTruthy();
      }
    }
  });

  it("falls back to the generic error for unknown codes", () => {
    expect(resolveResultKey("error", "something_new").key).toBe("error");
    expect(resolveResultKey("login_success", null).key).toBe("loginSuccess");
  });
});
