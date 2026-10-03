import { describe, expect, it } from "vitest";
import { planOrganizationWarDeclaration } from "./warDeclarationRules";

describe("planOrganizationWarDeclaration", () => {
  it("sends player nations to their legislatures and auto-enlists NPP nations", () => {
    expect(
      planOrganizationWarDeclaration({
        targetCountryId: "CN",
        members: [
          {
            countryId: "US",
            playerEnabled: true,
            nppGoverned: false,
            hasLegislature: true,
            legallyEligible: true,
          },
          {
            countryId: "FR",
            playerEnabled: false,
            nppGoverned: true,
            hasLegislature: true,
            legallyEligible: true,
          },
        ],
      })
    ).toEqual({ playerLegislation: ["US"], automaticNpp: ["FR"], excluded: [] });
  });

  it("excludes the target and members that cannot lawfully or institutionally join", () => {
    const plan = planOrganizationWarDeclaration({
      targetCountryId: "CN",
      members: [
        {
          countryId: "CN",
          playerEnabled: true,
          nppGoverned: false,
          hasLegislature: true,
          legallyEligible: true,
        },
        {
          countryId: "UK",
          playerEnabled: true,
          nppGoverned: false,
          hasLegislature: false,
          legallyEligible: true,
        },
        {
          countryId: "DE",
          playerEnabled: true,
          nppGoverned: false,
          hasLegislature: true,
          legallyEligible: false,
        },
        {
          countryId: "ES",
          playerEnabled: false,
          nppGoverned: false,
          hasLegislature: true,
          legallyEligible: true,
        },
      ],
    });

    expect(plan.playerLegislation).toEqual([]);
    expect(plan.automaticNpp).toEqual([]);
    expect(plan.excluded).toEqual([
      { countryId: "CN", reason: "target" },
      { countryId: "UK", reason: "no_legislature" },
      { countryId: "DE", reason: "legally_ineligible" },
      { countryId: "ES", reason: "no_government" },
    ]);
  });
});
