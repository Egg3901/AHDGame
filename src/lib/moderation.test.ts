import { describe, expect, it } from "vitest";
import { containsBlockedName, containsModerateProfanity, containsSlur } from "./moderation";

describe("containsSlur", () => {
  it("blocks slurs and common obfuscations", () => {
    expect(containsSlur("faggot")).toBe(true);
    expect(containsSlur("n1gg3r")).toBe(true);
  });

  it("allows ordinary words", () => {
    expect(containsSlur("Dick")).toBe(false);
    expect(containsSlur("ass")).toBe(false);
  });
});

describe("containsModerateProfanity", () => {
  it("blocks stronger profanity in names", () => {
    expect(containsModerateProfanity("fuck")).toBe(true);
    expect(containsModerateProfanity("rape me")).toBe(true);
    expect(containsModerateProfanity("bitch")).toBe(true);
  });

  it("does not block mild words or unrelated names", () => {
    expect(containsModerateProfanity("ass")).toBe(false);
    expect(containsModerateProfanity("Dick")).toBe(false);
  });
});

describe("containsBlockedName", () => {
  it("blocks either slurs or moderate profanity", () => {
    expect(containsBlockedName("faggot")).toBe(true);
    expect(containsBlockedName("fuck")).toBe(true);
  });

  it("allows clean names", () => {
    expect(containsBlockedName("Alice")).toBe(false);
    expect(containsBlockedName("Dick")).toBe(false);
    expect(containsBlockedName("ass")).toBe(false);
  });
});
