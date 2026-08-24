import { describe, expect, it } from "vitest";
import { isStarterStub } from "./starterStub";
import { playerWikiStarter, partyWikiStarter, corporationWikiStarter } from "./playerPages";

describe("isStarterStub", () => {
  it("treats an untouched player starter as a stub", () => {
    expect(isStarterStub(playerWikiStarter("Victoria Astor"))).toBe(true);
  });

  it("treats untouched party and corporation starters as stubs", () => {
    expect(isStarterStub(partyWikiStarter("Farmer-Labor Party"))).toBe(true);
    expect(isStarterStub(corporationWikiStarter("Harris Family Company Holdings"))).toBe(true);
  });

  it("ignores the heading, so renaming the entity does not un-stub the page", () => {
    const renamed = playerWikiStarter("Someone Else");
    expect(isStarterStub(renamed)).toBe(true);
  });

  it("tolerates whitespace and line-ending drift in the stored copy", () => {
    const noisy = playerWikiStarter("Victoria Astor").replace(/\n/g, "\r\n") + "\n\n  ";
    expect(isStarterStub(noisy)).toBe(true);
  });

  it("treats empty and whitespace-only content as a stub", () => {
    expect(isStarterStub("")).toBe(true);
    expect(isStarterStub("   \n\n ")).toBe(true);
    expect(isStarterStub(null)).toBe(true);
    expect(isStarterStub(undefined)).toBe(true);
  });

  it("releases the page as soon as the owner writes anything of their own", () => {
    const edited = playerWikiStarter("Victoria Astor").replace(
      "Summarize the issues you care most about.",
      "I ran on rent control and lost twice before winning Albany in 1954."
    );
    expect(isStarterStub(edited)).toBe(false);
  });

  it("does not flag ordinary wiki prose that happens to be short", () => {
    expect(isStarterStub("# Bonds\n\nBonds are issued at auction and settle the next turn.")).toBe(
      false
    );
  });
});
