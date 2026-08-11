import { describe, it, expect } from "vitest";
import { computeRegionThreats, type ThreatInput } from "../regionThreat";

// The era's bloc roll, as `loadMilitaryBlocs` reads it from live membership. BR and SE
// are deliberately absent: they are non-aligned, which is a real answer here.
const BLOCS = { US: "west", UK: "west", RU: "east", DD: "east", CN: "east" } as const;

function input(over: Partial<ThreatInput> = {}): ThreatInput {
  return {
    viewerCountry: "US",
    blocs: BLOCS,
    currentTurn: 40,
    // The live conflicts' regions, injected by the caller from conflict.region.
    theaterRegion: { afghan: "cas", nicaragua: "cac", angola: "ssa", ogaden: "mea" },
    declarations: [],
    reports: [],
    committedByCountry: [],
    ...over,
  };
}
const RANK = { Low: 0, Medium: 1, Rising: 2, High: 3, Severe: 4 } as const;

describe("computeRegionThreats", () => {
  it("is Low everywhere with no conflict", () => {
    const t = computeRegionThreats(input());
    expect(t.cas).toBe("Low");
    expect(t.weu).toBe("Low");
  });

  it("elevates the theater's region for an offensive targeting the viewer", () => {
    // afghan → cas; CN(east) declaring on US(west) viewer → ×2.5
    const t = computeRegionThreats(
      input({ declarations: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan" }] })
    );
    expect(RANK[t.cas]).toBeGreaterThanOrEqual(RANK.High);
  });

  it("weighs an offensive targeting the viewer above one between other nations", () => {
    const atMe = computeRegionThreats(
      input({ declarations: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan" }] })
    ).cas;
    const others = computeRegionThreats(
      input({ declarations: [{ declarerCountry: "CN", targetCountry: "RU", theaterId: "afghan" }] })
    ).cas;
    expect(RANK[atMe]).toBeGreaterThan(RANK[others]);
  });

  it("decays battles to nothing past the 24-turn window", () => {
    const t = computeRegionThreats(
      input({
        currentTurn: 100,
        reports: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan", turn: 70 }],
      })
    );
    expect(t.cas).toBe("Low"); // 30 turns ago > WINDOW
  });

  it("counts a recent battle and fades it with age", () => {
    const fresh = computeRegionThreats(
      input({
        currentTurn: 40,
        reports: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan", turn: 40 }],
      })
    ).cas;
    const older = computeRegionThreats(
      input({
        currentTurn: 40,
        reports: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan", turn: 22 }],
      })
    ).cas;
    expect(RANK[fresh]).toBeGreaterThan(RANK[older]);
  });

  it("only theater-mapped regions can rise", () => {
    const t = computeRegionThreats(
      input({ declarations: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan" }] })
    );
    expect(t.weu).toBe("Low"); // no theater maps to Western Europe
  });

  it("floors a region with an active conflict to at least Medium", () => {
    // an own-bloc battle 20 turns old (UK→DE, viewer US) weights to ~6 (Low),
    // but a live conflict there should never read calmer than Medium
    const t = computeRegionThreats(
      input({
        viewerCountry: "US",
        currentTurn: 40,
        reports: [{ declarerCountry: "UK", targetCountry: "DE", theaterId: "afghan", turn: 20 }],
      })
    );
    expect(t.cas).toBe("Medium"); // weighted heat → Low, floored up to Medium
  });

  it("a no-contact fizzle does not floor the region to Medium", () => {
    const t = computeRegionThreats(
      input({
        viewerCountry: "US",
        currentTurn: 40,
        reports: [
          {
            declarerCountry: "US",
            targetCountry: "CN",
            theaterId: "afghan",
            turn: 30,
            noContact: true,
          },
        ],
      })
    );
    expect(t.cas).toBe("Low"); // fizzle = no live conflict, weighted heat only
  });

  it("bleeds conflict into a bordering region (spillover), below the direct region", () => {
    // afghan → cas; mea borders cas. A conflict at cas warms mea via spillover.
    const t = computeRegionThreats(
      input({ declarations: [{ declarerCountry: "CN", targetCountry: "US", theaterId: "afghan" }] })
    );
    expect(RANK[t.mea]).toBeGreaterThan(RANK.Low); // spillover warmed it
    expect(RANK[t.mea]).toBeLessThan(RANK[t.cas]); // but below the direct-conflict region
  });

  it("spillover alone does not trip the Medium floor", () => {
    // a mild conflict at cas; a non-neighbour with no own conflict stays Low
    const t = computeRegionThreats(
      input({ committedByCountry: [{ country: "US", committed: { afghan: 100 } }] })
    );
    expect(t.noa).toBe("Low"); // noa doesn't border cas → no spill, no floor
  });

  it("home proximity makes a border conflict outrank an identical far one", () => {
    const decl = [{ declarerCountry: "CN", targetCountry: "RU", theaterId: "afghan" }]; // at cas
    const nearHome = computeRegionThreats(
      input({ viewerCountry: "RU", viewerHomeRegion: "eeu", declarations: decl })
    ).cas; // eeu borders cas → ×1.2
    const farHome = computeRegionThreats(
      input({ viewerCountry: "BR", viewerHomeRegion: "sam", declarations: decl })
    ).cas; // sam far from cas → ×1.0
    expect(RANK[nearHome]).toBeGreaterThanOrEqual(RANK[farHome]);
  });

  it("raises threat when the enemy bloc masses forces at a theater", () => {
    const t = computeRegionThreats(
      input({ committedByCountry: [{ country: "CN", committed: { afghan: 500 } }] })
    );
    expect(RANK[t.cas]).toBeGreaterThanOrEqual(RANK.Medium);
  });
});

// Non-aligned is a real bloc now, not the absence of one. Its predecessor answered
// "west" for every country it did not list, so a neutral read a NATO war as its own.
describe("regionThreat for a non-aligned viewer", () => {
  it("weights a two-bloc war as foreign rather than as the viewer's own", () => {
    const decl = [{ declarerCountry: "US", targetCountry: "RU", theaterId: "afghan" }];
    // SE is absent from the roll, so it is non-aligned.
    const neutral = computeRegionThreats(input({ viewerCountry: "SE", declarations: decl }));
    // A western viewer's own bloc is doing the declaring, so it discounts to 1.0.
    const western = computeRegionThreats(input({ viewerCountry: "US", declarations: decl }));
    expect(RANK[neutral.cas]).toBeGreaterThanOrEqual(RANK[western.cas]);
  });

  // The enemy-massing multiplier was `vb === "west" ? m.east : m.west`, so a
  // non-aligned viewer fell into the else and rated a WESTERN build-up hostile while
  // treating an eastern one as harmless. Both are foreign to a neutral.
  it("rates either bloc's build-up as foreign, not just the western one", () => {
    const west = computeRegionThreats(
      input({
        viewerCountry: "SE",
        committedByCountry: [{ country: "US", committed: { afghan: 500 } }],
      })
    );
    const east = computeRegionThreats(
      input({
        viewerCountry: "SE",
        committedByCountry: [{ country: "RU", committed: { afghan: 500 } }],
      })
    );
    expect(east.cas).toBe(west.cas);
  });

  it("does not count a neutral's massed forces as an enemy build-up", () => {
    // SE is non-aligned: its deployment sets neither bloc flag, so no enemy-massing
    // multiplier and no both-blocs bonus. Previously the `else` filed it as eastern.
    const neutralMass = computeRegionThreats(
      input({ committedByCountry: [{ country: "SE", committed: { afghan: 500 } }] })
    );
    const easternMass = computeRegionThreats(
      input({ committedByCountry: [{ country: "RU", committed: { afghan: 500 } }] })
    );
    expect(RANK[neutralMass.cas]).toBeLessThan(RANK[easternMass.cas]);
  });
});

describe("regionThreat with coalition reports", () => {
  it("treats an auto-defending ally as being attacked, not as bloc noise", () => {
    // The DDR was the named target; the USSR defended alongside it and bled for it.
    // Its own board must read that as an attack on the USSR, not distant activity.
    const base = {
      blocs: BLOCS,
      viewerHomeRegion: "eeu" as ThreatInput["viewerHomeRegion"],
      currentTurn: 41,
      theaterRegion: { t1: "eeu" },
      declarations: [],
      committedByCountry: [],
    };
    const report = {
      declarerCountry: "US",
      targetCountry: "DD",
      theaterId: "t1",
      turn: 40,
      noContact: false,
    };
    const asBystander = computeRegionThreats({
      ...base,
      viewerCountry: "RU",
      reports: [report],
    });
    const asDefender = computeRegionThreats({
      ...base,
      viewerCountry: "RU",
      reports: [{ ...report, attackers: ["US"], defenders: ["DD", "RU"] }],
    });
    const order = ["Low", "Medium", "Rising", "High", "Severe"];
    expect(order.indexOf(asDefender.eeu)).toBeGreaterThanOrEqual(order.indexOf(asBystander.eeu));
  });
});
