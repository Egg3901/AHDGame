import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types/legislation";
import { resolveAdministrationConflicts } from "./administrationConflicts";

function type(
  id: string,
  family: string,
  conflictSetIds: string[] = [],
  stance?: "left" | "center" | "right"
): LegislationType {
  return {
    _id: id,
    name: id,
    description: id,
    policyDomain: "fixture",
    subCategory: "fixture",
    positions: [],
    administration: {
      primaryPortfolioId: "justice",
      lawKind: "regulation",
      implementationMode: "regulation",
      allowedJurisdictionModes: ["national_direct"],
      defaultJurisdictionMode: "national_direct",
      policyFamilyId: family,
      conflictSetIds,
    },
    ...(stance
      ? {
          policyOptions: [
            { id: `${id}_option`, name: id, stance, effectDirection: 0, economic: 0, social: 0 },
          ],
        }
      : {}),
  };
}

describe("administration conflicts", () => {
  it("blocks only a shared concrete conflict set", () => {
    const result = resolveAdministrationConflicts({
      proposed: [type("proposal", "proposal_family", ["exclusive_delivery_regime"], "left")],
      existing: [type("existing", "existing_family", ["exclusive_delivery_regime"], "right")],
    });
    expect(result.conflicts).toEqual([
      {
        proposedLegislationTypeId: "proposal",
        existingLegislationTypeId: "existing",
        conflictSetId: "exclusive_delivery_regime",
      },
    ]);
  });

  it("does not treat stance as a conflict predicate", () => {
    const result = resolveAdministrationConflicts({
      proposed: [type("proposal", "proposal_family", [], "left")],
      existing: [type("existing", "existing_family", [], "right")],
    });
    expect(result).toEqual({ conflicts: [], replacements: [] });
  });

  it("classifies a shared family as replacement instead of conflict", () => {
    const result = resolveAdministrationConflicts({
      proposed: [type("proposal", "shared")],
      existing: [type("existing", "shared")],
    });
    expect(result.conflicts).toEqual([]);
    expect(result.replacements).toEqual([
      {
        proposedLegislationTypeId: "proposal",
        existingLegislationTypeId: "existing",
        policyFamilyId: "shared",
      },
    ]);
  });
});
