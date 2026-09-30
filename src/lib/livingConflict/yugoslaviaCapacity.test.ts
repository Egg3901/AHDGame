import { describe, expect, it } from "vitest";
import { YUGOSLAVIA_DEF } from "./defs/yugoslavia";
import { assessCampaignRequirement, recordCampaignCommitment } from "./campaign";
import type { CampaignCapabilitySnapshot } from "@/lib/db/types/livingConflictCampaign";

const capable: CampaignCapabilitySnapshot = {
  treasuryPctGdp: 0.05,
  militaryReadiness: 60,
  logistics: 60,
  domesticSupport: 60,
  intelligence: 60,
  assessedAt: new Date(0),
};
const response = YUGOSLAVIA_DEF.phases[0].events[0].response!;
const intervene = response.decisionTrees.backer_a!.options!.find(
  (option) => option.optionId === "intervene"
)!;
const peacekeeping = response.decisionTrees.bloc!.options!.find(
  (option) => option.optionId === "peacekeeping"
)!;

describe("Yugoslav intervention capacity", () => {
  it.each(["militaryReadiness", "logistics", "domesticSupport"] as const)(
    "requires each country's %s independently",
    (field) => {
      for (const option of [intervene, peacekeeping]) {
        expect(
          assessCampaignRequirement(
            option.campaignRequirement,
            { ...capable, [field]: 0 },
            "operations"
          ).eligible
        ).toBe(false);
        expect(
          assessCampaignRequirement(option.campaignRequirement, capable, "operations").eligible
        ).toBe(true);
      }
    }
  );

  it("records separate national commitments without repeating a response", () => {
    const us = recordCampaignCommitment(
      undefined,
      "US",
      "response-us",
      10,
      intervene.campaignCommitment
    );
    const de = recordCampaignCommitment(
      us,
      "DE",
      "response-de",
      10,
      peacekeeping.campaignCommitment
    );
    expect(de.countryMemory.US.militaryCommitment).toBeGreaterThan(0);
    expect(de.countryMemory.DE.militaryCommitment).toBeGreaterThan(0);
    expect(de.countryMemory.FR).toBeUndefined();
    expect(
      recordCampaignCommitment(de, "US", "response-us", 10, intervene.campaignCommitment)
    ).toEqual(de);
  });
});
