import { describe, expect, it } from "vitest";
import { canCharacterInteract, canRespondToCrisis, describeRoleRequirement } from "./authorization";
import type { CrisisDecisionNode } from "@/lib/db/types/crisis";

const node: CrisisDecisionNode = {
  nodeId: "consent",
  type: "choice",
  title: "Consent",
  description: "Consent",
  requiredRoles: ["headOfState", "cabinet"],
  requiredCabinetPositionIds: ["finance"],
  timeLimitMinutes: null,
};

describe("crisis authorization boundaries", () => {
  it("applies portfolio limits only to the cabinet alternative", () => {
    expect(canCharacterInteract(node, ["headOfState"])).toBe(true);
    expect(canCharacterInteract(node, ["cabinet", "cabinet:finance"])).toBe(true);
    expect(canCharacterInteract(node, ["cabinet", "cabinet:defence"])).toBe(false);
  });
  it("preserves foreign public collective aid but limits regional decisions", () => {
    const crisis = { scope: "region" as const, countryIds: ["US"], regionIds: ["NY"] };
    expect(canRespondToCrisis(crisis, node, "US", "CA")).toBe(false);
    expect(canRespondToCrisis(crisis, node, "US", "NY")).toBe(true);
    expect(canRespondToCrisis(crisis, { ...node, type: "collective" }, "UK", "LON")).toBe(true);
  });
});

describe("describeRoleRequirement", () => {
  it("renders human labels joined with 'or' (any role satisfies the gate)", () => {
    expect(describeRoleRequirement({ requiredRoles: ["headOfState", "cabinet"] })).toBe(
      "Head of state or Cabinet minister"
    );
  });

  it("names the allowed parties for party leader gates", () => {
    expect(
      describeRoleRequirement({
        requiredRoles: ["partyLeader"],
        requiredPartyAbbreviations: ["SDLP", "SF"],
      })
    ).toBe("Party leader (SDLP, SF)");
  });
});
