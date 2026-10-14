import { describe, expect, it } from "vitest";
import { classifyLandingCta } from "./LandingIntakeBeacon";

describe("classifyLandingCta", () => {
  it.each([
    ["/register", "register"],
    ["/register?ref=abc", "register"],
    ["https://ahousedividedgame.com/login", "login"],
    ["https://discord.gg/DmF8zJJuqN", "discord"],
    ["/singleplayer", "play_free"],
    ["/wiki/getting-started", "wiki"],
    ["/about", null],
    [null, null],
  ])("%s -> %s", (href, expected) => {
    expect(classifyLandingCta(href)).toBe(expected);
  });
});
