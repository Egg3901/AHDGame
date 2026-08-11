import { describe, expect, it } from "vitest";
import {
  loginDestination,
  safeLakesideLoginReturn,
  takeOAuthReturnUrlCookie,
} from "./lakesideLoginReturn";

describe("safeLakesideLoginReturn", () => {
  it("accepts only the AHD Lakeside Auth continuation route", () => {
    const valid =
      "https://auth.ahousedividedgame.com/auth/ahd?return=https%3A%2F%2Fops.lakesidegames.net%2Fauth%2Fcallback";
    expect(safeLakesideLoginReturn(valid)).toBe(valid);
    expect(safeLakesideLoginReturn("https://evil.example/auth/ahd")).toBeNull();
    expect(safeLakesideLoginReturn("https://auth.ahousedividedgame.com/other")).toBeNull();
    expect(safeLakesideLoginReturn("javascript:alert(1)")).toBeNull();
  });

  it("returns authenticated users to Lakeside instead of the AHD profile", () => {
    const valid =
      "https://auth.ahousedividedgame.com/auth/ahd?return=https%3A%2F%2Fops.lakesidegames.net%2Fauth%2Fcallback";
    expect(
      loginDestination(valid, { role: "player", isAdmin: true, hasCompletedSetup: true })
    ).toBe(valid);
    expect(
      loginDestination("https://evil.example/", {
        role: "player",
        isAdmin: true,
        hasCompletedSetup: true,
      })
    ).toBe("/profile");
  });

  it("takeOAuthReturnUrlCookie reads and clears the cookie", () => {
    const store = new Map<string, string>([
      ["discord_oauth_return_url", "https://auth.ahousedividedgame.com/auth/ahd?return=x"],
    ]);
    const cookieStore = {
      get: (name: string) => {
        const value = store.get(name);
        return value === undefined ? undefined : { value };
      },
      delete: (name: string) => {
        store.delete(name);
      },
    };
    expect(takeOAuthReturnUrlCookie(cookieStore, "discord_oauth_return_url")).toBe(
      "https://auth.ahousedividedgame.com/auth/ahd?return=x"
    );
    expect(store.has("discord_oauth_return_url")).toBe(false);
    expect(takeOAuthReturnUrlCookie(cookieStore, "discord_oauth_return_url")).toBeNull();
  });
});
