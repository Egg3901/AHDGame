import { describe, expect, it, vi } from "vitest";

// The degenerate era `settlement/actuate.ts` guards with its `leaveBloc(..., skip)`
// parameter: ONE organisation carrying BOTH poles. Mocked in its own file because
// the mock is hoisted for the whole module.
vi.mock("@/lib/constants/alignmentEras", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants/alignmentEras")>()),
  resolveAlignmentEra: () => ({
    key: "degenerate",
    fromYear: 1945,
    toYear: null,
    poles: ["WEST", "EAST"],
    channels: [
      { organizationId: "NATO", poleId: "WEST", weight: 1, alignmentAccession: true },
      { organizationId: "NATO", poleId: "EAST", weight: 1, alignmentAccession: true },
    ],
    inherit: {},
  }),
}));

const { rivalBlocOrgsFor } = await import("./blocMembership");

describe("rivalBlocOrgsFor, where one organisation carries both poles", () => {
  it("never names the organisation being joined as its own rival", () => {
    // Returning it would make `admitMember` withdraw the country from the very
    // alliance it is joining: a false "withdrew" line to every member, its
    // leadership vacated and a tombstone written, all immediately before the
    // insert re-adds it. `leaveBloc`'s `skip` parameter exists for this case.
    expect(rivalBlocOrgsFor("1953-default", "NATO")).toEqual([]);
  });
});
