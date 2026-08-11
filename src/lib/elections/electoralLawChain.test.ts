import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { proposeBillSchema } from "@/lib/api/schemas/congress";
import { validateElectoralLawProvision } from "./electoralLaws";
import { ELECTORAL_LAW_BILL_CATEGORIES } from "@shared/constants/legislation";

/**
 * The electoral-law provision must be reachable end to end.
 *
 * An adversarial review found the whole server chain built and tested — schema,
 * both route validators, assembly, enactment dispatch — and NO way for a player
 * to produce one. Both bill composers hard-coded `union_law` and neither offered
 * electoral law, so the feature existed only for a hand-crafted POST.
 *
 * Unit tests could not catch that: every link was individually correct. So this
 * walks the chain, and asserts the composers actually emit the provision.
 */

const COMPOSERS = [
  "src/app/congress/components/ProposeBillModal.tsx",
  "src/app/country/[code]/legislature/ProposeLegislationModal.tsx",
];

function composerSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("electoral law is reachable by a player", () => {
  it("a composer's payload passes the request schema", () => {
    // Exactly the shape the modals push, both axes and one axis alone.
    for (const provision of [
      { type: "electoral_law", votingAge: 18, registrationAccess: 30 },
      { type: "electoral_law", votingAge: 21 },
      { type: "electoral_law", registrationAccess: -25 },
    ]) {
      const parsed = proposeBillSchema.safeParse({
        title: "The Franchise Act",
        summary: "Lowers the voting age.",
        chamber: "house",
        category: "social",
        provisions: [provision],
      });
      expect(parsed.success, JSON.stringify(provision)).toBe(true);
    }
  });

  it("the shared validator accepts what the schema accepted", () => {
    const res = validateElectoralLawProvision({ votingAge: 18, registrationAccess: 30 }, "social");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.provision).toEqual({
        type: "electoral_law",
        votingAge: 18,
        registrationAccess: 30,
      });
    }
  });

  it("rejects a provision outside the gated category", () => {
    const res = validateElectoralLawProvision({ votingAge: 18 }, "industry");
    expect(res.ok).toBe(false);
  });

  it("rejects a provision that sets neither axis", () => {
    const res = validateElectoralLawProvision({}, "social");
    expect(res.ok).toBe(false);
  });

  // The load-bearing one. Everything above passed while the feature was
  // unreachable, because no UI emitted it.
  it.each(COMPOSERS)("%s can emit an electoral_law provision", (path) => {
    const src = composerSource(path);
    expect(src, `${path} never builds the provision`).toContain('type: "electoral_law"');
    expect(src, `${path} has no franchise control`).toContain("votingAge");
    expect(src, `${path} has no registration-access control`).toContain("registrationAccess");
  });

  it("the composers gate on the same category the server does", () => {
    expect([...ELECTORAL_LAW_BILL_CATEGORIES]).toEqual(["social"]);
    for (const path of COMPOSERS) {
      expect(composerSource(path), path).toContain("ELECTORAL_LAW_BILL_CATEGORIES");
    }
  });
});
