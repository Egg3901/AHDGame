import { describe, expect, it } from "vitest";
import { buildBlendClock, buildBlendDetail, detailQuota } from "./blendDetailViewModel";
import type { BlendDetailInput } from "./blendDetailViewModel";

const ABBR: Record<string, string> = { "1": "DEM", "2": "REP" };
const partyAbbr = (id: string) => ABBR[id] ?? id;

function candidate(id: string, name: string, party: string) {
  return {
    id,
    characterName: name,
    party,
    partyName: party === "1" ? "Democratic Party" : "Republican Party",
    partyColor: party === "1" ? "#3B82F6" : "#EF4444",
    isYou: false,
    isNPP: true,
  };
}

/** A 10-seat US House race under pr_hareQuota. 100k votes → quota 10,000. */
function houseInput(over: Partial<BlendDetailInput> = {}): BlendDetailInput {
  return {
    candidates: [candidate("c1", "Ada Wren", "1"), candidate("c2", "Bo Marsh", "2")],
    totalVotes: { c1: 62_000, c2: 38_000 },
    seatsEstimate: { c1: 6, c2: 4 },
    totalSeats: 10,
    electionType: "house",
    countryId: "US",
    isEnded: false,
    regionName: "Georgia",
    partyAbbr,
    ...over,
  };
}

/** A single-winner US Senate race (fptp). */
function senateInput(over: Partial<BlendDetailInput> = {}): BlendDetailInput {
  return {
    ...houseInput(),
    electionType: "senate",
    totalSeats: 1,
    seatsEstimate: null,
    ...over,
  };
}

describe("detailQuota", () => {
  it("is votes per seat for a Hare-quota race", () => {
    expect(detailQuota(houseInput())).toBe(10_000);
  });

  it("is null for first-past-the-post, which has no quota to quote", () => {
    expect(detailQuota(senateInput())).toBeNull();
  });
});

describe("buildBlendDetail — seat allocation", () => {
  it("lays out one block per seat, padding the row to a uniform width", () => {
    const m = buildBlendDetail(houseInput());
    expect(m.blockRows).toHaveLength(1);
    expect(m.blockRows[0].cells).toHaveLength(10);
    expect(m.blockRows[0].pad).toBe(0);
    // Grouped by party, largest bloc first.
    expect(m.blockRows[0].cells.slice(0, 6).every((c) => c.color === "#3B82F6")).toBe(true);
    expect(m.blockRows[0].cells.slice(6).every((c) => c.color === "#EF4444")).toBe(true);
  });

  it("chunks a large chamber into balanced rows of at most 25", () => {
    const m = buildBlendDetail(houseInput({ totalSeats: 56, seatsEstimate: { c1: 30, c2: 26 } }));
    expect(m.blockRows).toHaveLength(3);
    // 56 over 3 rows = 19 per row, last row padded rather than stretched.
    expect(m.blockRows[0].cells).toHaveLength(19);
    expect(m.blockRows[2].cells.length + m.blockRows[2].pad).toBe(19);
    expect(m.blocksSingleRow).toBe(false);
  });

  it("marks unallocated seats rather than silently shrinking the chamber", () => {
    const m = buildBlendDetail(houseInput({ seatsEstimate: { c1: 6, c2: 2 } }));
    const cells = m.blockRows.flatMap((r) => r.cells);
    expect(cells).toHaveLength(10);
    expect(cells.filter((c) => c.title.includes("unallocated"))).toHaveLength(2);
    expect(m.blockRuns.at(-1)?.seats).toBe(2);
  });

  it("labels runs by party and widths sum to the chamber", () => {
    const m = buildBlendDetail(houseInput());
    expect(m.blockRuns.map((r) => r.label)).toEqual(["DEM 6", "REP 4"]);
    expect(m.blockRuns.reduce((s, r) => s + r.widthPct, 0)).toBeCloseTo(100, 5);
  });

  it("offers no allocation panel for a single-winner race", () => {
    expect(buildBlendDetail(senateInput()).isSeatRace).toBe(false);
  });
});

describe("buildBlendDetail — the seat arithmetic", () => {
  it("splits each candidate's seats into whole quotas and remainder", () => {
    const m = buildBlendDetail(houseInput());
    const ada = m.rows.find((r) => r.name === "Ada Wren")!;
    // 62,000 / 10,000 = 6 whole quotas, remainder 2,000.
    expect(ada.math).toEqual(
      expect.arrayContaining([
        { key: "Whole quotas", value: "6" },
        { key: "Remainder", value: "2,000" },
      ])
    );
    expect(ada.mathNote).toContain("6 whole quotas");
    // Bo: 38,000 / 10,000 = 3 whole, and a 4th seat on largest remainder.
    const bo = m.rows.find((r) => r.name === "Bo Marsh")!;
    expect(bo.mathNote).toContain("took 1 further seat on largest remainder");
  });

  it("reports the chamber-level whole-quota / remainder split", () => {
    const m = buildBlendDetail(houseInput());
    // 6 + 3 = 9 seats on whole quotas, 1 on a remainder.
    expect(m.hemiNote).toBe("10 seats · 9 on whole quotas, 1 on remainders");
  });

  // Ticket #1276. `quotaSplit` clamped the displayed whole-quota count to the
  // seats actually won but kept computing the remainder from the UNCLAMPED
  // count, so the panel printed "192,814 votes buys 1 whole quota at 24,520
  // each, leaving a remainder of 21,174" -- a sentence that contradicts itself,
  // since 21,174 is what is left after SEVEN quotas, not one.
  it("keeps votes, whole quotas and remainder consistent when a candidate is squeezed", () => {
    // 62,000 votes at a 10,000 quota is 6.2 quotas, but the winner's bonus
    // leaves this candidate a single seat.
    const m = buildBlendDetail(houseInput({ seatsEstimate: { c1: 1, c2: 9 } }));
    const quota = detailQuota(houseInput({ seatsEstimate: { c1: 1, c2: 9 } }))!;
    for (const row of m.rows) {
      const whole = Number(row.math.find((x) => x.key === "Whole quotas")!.value);
      const remainder = Number(
        row.math.find((x) => x.key === "Remainder")!.value.replace(/,/g, "")
      );
      expect(whole * quota + remainder).toBe(row.votes);
    }
  });

  it("quotes no quota for a method that does not use one", () => {
    const m = buildBlendDetail(senateInput());
    expect(m.rows[0].math.some((x) => x.key === "Quota")).toBe(false);
    expect(m.standfirst).not.toContain("quota");
    expect(m.hemiNote).not.toContain("quota");
  });

  it("explains a single-winner race as a plurality, not an apportionment", () => {
    const m = buildBlendDetail(senateInput());
    expect(m.rows[0].mathNote).toContain("nothing is apportioned by share");
    expect(m.rows[0].seatsCell).toBe("—");
  });
});

// Ticket #1276, second half. UK `lowerChamber` is `pr_hareQuota`, so the panel
// printed a Hare quota and narrated seats as bought with it. But in a
// historical in-game year the engine re-weights votes with the FPTP winner's
// bonus BEFORE the largest-remainder step, so no seat is bought at that quota.
// A player checking the stated arithmetic will always find it wrong.
describe("buildBlendDetail — with the winner's bonus applied", () => {
  const bonusInput = () => houseInput({ bonusApplied: true, seatsEstimate: { c1: 1, c2: 9 } });

  it("stops quoting a quota that decided nothing", () => {
    const m = buildBlendDetail(bonusInput());
    expect(m.facts.some((f) => f.key === "Quota")).toBe(false);
    expect(m.rows.every((r) => !r.math.some((x) => x.key === "Quota"))).toBe(true);
  });

  it("drops the whole-quota and largest-remainder breakdown", () => {
    const m = buildBlendDetail(bonusInput());
    for (const row of m.rows) {
      expect(row.math.some((x) => x.key === "Whole quotas")).toBe(false);
      expect(row.math.some((x) => x.key === "Remainder")).toBe(false);
      expect(row.mathNote).not.toContain("whole quota");
      expect(row.mathNote).not.toContain("largest remainder");
    }
    expect(m.standfirst).not.toContain("Hare quota");
    expect(m.hemiNote).not.toContain("whole quotas");
  });

  it("says instead that the leading parties were boosted", () => {
    const m = buildBlendDetail(bonusInput());
    expect(m.standfirst).toContain("winner's bonus");
    expect(m.hemiNote).toContain("winner's bonus");
    expect(m.rows[0].mathNote).toMatch(/share/);
  });

  it("still keeps em and en dashes out of the generated copy", () => {
    const m = buildBlendDetail(bonusInput());
    expect(m.standfirst).not.toMatch(/[—–]/);
    for (const r of m.rows) expect(r.mathNote).not.toMatch(/[—–]/);
  });

  it("leaves a race with no bonus exactly as it was", () => {
    const withFlag = buildBlendDetail(houseInput({ bonusApplied: false }));
    const without = buildBlendDetail(houseInput());
    expect(withFlag.standfirst).toBe(without.standfirst);
    expect(withFlag.hemiNote).toBe(without.hemiNote);
    expect(withFlag.rows[0].mathNote).toBe(without.rows[0].mathNote);
  });
});

describe("buildBlendDetail — copy and facts", () => {
  it("writes a party-level headline for a seat race", () => {
    expect(buildBlendDetail(houseInput()).headline).toBe("DEM on course for 6 of 10 seats");
    expect(buildBlendDetail(houseInput({ isEnded: true })).headline).toBe(
      "DEM takes 6 of 10 seats"
    );
  });

  it("writes a candidate-level headline for a single winner", () => {
    expect(buildBlendDetail(senateInput()).headline).toBe("Ada Wren leads Georgia");
  });

  it("omits the turnout fact when no electorate is supplied", () => {
    expect(buildBlendDetail(houseInput()).facts.some((f) => f.key === "Turnout")).toBe(false);
    const withRoll = buildBlendDetail(
      houseInput({ electorate: { count: 400_000, basis: "eligible" } })
    );
    const turnout = withRoll.facts.find((f) => f.key === "Turnout");
    expect(turnout?.value).toBe("25.0%");
    expect(turnout?.sub).toBe("of est. 400K eligible");

    // Population fallback must say so rather than pose as an electorate.
    const residents = buildBlendDetail(
      houseInput({ electorate: { count: 550_000, basis: "residents" } })
    );
    expect(residents.facts.find((f) => f.key === "Turnout")?.sub).toBe("of est. 550K residents");
  });

  it("keeps em and en dashes out of generated copy", () => {
    for (const m of [buildBlendDetail(houseInput()), buildBlendDetail(senateInput())]) {
      expect(m.headline).not.toMatch(/[—–]/);
      expect(m.standfirst).not.toMatch(/[—–]/);
      for (const r of m.rows) expect(r.mathNote).not.toMatch(/[—–]/);
    }
  });

  it("marks winners only once the race is final", () => {
    expect(buildBlendDetail(houseInput()).rows.every((r) => !r.isWinner)).toBe(true);
    const done = buildBlendDetail(houseInput({ isEnded: true }));
    expect(done.rows.filter((r) => r.isWinner)).toHaveLength(2);
    // Single winner: only the top of the count.
    const senate = buildBlendDetail(senateInput({ isEnded: true }));
    expect(senate.rows.filter((r) => r.isWinner).map((r) => r.name)).toEqual(["Ada Wren"]);
  });

  it("ignores tally votes for candidates the general no longer lists", () => {
    // From the general on, the API returns one nominee per party while the
    // tally still holds the primary-losers' votes. Counting those would leave
    // votes in the denominator that appear against no row.
    const m = buildBlendDetail(
      houseInput({ totalVotes: { c1: 62_000, c2: 38_000, droppedPrimaryLoser: 500_000 } })
    );
    expect(m.rows.map((r) => r.pctStr)).toEqual(["62.0", "38.0"]);
    expect(m.tallyMeta).toContain("100,000 votes cast");
    // The quota divides the same denominator the shares do.
    expect(
      detailQuota(
        houseInput({ totalVotes: { c1: 62_000, c2: 38_000, droppedPrimaryLoser: 500_000 } })
      )
    ).toBe(10_000);
  });

  it("handles a race with no ballots without dividing by zero", () => {
    const m = buildBlendDetail(houseInput({ totalVotes: {}, seatsEstimate: null }));
    expect(m.rows.every((r) => r.pctStr === "0.0")).toBe(true);
    expect(m.isSeatRace).toBe(false);
    expect(m.headline).toBe("No votes counted in Georgia yet");
  });
});

describe("buildBlendDetail — Westminster benches", () => {
  it("seats government and opposition on opposing benches for the UK", () => {
    const m = buildBlendDetail(
      houseInput({ countryId: "UK", electionType: "commons", totalSeats: 10 })
    );
    expect(m.isBench).toBe(true);
    expect(m.bench).not.toBeNull();
    expect(m.bench!.gov).toHaveLength(6);
    expect(m.bench!.opp).toHaveLength(4);
    expect(m.bench!.govLabel).toBe("Government · DEM");
    // 6 of 10 is a majority of 2.
    expect(m.bench!.majorityNote).toBe("Majority of 2");
  });

  it("reports a hung chamber honestly", () => {
    const m = buildBlendDetail(
      houseInput({
        countryId: "UK",
        electionType: "commons",
        seatsEstimate: { c1: 4, c2: 4 },
      })
    );
    expect(m.bench!.majorityNote).toBe("No overall majority, 2 short");
  });

  it("uses blocks, not benches, outside the UK", () => {
    expect(buildBlendDetail(houseInput()).isBench).toBe(false);
    expect(buildBlendDetail(houseInput()).bench).toBeNull();
  });
});

describe("buildBlendClock", () => {
  it("omits turnout when there is no denominator", () => {
    const rows = buildBlendClock({
      primaryLabel: "Primary",
      primaryValue: "Completed",
      generalValue: "11h 03m",
      isEnded: false,
      inPrimary: false,
      turnoutPct: null,
      ballots: 0,
    });
    expect(rows.map((r) => r.label)).toEqual(["Primary", "General"]);
  });

  it("includes turnout when one is supplied", () => {
    const rows = buildBlendClock({
      primaryLabel: "Primary",
      primaryValue: "Completed",
      generalValue: "Completed",
      isEnded: true,
      inPrimary: false,
      turnoutPct: 63.04,
      ballots: 100,
    });
    expect(rows.at(-1)).toMatchObject({ label: "Turnout", value: "63.0%" });
  });
});
