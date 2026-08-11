import { describe, it, expect } from "vitest";
import { canonicalTurnsForCycle, pickNextCanonicalCycle, turnToWallClock } from "./canonicalCycle";

describe("canonicalTurnsForCycle", () => {
  describe("house", () => {
    it("cycle 1 ends at end of LARP year 2022 (bootstrap)", () => {
      expect(canonicalTurnsForCycle({ electionType: "house", cycle: 1 })).toEqual({
        startTurn: 1,
        primaryEndTurn: 144,
        endTurn: 192,
      });
    });

    it("cycle N advances by 96 turns (2 game-years) per cycle", () => {
      expect(canonicalTurnsForCycle({ electionType: "house", cycle: 2 })).toEqual({
        startTurn: 192,
        primaryEndTurn: 240,
        endTurn: 288, // 2024
      });
      expect(canonicalTurnsForCycle({ electionType: "house", cycle: 3 })?.endTurn).toBe(384); // 2026
    });
  });

  describe("senate", () => {
    it.each([
      [1, 1, 288], // Class 1 → 2024
      [2, 1, 384], // Class 2 → 2026
      [3, 1, 192], // Class 3 → 2022
      [1, 2, 576], // Class 1 cycle 2 → +288
      [3, 2, 480], // Class 3 cycle 2 → 192 + 288
    ])("class %i cycle %i → endTurn %i", (senateClass, cycle, endTurn) => {
      const turns = canonicalTurnsForCycle({
        electionType: "senate",
        cycle,
        senateClass: senateClass as 1 | 2 | 3,
      });
      expect(turns?.endTurn).toBe(endTurn);
    });
  });

  describe("senate — BR Federal Senate (countryId-aware branch, #3791-style collision)", () => {
    // Brazil's Senate shares the literal "senate" electionType with the US
    // Senate (a countries.ts config collision), so it must NOT fall through to
    // the senateClass-keyed US math — it needs its own countryId branch riding
    // the `brSenate` anchor. brSenate=2022 for the default (2019-default) ctx,
    // same as brChamber, so cycle 1 → endOfYear(2022) = 192.
    it("cycle 1 uses the brSenate anchor, not a senateClass anchor", () => {
      const turns = canonicalTurnsForCycle({
        electionType: "senate",
        cycle: 1,
        countryId: "BR",
      });
      expect(turns?.endTurn).toBe(192);
    });

    it("cycle N advances by BR_SENATE_CYCLE_PERIOD_HOURS (192 turns / 4 game-years)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 2, countryId: "BR" })?.endTurn
      ).toBe(384);
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 3, countryId: "BR" })?.endTurn
      ).toBe(576);
    });

    it("ignores senateClass entirely — a stray senateClass on a BR call changes nothing", () => {
      const withClass = canonicalTurnsForCycle({
        electionType: "senate",
        cycle: 1,
        countryId: "BR",
        senateClass: 1,
      });
      const withoutClass = canonicalTurnsForCycle({
        electionType: "senate",
        cycle: 1,
        countryId: "BR",
      });
      expect(withClass).toEqual(withoutClass);
    });

    it("does not affect the US Senate's own senateClass-keyed schedule (no cross-country leak)", () => {
      // Same electionType, no countryId (or countryId "US") — must still resolve
      // via the pre-existing class math, unaffected by the BR branch.
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 1, senateClass: 1 })?.endTurn
      ).toBe(288);
      expect(
        canonicalTurnsForCycle({
          electionType: "senate",
          cycle: 1,
          senateClass: 1,
          countryId: "US",
        })?.endTurn
      ).toBe(288);
    });
  });

  describe("sangiin", () => {
    it.each([
      [1, 1, 171], // Class 1 cycle 1 → Jul 2022
      [2, 1, 315], // Class 2 cycle 1 → Jul 2025
      [1, 2, 459], // Class 1 cycle 2 → +288
      [2, 2, 603], // Class 2 cycle 2 → +288
      [1, 3, 747], // Class 1 cycle 3 → +576
    ])("class %i cycle %i → endTurn %i", (chamberClass, cycle, endTurn) => {
      const turns = canonicalTurnsForCycle({
        electionType: "sangiin",
        cycle,
        chamberClass: chamberClass as 1 | 2,
      });
      expect(turns?.endTurn).toBe(endTurn);
    });

    it("cycle N≥2 startTurn = endTurn − 144 (last half of 6-year term)", () => {
      const turns = canonicalTurnsForCycle({
        electionType: "sangiin",
        cycle: 3,
        chamberClass: 1,
      });
      expect(turns).toEqual({ startTurn: 603, primaryEndTurn: 675, endTurn: 747 });
    });
  });

  describe("shugiin snap shift", () => {
    it("without priorEndTurn uses bootstrap anchor", () => {
      expect(canonicalTurnsForCycle({ electionType: "shugiin", cycle: 2 })?.endTurn).toBe(480);
    });

    it("with priorEndTurn applies snap shift (priorEndTurn + 192)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "shugiin", cycle: 2, priorEndTurn: 300 })?.endTurn
      ).toBe(492);
    });
  });

  describe("commons snap shift", () => {
    it("without priorEndTurn uses bootstrap anchor (cycle 1 = 267 / July 2024)", () => {
      expect(canonicalTurnsForCycle({ electionType: "commons", cycle: 1 })?.endTurn).toBe(267);
    });

    it("with priorEndTurn applies snap shift (priorEndTurn + 240)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "commons", cycle: 4, priorEndTurn: 348 })?.endTurn
      ).toBe(588);
    });
  });

  describe("cn npcDelegate + peoplesCongress", () => {
    it("cycle 1 = end of 2023 = turn 240 (14th NPC) under 2019-default", () => {
      expect(canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 1 })?.endTurn).toBe(240);
      expect(canonicalTurnsForCycle({ electionType: "peoplesCongress", cycle: 1 })?.endTurn).toBe(
        240
      );
    });

    it("cycle N advances by 240 turns (5 game-years) per cycle", () => {
      expect(canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 2 })?.endTurn).toBe(480);
      expect(canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 3 })?.endTurn).toBe(720);
      expect(canonicalTurnsForCycle({ electionType: "peoplesCongress", cycle: 2 })?.endTurn).toBe(
        480
      );
    });
  });

  describe("unsupported types", () => {
    it("returns null for snap_* and unknown", () => {
      expect(canonicalTurnsForCycle({ electionType: "snap_commons", cycle: 1 })).toBeNull();
      expect(canonicalTurnsForCycle({ electionType: "snap_shugiin", cycle: 1 })).toBeNull();
      expect(canonicalTurnsForCycle({ electionType: "unknown", cycle: 1 })).toBeNull();
    });
  });

  describe("1991-default preset anchors", () => {
    const ctx1991 = { startingYear: 1991, preset: "1991-default" };

    it("US House cycle 1 = end of game-year 1992 = turn 96 (= (1992 − 1991 + 1) × 48)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "house", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(96);
    });

    it("US Senate Class 1 cycle 1 = end of 1994 (turn 192), Class 2 = end of 1996 (turn 288), Class 3 = end of 1992 (turn 96)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 1, senateClass: 1, ctx: ctx1991 })
          ?.endTurn
      ).toBe(192);
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 1, senateClass: 2, ctx: ctx1991 })
          ?.endTurn
      ).toBe(288);
      expect(
        canonicalTurnsForCycle({ electionType: "senate", cycle: 1, senateClass: 3, ctx: ctx1991 })
          ?.endTurn
      ).toBe(96);
    });

    it("US President cycle 1 = end of 1992 = turn 96", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "president", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(96);
    });

    it("UK Commons cycle 1 = week 27 of 1992 = turn 75 (= (1992 − 1991) × 48 + 27)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "commons", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(75);
    });

    it("JP Sangiin Class 1 cycle 1 = Jul 1992 = turn 75; Class 2 cycle 1 = Jul 1995 = turn 219", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "sangiin", cycle: 1, chamberClass: 1, ctx: ctx1991 })
          ?.endTurn
      ).toBe(75);
      expect(
        canonicalTurnsForCycle({ electionType: "sangiin", cycle: 1, chamberClass: 2, ctx: ctx1991 })
          ?.endTurn
      ).toBe(219);
    });

    it("JP Shugiin cycle 1 = end of 1993 = turn 144", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "shugiin", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(144);
    });

    it("DE Bundestag cycle 1 = end of 1994 = turn 192", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "bundestag", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(192);
    });

    it("CN NPC Delegate cycle 1 = end of 1993 = turn 144 (8th NPC)", () => {
      expect(
        canonicalTurnsForCycle({ electionType: "npcDelegate", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(144);
    });

    it("CN Provincial People's Congress shares the NPC cycle 1 anchor", () => {
      // Both fire on the same turn — provincial elections sync with NPC.
      expect(
        canonicalTurnsForCycle({ electionType: "peoplesCongress", cycle: 1, ctx: ctx1991 })?.endTurn
      ).toBe(144);
    });

    it("1991 anchors differ from 2019-default anchors by ~30 game-years", () => {
      // Pure sanity check: every family's cycle-1 endTurn under 2019-default
      // (with STARTING_YEAR=2019, real years 2022/2024/etc.) is ≥ 28 game-years
      // (≥ 1344 turns) AHEAD of the corresponding 1991-default endTurn.
      const t1991 = canonicalTurnsForCycle({ electionType: "house", cycle: 1, ctx: ctx1991 })!;
      const t2019 = canonicalTurnsForCycle({ electionType: "house", cycle: 1 })!; // default ctx
      // 2019 = 192, 1991 = 96 → delta 96 turns = 2 game-years (House every 2y).
      // 1991-house is in 1992, 2019-house is in 2022. Calendar gap = 30 years
      // but cycle-1 anchors differ by only 96 turns (2 years) because both
      // anchor to the SAME real-year of "post-bootstrap-skip" mid-term.
      expect(t2019.endTurn - t1991.endTurn).toBe(96);
    });
  });
});

describe("pickNextCanonicalCycle — 24h+24h gate", () => {
  it("returns cycle N+1 when its window fully satisfies the gate", () => {
    const result = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 2,
      currentTurn: 290,
    });
    // Canonical Class 1 cycle 3: startTurn=603, primaryEndTurn=675, endTurn=747.
    // At currentTurn=290 (well before canonical start), full 72h primary + 72h general remain.
    expect(result).toEqual({ cycle: 3, startTurn: 603, primaryEndTurn: 675, endTurn: 747 });
  });

  it("skips a cycle whose remaining primary would be < 24h", () => {
    // Sangiin Class 1 cycle 2: primaryEndTurn=387, endTurn=459.
    // currentTurn=368 leaves 19h primary — fails gate, skip to cycle 3.
    const result = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 1,
      currentTurn: 368,
    });
    expect(result?.cycle).toBe(3);
    expect(result?.endTurn).toBe(747);
  });

  it("skips a cycle whose remaining general would be < 24h", () => {
    // Sangiin Class 1 cycle 2: endTurn=459.
    // currentTurn=438 leaves 21h general — fails gate, skip to cycle 3.
    const result = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 1,
      currentTurn: 438,
    });
    expect(result?.cycle).toBe(3);
  });

  it("respects the custom minPrimaryHours override", () => {
    // With minPrimaryHours=48 and currentTurn=348 (39h primary left on cycle 2), must skip.
    const withDefault = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 1,
      currentTurn: 348,
    });
    const withFloor = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 1,
      currentTurn: 348,
      minPrimaryHours: 48,
    });
    expect(withDefault?.cycle).toBe(2); // 39h ≥ 24h default
    expect(withFloor?.cycle).toBe(3); // 39h < 48h, skip
  });

  it("returns null when walk exceeds maxSkip without finding a valid cycle", () => {
    const result = pickNextCanonicalCycle({
      electionType: "sangiin",
      chamberClass: 1,
      prevCycle: 0,
      currentTurn: 100_000, // far future, nothing within 20 cycles satisfies gate
    });
    expect(result).toBeNull();
  });

  it("preserves LARP schedule against admin acceleration (cycle formula, not prev.endTurn)", () => {
    // Regardless of how early prev ended, cycle N+1 is anchored canonically.
    const r1 = pickNextCanonicalCycle({
      electionType: "commons",
      prevCycle: 1,
      currentTurn: 5, // prev ended just 5 turns ago (admin accelerated)
    });
    expect(r1?.endTurn).toBe(507); // 267 + 240 — canonical cycle 2, not 5 + 240
  });

  it("applies snap shift when priorEndTurn is passed explicitly", () => {
    const r = pickNextCanonicalCycle({
      electionType: "commons",
      prevCycle: 3,
      currentTurn: 350,
      priorEndTurn: 348, // snap ended turn 348
    });
    expect(r?.endTurn).toBe(588); // 348 + 240
  });

  describe("holyrood / senedd (devolved standup, 2019-default)", () => {
    it("cycle 1 is a fixed-length window ending at the canonical year (2021 → 144), not the turn-1 bootstrap", () => {
      // endOfYear(2021, 2019) = (2021 − 2019 + 1) × 48 = 144; durationHours 48 →
      // startTurn 96. Devolved chambers stand up at secession, so cycle 1 must NOT
      // anchor filing to turn 1 (that read as a stale game-long "active" race).
      expect(canonicalTurnsForCycle({ electionType: "holyrood", cycle: 1 })).toEqual({
        startTurn: 96,
        primaryEndTurn: 120,
        endTurn: 144,
      });
      expect(canonicalTurnsForCycle({ electionType: "senedd", cycle: 1 })?.endTurn).toBe(144);
    });

    it("advances by 240 turns (5 game-years) per cycle", () => {
      expect(canonicalTurnsForCycle({ electionType: "holyrood", cycle: 2 })?.endTurn).toBe(384);
      expect(canonicalTurnsForCycle({ electionType: "senedd", cycle: 3 })?.endTurn).toBe(624);
    });

    it("a snap shifts the anchor forward by one cycle", () => {
      const r = canonicalTurnsForCycle({ electionType: "holyrood", cycle: 2, priorEndTurn: 300 });
      expect(r?.endTurn).toBe(540); // 300 + 240
    });
  });
});

describe("turnToWallClock", () => {
  it("converts LARP turn to wall-clock relative to currentTurn's ref", () => {
    const ref = new Date("2026-04-21T03:00:00Z");
    const currentTurn = 242;
    // turn 555 is 313 hours ahead of turn 242
    expect(turnToWallClock(555, ref, currentTurn).toISOString()).toBe(
      new Date(ref.getTime() + 313 * 3_600_000).toISOString()
    );
    // Past turn: turn 100 is 142 hours behind turn 242
    expect(turnToWallClock(100, ref, currentTurn).toISOString()).toBe(
      new Date(ref.getTime() - 142 * 3_600_000).toISOString()
    );
  });
});

describe("NG concurrent general election (1991-default)", () => {
  const ctx = { startingYear: 1991, preset: "1991-default" };
  const types = ["president", "house", "senate", "governor"] as const;

  it("anchors all four NG general races to end of 1993 (turn 144), concurrently", () => {
    const ends = types.map(
      (electionType) =>
        canonicalTurnsForCycle({ electionType, cycle: 1, countryId: "NG", ctx })?.endTurn
    );
    expect(ends).toEqual([144, 144, 144, 144]);
  });

  it("cycle 2 = end of 1997 (turn 336) for NG president", () => {
    expect(
      canonicalTurnsForCycle({ electionType: "president", cycle: 2, countryId: "NG", ctx })?.endTurn
    ).toBe(336);
  });

  it("routes NG regionalCouncil to the concurrent general turn (same as house)", () => {
    const rc = canonicalTurnsForCycle({
      electionType: "regionalCouncil",
      cycle: 1,
      countryId: "NG",
      ctx,
    });
    const house = canonicalTurnsForCycle({ electionType: "house", cycle: 1, countryId: "NG", ctx });
    expect(rc?.endTurn).toBe(house?.endTurn);
    expect(rc?.endTurn).toBe(144);
  });

  it("leaves the US (no countryId) president on its own anchor (turn 96 = 1992)", () => {
    expect(canonicalTurnsForCycle({ electionType: "president", cycle: 1, ctx })?.endTurn).toBe(
      (1992 - 1991 + 1) * 48
    ); // 96 — unchanged
  });
});

describe("RU delegate cycles (D3/D11)", () => {
  const ctx1953 = { startingYear: 1953, preset: "1953-default" };
  const ctx1979 = { startingYear: 1979, preset: "1979-default" };

  it.each(["supremeSovietDeputy", "nationalitiesDeputy"] as const)(
    "%s: cycle 1 ends turn 96 (LARP 1954), cycle 2 turn 288 (LARP 1958)",
    (electionType) => {
      expect(canonicalTurnsForCycle({ electionType, cycle: 1, ctx: ctx1953 })?.endTurn).toBe(96);
      expect(canonicalTurnsForCycle({ electionType, cycle: 2, ctx: ctx1953 })?.endTurn).toBe(288);
    }
  );

  it("both national chambers share one anchor — same endTurn every cycle", () => {
    for (const cycle of [1, 2, 3]) {
      expect(
        canonicalTurnsForCycle({ electionType: "supremeSovietDeputy", cycle, ctx: ctx1979 })
          ?.endTurn
      ).toBe(
        canonicalTurnsForCycle({ electionType: "nationalitiesDeputy", cycle, ctx: ctx1979 })
          ?.endTurn
      );
    }
  });

  it("republic soviets anchor 1955 under 1953-default (turn 144)", () => {
    expect(
      canonicalTurnsForCycle({ electionType: "republicSupremeSoviet", cycle: 1, ctx: ctx1953 })
        ?.endTurn
    ).toBe(144);
  });

  it("returns null under presets with no USSR", () => {
    for (const preset of ["2019-default", "1991-default"]) {
      const ctx = { startingYear: 2019, preset };
      for (const electionType of [
        "supremeSovietDeputy",
        "nationalitiesDeputy",
        "republicSupremeSoviet",
      ]) {
        expect(
          canonicalTurnsForCycle({ electionType, cycle: 1, ctx }),
          `${preset} ${electionType}`
        ).toBeNull();
      }
    }
  });
});

describe("RU First Secretary governor override (D10)", () => {
  const ctx1953 = { startingYear: 1953, preset: "1953-default" };

  it("RU governor races anchor to ruRepublicSoviet (turn 144 under 1953-default)", () => {
    expect(
      canonicalTurnsForCycle({ electionType: "governor", countryId: "RU", cycle: 1, ctx: ctx1953 })
        ?.endTurn
    ).toBe(144);
  });

  it("RU governor races are era-gated OFF under presets with no USSR", () => {
    for (const preset of ["2019-default", "1991-default"]) {
      expect(
        canonicalTurnsForCycle({
          electionType: "governor",
          countryId: "RU",
          cycle: 1,
          ctx: { startingYear: 2019, preset },
        }),
        preset
      ).toBeNull();
    }
  });

  it("does not leak to other countries or to the shared stateSenate case", () => {
    const base = canonicalTurnsForCycle({ electionType: "governor", cycle: 1, ctx: ctx1953 });
    // UK passes countryId through ensureRegionalGovernorElections — must match countryless math.
    expect(
      canonicalTurnsForCycle({ electionType: "governor", countryId: "UK", cycle: 1, ctx: ctx1953 })
    ).toEqual(base);
    expect(
      canonicalTurnsForCycle({
        electionType: "stateSenate",
        countryId: "US",
        cycle: 1,
        ctx: ctx1953,
      })
    ).toEqual(base);
  });
});

describe("pickNextCanonicalCycle — pre-iteration founding branch", () => {
  const foundingCtx = { startingYear: 1991, preset: "1991-default", preIterationActive: true };

  it("returns a cycle-0 fixed 24h+24h window starting NOW (house)", () => {
    const s = pickNextCanonicalCycle({
      electionType: "house",
      prevCycle: 0,
      currentTurn: 1,
      ctx: foundingCtx,
    });
    // Fixed founding window: 24-turn primary + 24-turn general (NOT house's
    // 96-turn canonical term).
    expect(s).toEqual({ cycle: 0, startTurn: 1, primaryEndTurn: 25, endTurn: 49 });
  });

  it("seats ALL Senate classes together on the SAME fixed window (ignoring the stagger AND the 288-turn term)", () => {
    const mk = (senateClass: 1 | 2 | 3) =>
      pickNextCanonicalCycle({
        electionType: "senate",
        senateClass,
        prevCycle: 0,
        currentTurn: 1,
        ctx: foundingCtx,
      });
    const c1 = mk(1);
    const c2 = mk(2);
    const c3 = mk(3);
    // Same 24h+24h founding window as the house — every race resolves together.
    expect(c1).toEqual({ cycle: 0, startTurn: 1, primaryEndTurn: 25, endTurn: 49 });
    expect(c2).toEqual(c1);
    expect(c3).toEqual(c1); // no per-class stagger during founding — all seat at once
  });

  it("respects era-gates — a cycle era-gated OFF is not founded (ES 1953 Franco)", () => {
    const s = pickNextCanonicalCycle({
      electionType: "congresoDiputados",
      prevCycle: 0,
      currentTurn: 1,
      ctx: { startingYear: 1953, preset: "1953-default", preIterationActive: true },
    });
    expect(s).toBeNull();
    // Sanity: the same type IS founded in an era where Spain holds elections.
    const s1991 = pickNextCanonicalCycle({
      electionType: "congresoDiputados",
      prevCycle: 0,
      currentTurn: 1,
      ctx: { startingYear: 1991, preset: "1991-default", preIterationActive: true },
    });
    expect(s1991?.cycle).toBe(0);
  });

  it("is inert when the founding phase is not active (normal cycle-1)", () => {
    const s = pickNextCanonicalCycle({
      electionType: "house",
      prevCycle: 0,
      currentTurn: 1,
      ctx: { startingYear: 1991, preset: "1991-default" },
    });
    expect(s?.cycle).toBe(1);
    expect(s?.endTurn).toBe((1992 - 1991 + 1) * 48); // 96 — the historical anchor, not a founding window
  });
});
