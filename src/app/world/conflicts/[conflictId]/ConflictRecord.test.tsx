// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConflictRecord, type ConflictRecordView } from "./ConflictRecord";
import type { SideForce } from "./conflictRecordView";

// The front map fetches its geometry shard and the tick strip polls turn status;
// this record has neither, so both render their degraded states.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withheld: SideForce = {
  divisions: null,
  personnel: null,
  readiness: null,
  recovery: null,
  casualties: 6000,
};

const base: ConflictRecordView = {
  conflictId: 1,
  tier: "public",
  canAct: false,
  viewerCountry: null,
  ownSide: null,
  chain: null,
  actions: null,
  dictate: null,
  postedHere: null,
  employ: null,
  whoDeclares: "The defense secretary — no Theater Commander is designated at this front.",
  committedCountry: null,
  committedDead: 0,
  name: "Manchurian Front",
  type: "interstate",
  hostCountry: "CN",
  region: "East Asia",
  years: "1953 – present",
  startYear: 1953,
  currentTurn: 120,
  status: "active",
  statusLabel: "Active",
  sideALabel: "NATO",
  sideBLabel: "PLA",
  sideACountries: ["US"],
  sideBCountries: ["CN"],
  control: 70,
  controlStart: 50,
  hostRegionCodes: [],
  hostIsBelligerent: true,
  verdict: "PLA is well ahead in CN.",
  verdictDetail: "The line has moved 20 points toward PLA since 1953. 1 engagement, 12,345 dead.",
  opening: "opened at 50 / 50 in 1953",
  casualties: 12345,
  engagements: 1,
  unopposedAdvances: 0,
  lastEventLabel: "LAST ENGAGEMENT",
  lastEventValue: "T41",
  pending: [
    { text: "No offensive declared — the line holds", when: "the line holds", tone: "quiet" },
  ],
  momentum: {
    control: 70,
    fromTurn: 60,
    toTurn: 120,
    marks: [{ turn: 41, label: "−6 PTS", side: "B", row: 0 }],
    tag: "PLA ADVANCING",
    tagColor: "b",
    note: "1 engagement, 12,345 dead, and 6 points of ground.",
    sideBLabel: "PLA",
  },
  forceA: withheld,
  forceB: { ...withheld, casualties: 6345 },
  battles: [
    {
      id: "r1",
      turn: 41,
      verdict: "Victory",
      declarer: "US",
      target: "CN",
      attackers: ["US"],
      defenders: ["CN"],
      attackerLosses: [{ country: "US", loss: 300 }],
      defenderLosses: [{ country: "CN", loss: 900 }],
      groundPct: null,
    },
  ],
};

describe("ConflictRecord", () => {
  it("heads the record with the conflict's identity", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
    expect(screen.getAllByText(/CN/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1953 – present/)).toBeTruthy();
  });

  it("shows the conflict's public number and region", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText(/#1 · East Asia/)).toBeTruthy();
  });

  it("names both belligerents", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getAllByText(/NATO/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PLA/).length).toBeGreaterThan(0);
  });

  it("states who is winning, and by how much of the host", () => {
    const { container } = render(<ConflictRecord conflict={base} />);
    expect(screen.getByText("PLA is well ahead in CN.")).toBeTruthy();
    // Side A holds the remainder — the split is stated as two numbers, not one.
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy();
    expect(container.textContent).toMatch(/of CN/);
  });

  it("reports cumulative casualties and engagements as headline totals", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText("12,345")).toBeTruthy();
    expect(screen.getByText("LAST ENGAGEMENT")).toBeTruthy();
    // The tile and the log row it points at both name the turn.
    expect(screen.getAllByText("T41").length).toBeGreaterThan(0);
  });

  it("lists the war log with both sides' losses", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText(/Victory/)).toBeTruthy();
    expect(screen.getByText(/300/)).toBeTruthy();
    expect(screen.getByText(/900/)).toBeTruthy();
  });

  it("ends the log with the war's own beginning", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText(/War declared\. The line opened at 50 \/ 50\./)).toBeTruthy();
  });

  it("says so when nothing has been fought yet", () => {
    render(
      <ConflictRecord conflict={{ ...base, battles: [], engagements: 0, unopposedAdvances: 0 }} />
    );
    expect(screen.getByText(/no engagements/i)).toBeTruthy();
  });

  it("renders a resolved war", () => {
    render(
      <ConflictRecord
        conflict={{ ...base, status: "resolved", statusLabel: "Resolved", years: "1953 – 1955" }}
      />
    );
    expect(screen.getByText(/Resolved/)).toBeTruthy();
    expect(screen.getByText(/1953 – 1955/)).toBeTruthy();
  });

  it("shows an unopposed advance as an outcome, not a blank row", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          engagements: 0,
          unopposedAdvances: 1,
          battles: [{ ...base.battles[0], verdict: "Unopposed advance", unopposed: true }],
        }}
      />
    );
    expect(screen.getByText("Unopposed advance")).toBeTruthy();
    expect(screen.getByText("no contact")).toBeTruthy();
  });

  it("states ground moved from the declarer's side", () => {
    const { container } = render(
      <ConflictRecord conflict={{ ...base, battles: [{ ...base.battles[0], groundPct: 6 }] }} />
    );
    // US declared and side A gained 6 points, so the row reads as a gain.
    expect(container.textContent).toMatch(/\+6 pts/);
  });
});

describe("ConflictRecord tiers", () => {
  it("withholds both sides' composition at the public tier", () => {
    const { container } = render(<ConflictRecord conflict={base} />);
    expect(container.querySelector("[data-force]")).toBeNull();
    expect(container.querySelector("[data-rosters]")).toBeNull();
    expect(screen.queryByText(/your order of battle/i)).toBeNull();
    expect(screen.getByText("NOT PUBLIC")).toBeTruthy();
    // The withheld cell is a stated absence, not a zero.
    expect(container.textContent).toMatch(/\? \? \?/);
  });

  it("publishes both sides' casualty totals even at the public tier", () => {
    const { container } = render(<ConflictRecord conflict={base} />);
    expect(container.textContent).toMatch(/6,000/);
    expect(container.textContent).toMatch(/6,345/);
  });

  it("shows the viewer's own forces and the enemy band at the command tier", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          viewerCountry: "US",
          ownSide: "A",
          enemyBand: "Evenly matched",
          forceA: {
            divisions: 1,
            personnel: 18400,
            readiness: 61,
            recovery: null,
            casualties: 6000,
          },
          forceB: { ...withheld, casualties: 6345 },
          ownForces: [
            {
              id: "u1",
              name: "1st Armored",
              type: "Armored Division",
              domain: "ground",
              posture: "standard",
              readiness: 70,
              strengthPct: 88,
            },
          ],
        }}
      />
    );
    expect(screen.getByText(/your order of battle/i)).toBeTruthy();
    expect(screen.getByText("1st Armored")).toBeTruthy();
    expect(screen.getByText(/88% strength/)).toBeTruthy();
    expect(screen.getAllByText(/Evenly matched/).length).toBeGreaterThan(0);
    expect(container.querySelectorAll("[data-force]").length).toBe(1);
  });

  it("projects readiness recovery from the turn processor's own drift step", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          ownForces: [
            {
              id: "u1",
              name: "1st Armored",
              type: "Armored Division",
              domain: "ground",
              posture: "standard",
              readiness: 60,
              strengthPct: 88,
            },
          ],
        }}
      />
    );
    // standard settles at 72; (72 − 60) / 4 = 3 turns.
    expect(screen.getByText(/\+4%\/turn · full in 3/)).toBeTruthy();
  });

  // The fog lifts when the war ends. Calling an open record "fog of war" beside
  // two full rosters describes the opposite page.
  it("calls a resolved war an open record, not fog of war", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "archive",
          status: "resolved",
          statusLabel: "Resolved",
          forceA: { divisions: 0, personnel: 0, readiness: null, recovery: null, casualties: 6000 },
          forceB: { divisions: 0, personnel: 0, readiness: null, recovery: null, casualties: 6345 },
        }}
      />
    );
    expect(screen.getByText("OPEN RECORD")).toBeTruthy();
    expect(screen.queryByText("FOG OF WAR")).toBeNull();
    expect(container.textContent).toMatch(/open to everyone/);
  });

  // A resolved war has returned every unit to reserve, so both sides read zero.
  // That is not an undefended front, and must not invite taking ground.
  it("does not call a finished war unopposed", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "archive",
          status: "resolved",
          statusLabel: "Resolved",
          ownSide: "B",
          forceA: { divisions: 0, personnel: 0, readiness: null, recovery: null, casualties: 6000 },
          forceB: { divisions: 0, personnel: 0, readiness: null, recovery: null, casualties: 6345 },
        }}
      />
    );
    expect(container.textContent).not.toMatch(/Unopposed —/);
    expect(container.textContent).not.toMatch(/Ground taken here costs nothing/);
  });

  // "? ? ?" is the mark for a field the server refused to send. A side with no
  // formations present is not being withheld — there is simply nothing there.
  it("distinguishes an absent force from a withheld one", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "B",
          enemyBand: "No forces detected",
          forceA: { divisions: 0, personnel: null, readiness: null, recovery: null, casualties: 0 },
          forceB: {
            divisions: 2,
            personnel: 31500,
            readiness: 61,
            recovery: { perTurn: 4, turnsToFull: 6 },
            casualties: 14206,
          },
        }}
      />
    );
    // The viewer's own side still reports properly...
    expect(screen.getByText("61%")).toBeTruthy();
    // ...while the absent enemy gets a dash, not the withheld marker.
    expect(container.textContent).toMatch(/—/);
    expect(screen.getAllByText("none").length).toBeGreaterThan(0);
  });

  it("says so when a commander has committed nothing", () => {
    render(<ConflictRecord conflict={{ ...base, tier: "command", ownSide: "A", ownForces: [] }} />);
    expect(screen.getByText(/no forces committed/i)).toBeTruthy();
  });

  it("renders per-engagement rosters when the payload carries them", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "archive",
          battles: [
            {
              ...base.battles[0],
              rosters: [
                {
                  country: "US",
                  power: 4444,
                  units: [
                    { id: "u1", name: "1st Armored", type: "Armored Division", casualties: 300 },
                  ],
                },
                {
                  country: "CN",
                  power: 9999,
                  units: [
                    { id: "e1", name: "88th Guards", type: "Rifle Division", casualties: 900 },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );
    expect(container.querySelector("[data-rosters]")).toBeTruthy();
    expect(screen.getByText(/1st Armored/)).toBeTruthy();
    expect(screen.getByText(/88th Guards/)).toBeTruthy();
    expect(screen.getByText(/4,444/)).toBeTruthy();
  });

  it("says the opposing roster is withheld rather than leaving a gap", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          battles: [
            {
              ...base.battles[0],
              rostersWithheld: true,
              rosters: [
                {
                  country: "US",
                  power: 4444,
                  units: [
                    { id: "u1", name: "1st Armored", type: "Armored Division", casualties: 300 },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );
    expect(container.textContent).toMatch(/Roster withheld/);
    expect(container.textContent).toMatch(/Unlocks for everyone when the war resolves/);
  });
});

describe("ConflictRecord command surface", () => {
  const actions = {
    theaterId: "front-1",
    countryCode: "us",
    positionId: "secretary_of_defense",
    targets: ["CN"],
    pendingTarget: null,
  };

  const chain = {
    role: "defenseHolder" as const,
    roleLabel: "Defense Secretary",
    standing: "You own your nation's force structure.",
    can: ["Create commands."],
    handoffs: [],
    locked: null as string | null,
  };

  it("offers no command surface to a viewer who may not act", () => {
    render(<ConflictRecord conflict={{ ...base, canAct: false, actions }} />);
    expect(screen.queryByRole("button", { name: /declare/i })).toBeNull();
  });

  it("offers it to a viewer who may", () => {
    render(
      <ConflictRecord
        conflict={{ ...base, tier: "command", ownSide: "A", canAct: true, actions }}
      />
    );
    expect(screen.getByText(/^COMMAND$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /declare/i })).toBeTruthy();
  });

  // A missing button with nothing in its place reads as a page that failed to
  // load; the rule takes the panel's slot instead.
  it("explains the absence of the command surface where it would have been", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          canAct: false,
          chain: {
            ...chain,
            locked: "Gen. Rodin holds this theater, so the declare button is theirs.",
          },
        }}
      />
    );
    expect(screen.getByText("NOT FROM THIS SEAT")).toBeTruthy();
    expect(screen.getByText(/Gen\. Rodin holds this theater/)).toBeTruthy();
  });

  it("tells a seatless reader who does order offensives here", () => {
    render(<ConflictRecord conflict={{ ...base, chain: { ...chain, role: "belligerent" } }} />);
    expect(screen.getByText("HOW THIS FRONT IS MOVED")).toBeTruthy();
    expect(screen.getByText(/no Theater Commander is designated at this front/)).toBeTruthy();
  });

  it("gives a Commanding General the posting lever at the front it applies to", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          chain: { ...chain, role: "commandingGeneral", roleLabel: "Commanding General" },
          employ: {
            countryCode: "us",
            theaterId: "front-1",
            generals: [{ id: "g1", name: "Gen. A. Sokolova", divisions: 3, men: "22,600" }],
            ownAssignments: [],
          },
        }}
      />
    );
    expect(screen.getByText("EMPLOY YOUR COMMAND")).toBeTruthy();
    expect(screen.getByRole("button", { name: /post here/i })).toBeTruthy();
    // Designating a general who is not at this front is meaningless, so it is
    // refused rather than offered and then rejected by the route.
    expect(screen.getByRole("button", { name: /designate/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("None designated")).toBeTruthy();
  });

  // The chain panel's "Who is posted here" link scrolls to this roster. It used to
  // point at /world/conflicts/generals, which has no page and answered 404.
  it("answers who is posted here for a seat in a live war", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          postedHere: [
            {
              id: "g1",
              name: "Gen. Rodin",
              rank: "General",
              divisions: 2,
              inCharge: true,
              isViewer: false,
            },
          ],
        }}
      />
    );
    expect(screen.getByText(/POSTED AT THIS FRONT/)).toBeTruthy();
    expect(screen.getByText("Gen. Rodin")).toBeTruthy();
  });

  // Guards the 404 class this branch fixed: the chain panel's link has to resolve
  // to something. An in-page anchor is a plain <a>, not a route.
  it("links the chain panel's roster handoff at the roster on this page", () => {
    render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          chain: {
            ...chain,
            role: "postedGeneral",
            handoffs: [
              {
                what: "Declare an offensive at this front",
                who: "Gen. Rodin, the Theater Commander designated for this conflict.",
                href: "#posted-here",
                linkLabel: "Who is posted here",
              },
            ],
          },
          postedHere: [
            {
              id: "g1",
              name: "Gen. Rodin",
              rank: "General",
              divisions: 2,
              inCharge: true,
              isViewer: false,
            },
          ],
        }}
      />
    );
    const link = screen.getByRole("link", { name: /who is posted here/i });
    expect(link.getAttribute("href")).toBe("#posted-here");
    expect(document.querySelector("#posted-here")).toBeTruthy();
  });

  it("withholds the roster from a reader who holds no seat", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.queryByText(/POSTED AT THIS FRONT/)).toBeNull();
  });
});

describe("ConflictRecord coalition rules", () => {
  it("warns that posting units here commits you to the war", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.getByText(/commits your country to this war/i)).toBeTruthy();
    expect(screen.getByText(/defend it automatically/i)).toBeTruthy();
  });

  // Once your units have fought, the warning is no longer a warning — the
  // commitment has been incurred and the only exits are victory or a settlement.
  it("states the commitment as already incurred once your units have fought", () => {
    render(<ConflictRecord conflict={{ ...base, committedCountry: "US", committedDead: 14206 }} />);
    expect(screen.getByText("US IS COMMITTED")).toBeTruthy();
    expect(screen.getByText(/14,206 of your men have died at this front/)).toBeTruthy();
    expect(screen.queryByText(/commits your country to this war/i)).toBeNull();
  });

  it("does not claim dead a committed nation has not lost", () => {
    render(<ConflictRecord conflict={{ ...base, committedCountry: "US", committedDead: 0 }} />);
    expect(screen.getByText(/No one of yours has died here yet/)).toBeTruthy();
  });

  it("lists every belligerent in an engagement, not just two", () => {
    const coalition: ConflictRecordView = {
      ...base,
      battles: [{ ...base.battles[0], attackers: ["US", "UK"], defenders: ["CN", "RU"] }],
    };
    render(<ConflictRecord conflict={coalition} />);
    expect(screen.getByText(/US, UK → CN, RU/)).toBeTruthy();
  });
});

describe("ConflictRecord war goal", () => {
  it("states what the war was declared for", () => {
    render(<ConflictRecord conflict={{ ...base, warGoal: "Punitive" }} />);
    expect(screen.getByText(/declared for Punitive/)).toBeTruthy();
  });

  it("says nothing for a conflict that predates declarations", () => {
    // Seeded and event-created wars carry no goal; printing "Undeclared" at a
    // player would be worse than saying nothing.
    render(<ConflictRecord conflict={base} />);
    expect(screen.queryByText(/declared for/)).toBeNull();
  });
});

describe("separate peace on the record", () => {
  const settled: ConflictRecordView = {
    ...base,
    settlements: [
      {
        id: "o1",
        leaver: "UK",
        other: "CN",
        term: { kind: "indemnity" as const, payer: "UK" as const, amount: 5000 },
        justification: "We could not sustain the campaign.",
        turn: 90,
      },
    ],
  };

  it("says who left, when, and who they settled with", () => {
    render(<ConflictRecord conflict={settled} />);
    expect(screen.getByText(/UK left the war on turn 90, settling with CN/)).toBeTruthy();
  });

  it("shows the indemnity and who paid it", () => {
    const { container } = render(<ConflictRecord conflict={settled} />);
    expect(container.textContent).toMatch(/UK paid an indemnity of 5,000/);
  });

  it("uses no em dash or en dash in the settlement line", () => {
    // Project-wide rule for player-facing copy. Scoped to the settlement line
    // deliberately: other copy in this component predates the rule and is not
    // this change's to rewrite.
    render(<ConflictRecord conflict={settled} />);
    const line = screen.getByText(/UK left the war on turn 90/);
    expect(line.textContent ?? "").not.toMatch(/[—–]/);
  });

  it("describes a regime change settlement", () => {
    const regime: ConflictRecordView = {
      ...settled,
      settlements: [
        {
          ...settled.settlements![0],
          term: { kind: "regime_change" as const, targetSystem: "presidential" as const },
        },
      ],
    };
    const { container } = render(<ConflictRecord conflict={regime} />);
    expect(container.textContent).toMatch(/government fell/);
  });

  it("describes a demilitarisation settlement in turns", () => {
    const demil: ConflictRecordView = {
      ...settled,
      settlements: [
        { ...settled.settlements![0], term: { kind: "demilitarisation" as const, turns: 240 } },
      ],
    };
    const { container } = render(<ConflictRecord conflict={demil} />);
    expect(container.textContent).toMatch(/frozen for 240 turns/);
  });

  it("publishes the justification, so the war's history says WHY it ended", () => {
    render(<ConflictRecord conflict={settled} />);
    expect(screen.getByText(/We could not sustain the campaign\./)).toBeTruthy();
  });

  it("calls a zero indemnity a white peace", () => {
    const white: ConflictRecordView = {
      ...settled,
      settlements: [
        {
          ...settled.settlements![0],
          term: { kind: "indemnity" as const, payer: "UK" as const, amount: 0 },
        },
      ],
    };
    const { container } = render(<ConflictRecord conflict={white} />);
    expect(container.textContent).toMatch(/a white peace/i);
  });

  it("renders no settlement section on a war nobody has settled", () => {
    render(<ConflictRecord conflict={base} />);
    expect(screen.queryByText(/SEPARATE PEACE/)).toBeNull();
  });
});

describe("ConflictRecord — coalition engagements", () => {
  /** The live T420 shape: DD and RU attacked US together. */
  const coalitionBattle = {
    ...base.battles[0],
    turn: 420,
    declarer: "DD",
    target: "US",
    attackers: ["DD", "RU"],
    defenders: ["US"],
    attackerLosses: [
      { country: "DD", loss: 5360 },
      { country: "RU", loss: 10939 },
    ],
    defenderLosses: [{ country: "US", loss: 2313 }],
  };

  it("names all three belligerents' casualties, not two", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{ ...base, sideACountries: ["DD", "RU"], battles: [coalitionBattle] }}
      />
    );
    const row = container.querySelector("[data-battle]")!;
    expect(row.textContent).toMatch(/DD 5,360/);
    expect(row.textContent).toMatch(/RU 10,939/);
    expect(row.textContent).toMatch(/US 2,313/);
    // The bug: the coalition's whole loss printed under the principal's flag.
    expect(row.textContent).not.toMatch(/16,299/);
  });

  it("keeps showing both allies while still flagging the enemy roster as withheld", () => {
    const { container } = render(
      <ConflictRecord
        conflict={{
          ...base,
          tier: "command",
          ownSide: "A",
          sideACountries: ["DD", "RU"],
          battles: [
            {
              ...coalitionBattle,
              rostersWithheld: true,
              rosters: [
                {
                  country: "DD",
                  power: 1650,
                  units: [
                    { id: "d1", name: "1. Mot-Schützendivision", type: "Rifle", casualties: 5360 },
                  ],
                },
                {
                  country: "RU",
                  power: 3350,
                  units: [{ id: "r1", name: "3rd Guards Tank", type: "Tank", casualties: 10939 }],
                },
              ],
            },
          ],
        }}
      />
    );
    expect(container.textContent).toMatch(/3rd Guards Tank/);
    expect(container.textContent).toMatch(/Roster withheld/);
  });
});

describe("the dictate panel on a won war", () => {
  const dictate = {
    conflictId: "w1",
    countryCode: "uk",
    target: "TR",
    targetName: "Turkey",
    turnsLeft: 18,
  };

  it("is absent for a viewer the server did not authorize", () => {
    // The server returns null for everyone but the winning principal's negotiator,
    // so the losing side and the winning side's allies never see it.
    render(<ConflictRecord conflict={base} />);
    expect(screen.queryByText(/NAME YOUR TERMS/)).toBeNull();
  });

  it("offers every term to the country that won the war", () => {
    render(<ConflictRecord conflict={{ ...base, dictate }} />);
    expect(screen.getByText(/NAME YOUR TERMS/)).toBeTruthy();
    expect(screen.getByText("White peace")).toBeTruthy();
    expect(screen.getByText("Indemnity")).toBeTruthy();
    expect(screen.getByText("Regime change")).toBeTruthy();
    expect(screen.getByText("Demilitarisation")).toBeTruthy();
  });

  it("counts the window down in turns and names who it lands on", () => {
    render(<ConflictRecord conflict={{ ...base, dictate }} />);
    expect(screen.getByText(/closes in 18 turns/)).toBeTruthy();
    expect(screen.getByText(/Turkey has no ground left to hold/)).toBeTruthy();
  });

  it("offers a white peace, which records no victor at all", () => {
    render(<ConflictRecord conflict={{ ...base, dictate }} />);
    expect(screen.getByRole("button", { name: /Sign a white peace/ })).toBeTruthy();
    expect(screen.getByText("White peace")).toBeTruthy();
  });

  it("lets exactly one term be selected at a time", () => {
    // The payload is a discriminated union server-side; the radio group is what
    // makes that visible rather than merely enforced.
    render(<ConflictRecord conflict={{ ...base, dictate }} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
  });
});
