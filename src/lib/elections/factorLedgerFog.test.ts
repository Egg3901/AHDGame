import { describe, expect, it } from "vitest";
import { applyFactorLedgerFogOfWar } from "./factorLedgerFog";
import { FACTOR_ORDER, type FactorLedgerSnapshot } from "@/lib/electionEngine/factorLedger";

function candidate(id: string): FactorLedgerSnapshot["byCandidateNational"][number] {
  return {
    candidateId: id,
    nominalWeight: 1000,
    finalVotes: 1200,
    factors: FACTOR_ORDER.map((key) => ({ key, label: key, voteDelta: 10 })),
    bucketAppeal: [
      { candidateId: id, bucket: "race:white", appealShare: 0.6, demoEP: -1, demoSP: 0 },
      { candidateId: id, bucket: "race:nonwhite", appealShare: 0.4, demoEP: 1, demoSP: 0 },
    ],
  };
}

function snapshot(): FactorLedgerSnapshot {
  return {
    recordedTurn: 800,
    byCandidateNational: [candidate("mine"), candidate("theirs")],
    byCandidateUnit: [
      { candidateId: "mine", unitId: "CA", nominalWeight: 100, finalVotes: 120, factors: [] },
      { candidateId: "theirs", unitId: "CA", nominalWeight: 100, finalVotes: 110, factors: [] },
    ],
  };
}

describe("applyFactorLedgerFogOfWar", () => {
  it("keeps the national waterfall for every candidate", () => {
    const fogged = applyFactorLedgerFogOfWar(snapshot(), new Set(["mine"]));
    expect(fogged.byCandidateNational.map((c) => c.candidateId).sort()).toEqual(["mine", "theirs"]);
    for (const c of fogged.byCandidateNational) {
      expect(c.factors.map((f) => f.key)).toEqual(FACTOR_ORDER);
    }
  });

  it("strips bucketAppeal and per-unit rows for candidates the viewer does not own", () => {
    const fogged = applyFactorLedgerFogOfWar(snapshot(), new Set(["mine"]));

    const mine = fogged.byCandidateNational.find((c) => c.candidateId === "mine")!;
    const theirs = fogged.byCandidateNational.find((c) => c.candidateId === "theirs")!;
    expect(mine.bucketAppeal).toBeDefined();
    expect(theirs.bucketAppeal).toBeUndefined();

    // Per-unit rows only for the owned candidate.
    const unitOwners = new Set(fogged.byCandidateUnit!.map((u) => u.candidateId));
    expect(unitOwners).toEqual(new Set(["mine"]));
  });

  it("reveals everything to an owner of all candidates (admin)", () => {
    const fogged = applyFactorLedgerFogOfWar(snapshot(), new Set(["mine", "theirs"]));
    for (const c of fogged.byCandidateNational) {
      expect(c.bucketAppeal).toBeDefined();
    }
    expect(fogged.byCandidateUnit!.length).toBe(2);
  });

  it("strips everyone when the viewer owns no candidate", () => {
    const fogged = applyFactorLedgerFogOfWar(snapshot(), new Set());
    for (const c of fogged.byCandidateNational) {
      expect(c.bucketAppeal).toBeUndefined();
    }
    expect(fogged.byCandidateUnit).toEqual([]);
  });
});
