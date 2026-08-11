import { describe, expect, it } from "vitest";
import { buildRaceBuckets, NOT_RUNNING_KEY, type RaceBucketInputs } from "./raceBuckets";
import type { NPPOption } from "./types";

const npp = (id: string, name: string): NPPOption => ({
  id,
  name,
  party: "reform",
  estimatedChance: 0,
  stats: {
    favorability: 50,
    politicalInfluence: 50,
    loyalty: 50,
    ambition: 50,
    stubbornness: 50,
  },
});

describe("buildRaceBuckets", () => {
  it("groups senate races by senate class", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha"), npp("n2", "Bravo"), npp("n3", "Charlie")],
      activeElections: [
        { id: "e1", label: "AK senate (Class 2)", state: "AK", type: "senate", senateClass: 2 },
        { id: "e2", label: "AK senate (Class 3)", state: "AK", type: "senate", senateClass: 3 },
      ],
      nppCandidacies: [
        { electionId: "e1", candidateId: "c1", nppId: "n1" },
        { electionId: "e1", candidateId: "c2", nppId: "n2" },
        { electionId: "e2", candidateId: "c3", nppId: "n3" },
      ],
    };

    const buckets = buildRaceBuckets(inputs);

    const senateClass2 = buckets.find((b) => b.key === "senate:2");
    const senateClass3 = buckets.find((b) => b.key === "senate:3");
    expect(senateClass2?.label).toBe("Senate (Class 2)");
    expect(senateClass2?.npps.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(senateClass3?.label).toBe("Senate (Class 3)");
    expect(senateClass3?.npps.map((n) => n.id)).toEqual(["n3"]);
  });

  it("collapses all house elections in a state into one bucket", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha"), npp("n2", "Bravo")],
      activeElections: [
        { id: "e1", label: "AK house", state: "AK", type: "house" },
        { id: "e2", label: "AK house", state: "AK", type: "house" },
      ],
      nppCandidacies: [
        { electionId: "e1", candidateId: "c1", nppId: "n1" },
        { electionId: "e2", candidateId: "c2", nppId: "n2" },
      ],
    };

    const buckets = buildRaceBuckets(inputs);
    const house = buckets.find((b) => b.key === "house");
    expect(house?.label).toBe("House");
    expect(house?.npps.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(buckets.filter((b) => b.key !== NOT_RUNNING_KEY)).toHaveLength(1);
  });

  it("puts NPPs without an active candidacy into the Not Running bucket", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha"), npp("n2", "Bravo")],
      activeElections: [
        { id: "e1", label: "AK senate (Class 2)", state: "AK", type: "senate", senateClass: 2 },
      ],
      nppCandidacies: [{ electionId: "e1", candidateId: "c1", nppId: "n1" }],
    };

    const buckets = buildRaceBuckets(inputs);
    const notRunning = buckets.find((b) => b.key === NOT_RUNNING_KEY);
    expect(notRunning?.label).toBe("Not Running");
    expect(notRunning?.npps.map((n) => n.id)).toEqual(["n2"]);
  });

  it("places NPPs whose candidacy is in another state into Not Running", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha")],
      activeElections: [
        { id: "e1", label: "TX senate (Class 2)", state: "TX", type: "senate", senateClass: 2 },
      ],
      nppCandidacies: [{ electionId: "e1", candidateId: "c1", nppId: "n1" }],
    };

    const buckets = buildRaceBuckets(inputs);
    expect(buckets.map((b) => b.key)).toEqual([NOT_RUNNING_KEY]);
    expect(buckets[0].npps.map((n) => n.id)).toEqual(["n1"]);
  });

  it("hides race buckets that have no NPPs", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha")],
      activeElections: [
        { id: "e1", label: "AK governor", state: "AK", type: "governor" },
        { id: "e2", label: "AK house", state: "AK", type: "house" },
      ],
      nppCandidacies: [{ electionId: "e1", candidateId: "c1", nppId: "n1" }],
    };

    const buckets = buildRaceBuckets(inputs);
    // Only "governor" — the e2 "house" election has no NPP candidates,
    // and there is no Not Running bucket because every NPP is running.
    expect(buckets.map((b) => b.key)).toEqual(["governor"]);
  });

  it("sorts buckets alphabetically by label with Not Running pinned to the bottom", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha"), npp("n2", "Bravo"), npp("n3", "Charlie"), npp("n4", "Delta")],
      activeElections: [
        { id: "e1", label: "AK senate (Class 2)", state: "AK", type: "senate", senateClass: 2 },
        { id: "e2", label: "AK governor", state: "AK", type: "governor" },
        { id: "e3", label: "AK house", state: "AK", type: "house" },
      ],
      nppCandidacies: [
        { electionId: "e1", candidateId: "c1", nppId: "n1" },
        { electionId: "e2", candidateId: "c2", nppId: "n2" },
        { electionId: "e3", candidateId: "c3", nppId: "n3" },
      ],
    };

    const buckets = buildRaceBuckets(inputs);
    expect(buckets.map((b) => b.key)).toEqual(["governor", "house", "senate:2", NOT_RUNNING_KEY]);
  });

  it("returns only Not Running when no NPPs are running anywhere", () => {
    const inputs: RaceBucketInputs = {
      state: "AK",
      npps: [npp("n1", "Alpha"), npp("n2", "Bravo")],
      activeElections: [],
      nppCandidacies: [],
    };

    const buckets = buildRaceBuckets(inputs);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe(NOT_RUNNING_KEY);
    expect(buckets[0].npps.map((n) => n.id)).toEqual(["n1", "n2"]);
  });
});
