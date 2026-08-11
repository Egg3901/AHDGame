import { describe, it, expect } from "vitest";
import { groupForces, EMPTY_POSTING } from "../generalPosting";

describe("groupForces", () => {
  it("groups units by type and counts them", () => {
    expect(
      groupForces([
        { type: "Motor Rifle Division" },
        { type: "Artillery Brigade" },
        { type: "Motor Rifle Division" },
      ])
    ).toEqual([
      { name: "Motor Rifle Division", count: 2 },
      { name: "Artillery Brigade", count: 1 },
    ]);
  });

  it("orders by count desc, then name, so the list is stable across renders", () => {
    const out = groupForces([
      { type: "Zulu Brigade" },
      { type: "Alpha Brigade" },
      { type: "Heavy Division" },
      { type: "Heavy Division" },
    ]);
    expect(out.map((f) => f.name)).toEqual(["Heavy Division", "Alpha Brigade", "Zulu Brigade"]);
  });

  it("counts exactly the units given — a two-unit country reports two", () => {
    // The bug this replaces rendered a canned 20-formation order of battle for a
    // country that owned two units.
    const out = groupForces([{ type: "Motor Rifle Division" }, { type: "Artillery Brigade" }]);
    expect(out.reduce((a, f) => a + f.count, 0)).toBe(2);
  });

  it("ignores units with no usable type rather than inventing a bucket", () => {
    expect(groupForces([{ type: "" }, { type: null }, {}, { type: "  " }])).toEqual([]);
  });

  it("has an empty posting that claims nothing", () => {
    expect(EMPTY_POSTING).toEqual({
      forces: [],
      unitCount: 0,
      formationName: null,
      theaterName: null,
      inCharge: false,
    });
  });
});

// ── trait prerequisites ──────────────────────────────────────────────────────
import { missingTraitPrerequisite, FULLTREE } from "../generalsTree";

describe("missingTraitPrerequisite", () => {
  const path = Object.values(FULLTREE)[0].paths[0];

  it("names the trait that blocks a locked node", () => {
    // Nothing learned: the second node is blocked by the first, BY NAME — the UI
    // used to say only "Earlier trait required".
    expect(missingTraitPrerequisite([], path, path.nodes[1])).toBe(path.nodes[0].name);
  });

  it("returns null once the predecessor is learned", () => {
    expect(missingTraitPrerequisite([path.nodes[0].id], path, path.nodes[1])).toBeNull();
  });

  it("returns null for the first node in a path, which nothing blocks", () => {
    expect(missingTraitPrerequisite([], path, path.nodes[0])).toBeNull();
  });
});
