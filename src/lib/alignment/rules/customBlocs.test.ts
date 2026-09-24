import { describe, expect, it } from "vitest";
import { ALIGNMENT_POLES, customAlignmentPoleId } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "@/lib/alignment/normalize";
import { buildAlignmentTopology, foundCustomBlocPole } from "./customBlocs";

describe("custom Bloc alignment rules", () => {
  it("adds an independent pole and accession channel", () => {
    const topology = buildAlignmentTopology(1979, Object.values(ALIGNMENT_POLES), [
      {
        organizationId: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        founderCountryId: "BR",
        accentToken: "warning",
      },
    ]);
    const poleId = customAlignmentPoleId("andes-pact");

    expect(topology.poles).toEqual(["WEST", "EAST", poleId]);
    expect(topology.poleDefinitions.get(poleId)).toMatchObject({
      label: "Andes Pact",
      shortLabel: "AP",
      leaderCountryId: "BR",
      accentToken: "warning",
    });
    expect(topology.channels).toContainEqual({
      organizationId: "andes-pact",
      poleId,
      weight: 1,
      alignmentAccession: true,
    });
  });

  it("commits the founder to exactly sixty points without breaking the total", () => {
    const current = normalizeShares({ WEST: 60, EAST: 20 }, ["WEST", "EAST"]);
    const poleId = customAlignmentPoleId("andes-pact");
    const next = foundCustomBlocPole({
      current,
      currentPoles: ["WEST", "EAST"],
      poleId,
    });

    expect(next.shares[poleId]).toBe(60);
    expect(next.shares.WEST).toBe(24);
    expect(next.shares.EAST).toBe(8);
    expect(next.nonAligned).toBe(8);
    expect(Object.values(next.shares).reduce<number>((sum, share) => sum + (share ?? 0), 0)).toBe(
      92
    );
  });

  it("keeps custom poles across a built-in era change", () => {
    const poleId = customAlignmentPoleId("andes-pact");
    const topology = buildAlignmentTopology(2019, Object.values(ALIGNMENT_POLES), [
      {
        organizationId: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        founderCountryId: "BR",
        accentToken: "error",
      },
    ]);
    expect(topology.poles).toContain(poleId);
    expect(
      topology.channels.find((channel) => channel.organizationId === "andes-pact")?.poleId
    ).toBe(poleId);
  });
});
