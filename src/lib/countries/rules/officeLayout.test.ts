import { describe, expect, it } from "vitest";
import { getCountryConfig, getCountryConfigForRuntime } from "@/lib/constants/countries";
import { getVotingUpperChamberKey, resolveCountryOfficeLayout } from "./officeLayout";

describe("voting authority for appointed upper chambers", () => {
  it.each(["regionalHeads", "regionalDelegates"] as const)(
    "includes the installed %s Council",
    (mode) => {
      const config = getCountryConfigForRuntime("RU", "1991-default", {
        ruFederalAssemblySinceTurn: 145,
        ruCouncilComposition: { mode },
      });
      expect(config.upperElectionSystem).toBeUndefined();
      expect(getVotingUpperChamberKey(config)).toBe("federationCouncil");
      expect(resolveCountryOfficeLayout(config).jointSittingOfficeTypes).toEqual([
        "dumaDeputy",
        "federationCouncilMember",
      ]);
    }
  );
  it("excludes Germany's unimplemented appointed Bundesrat", () => {
    const config = getCountryConfig("DE", "1953-default");
    expect(getVotingUpperChamberKey(config)).toBeNull();
    expect(resolveCountryOfficeLayout(config).jointSittingOfficeTypes).toHaveLength(1);
  });
  it("does not turn a Soviet-era Council mandate into voting authority", () => {
    const config = getCountryConfigForRuntime("RU", "1991-default", {});
    expect(getVotingUpperChamberKey(config)).toBeNull();
    expect(resolveCountryOfficeLayout(config).jointSittingOfficeTypes).toHaveLength(1);
  });
});
