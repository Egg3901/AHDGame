import { describe, it, expect } from "vitest";
import { canUnlock, autoGrantedNodeIds, getCommittedLane, type TechCorpView } from "./selectors";
import { corpNodeId, sectorNodeId } from "./nodes";

const TYPE = "logistics" as const;
// World year 1995 → current decade 1989; decades 1940..1979 are auto-granted.
const YEAR = 1995;
const FUNDS = { rdScore: 1e9, cashAvailable: 1e12, cashCost: 0 };

function playerCorp(): TechCorpView {
  return {
    type: TYPE,
    unlockedTechNodeIds: autoGrantedNodeIds(TYPE, YEAR),
    techDecadeLane: { "1989": "sector" },
  };
}

describe("past-decade lanes (ticket 1606)", () => {
  it("auto-granted baseline makes getCommittedLane infer a lane for a passed decade", () => {
    const corp = playerCorp();
    expect(corp.techDecadeLane?.["1940"]).toBeUndefined();
    // Both lanes' slots 1-9 are granted, so the inference fallback picks one.
    expect(getCommittedLane(corp, "1940")).toBeDefined();
  });

  it("allows a sector specialization in the passed 1940 decade", () => {
    const res = canUnlock(playerCorp(), sectorNodeId(TYPE, "1940", 10), YEAR, FUNDS);
    expect(res).toMatchObject({ ok: true });
  });

  it("allows a corporate specialization in the passed 1940 decade", () => {
    const res = canUnlock(playerCorp(), corpNodeId("1940", 10), YEAR, FUNDS);
    expect(res).toMatchObject({ ok: true });
  });

  it("still lane-locks the non-committed lane in the current decade", () => {
    const corp: TechCorpView = {
      type: TYPE,
      unlockedTechNodeIds: [sectorNodeId(TYPE, "1989", 1)],
      techDecadeLane: { "1989": "sector" },
    };
    expect(canUnlock(corp, corpNodeId("1989", 1), YEAR, FUNDS)).toMatchObject({
      ok: false,
      reason: "lane-locked",
    });
  });
});
