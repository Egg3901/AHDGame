import { describe, expect, it } from "vitest";
import { getChallengerSupplyPolicy } from "./challengerSupply";

describe("challenger supply policy", () => {
  it("fails closed for missing or unregistered countries", () => {
    for (const access of [undefined, { registered: false, enabledForPlayers: false }]) {
      expect(getChallengerSupplyPolicy(access, "senate")).toEqual({
        canReuse: false,
        canGenerate: false,
      });
    }
  });

  it.each(["governor", "senate", "house", "regionalCouncil", "sangiin"])(
    "allows existing NPPs but no free recruits for player %s races",
    (type) => {
      expect(
        getChallengerSupplyPolicy({ registered: true, enabledForPlayers: true }, type)
      ).toEqual({ canReuse: true, canGenerate: false });
    }
  );

  it("does not fill player presidential races with NPPs", () => {
    expect(
      getChallengerSupplyPolicy({ registered: true, enabledForPlayers: true }, "president")
    ).toEqual({ canReuse: false, canGenerate: false });
  });

  it("preserves AI-only presidential candidate supply", () => {
    expect(
      getChallengerSupplyPolicy({ registered: true, enabledForPlayers: false }, "president")
    ).toEqual({ canReuse: true, canGenerate: true });
  });
});
