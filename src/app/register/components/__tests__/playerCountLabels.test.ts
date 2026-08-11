import { describe, expect, it } from "vitest";
import { registeredPlayersLabel, playersHereSuffix } from "../playerCountLabels";

describe("registeredPlayersLabel", () => {
  it("pluralizes zero", () => {
    expect(registeredPlayersLabel(0)).toBe("0 registered players");
  });
  it("is singular for one", () => {
    expect(registeredPlayersLabel(1)).toBe("1 registered player");
  });
  it("pluralizes many", () => {
    expect(registeredPlayersLabel(5)).toBe("5 registered players");
  });
});

describe("playersHereSuffix", () => {
  it("pluralizes zero", () => {
    expect(playersHereSuffix(0)).toBe("(0 players here)");
  });
  it("is singular for one", () => {
    expect(playersHereSuffix(1)).toBe("(1 player here)");
  });
  it("pluralizes many", () => {
    expect(playersHereSuffix(3)).toBe("(3 players here)");
  });
});
