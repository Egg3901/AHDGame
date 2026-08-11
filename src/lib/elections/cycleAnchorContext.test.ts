import { describe, it, expect } from "vitest";
import { CANONICAL_REAL_ELECTION_YEARS_BY_PRESET, getCycleAnchors } from "./cycleAnchorContext";
import { RESET_PRESETS } from "@/lib/constants/historicalSeats";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";

describe("ngGeneral anchor", () => {
  it("1991-default anchors NG general to end of 1993 (turn 144)", () => {
    const a = getCycleAnchors({ startingYear: 1991, preset: "1991-default" });
    expect(a.ngGeneral).toBe((1993 - 1991 + 1) * 48); // 144
  });

  it("2019-default anchors NG general to end of 2023 (turn 240)", () => {
    const a = getCycleAnchors({ startingYear: 2019, preset: "2019-default" });
    expect(a.ngGeneral).toBe((2023 - 2019 + 1) * 48); // 240
  });
});

describe("1953-default preset anchors (sandbox-seed-audit-t101)", () => {
  // Regression test: before the "1953-default" entry existed in
  // CANONICAL_REAL_ELECTION_YEARS_BY_PRESET, getCycleAnchors() silently fell
  // back to the 2019-default real-election years (house: 2022, etc.) and
  // computed cycle-1 end turns using THOSE years against a startingYear of
  // 1953 — anchoring every election ~69 years in the future (house alone
  // came out to endTurn 3360, confirmed live in the audited sandbox). Every
  // election in a 1953-default world was consequently unreachable within
  // any realistic game length.
  const anchors = getCycleAnchors({ startingYear: 1953, preset: "1953-default" });
  // scoHolyrood/walSenedd are deliberately anchored to the real 1999 first
  // devolved-parliament election regardless of preset (pre-devolution eras
  // don't stand these up until Scotland/Wales secedes mid-game) — excluded
  // from the "reachable soon" check below, same as 1991-default's identical
  // 1999 anchors for these two fields.
  const PRE_DEVOLUTION_FIELDS = new Set(["scoHolyrood", "walSenedd"]);

  it("does NOT fall back to the 2019-default anchors", () => {
    const fallback = getCycleAnchors({ startingYear: 1953, preset: "2019-default" });
    expect(anchors.house).not.toBe(fallback.house);
    expect(anchors.house).toBeLessThan(fallback.house);
  });

  it("anchors the first House cycle to a reachable turn (1954 midterm)", () => {
    expect(anchors.house).toBe((1954 - 1953 + 1) * 48); // 96
  });

  it("keeps every cycle-1 anchor within the first decade of a 1953 world", () => {
    // 10 years * 48 turns/year = 480 — generous upper bound, still catches
    // any field that was missed and silently inherited a modern-era year.
    // `null` anchors are deliberate era-gates (ES 1953: Franco dictatorship,
    // no elections) — skipped here, asserted in the era-gate suite below.
    for (const [key, turn] of Object.entries(anchors)) {
      if (PRE_DEVOLUTION_FIELDS.has(key)) continue;
      if (turn == null) continue;
      expect(turn, `${key} anchor (${turn}) should be reachable within 10 years`).toBeLessThan(480);
    }
  });

  it("era-gates ES OFF in 1953 (Franco dictatorship — null anchor)", () => {
    expect(anchors.esCongreso).toBeNull();
  });
});

describe("beta parliamentary anchors (FR/IT/ES/SE/TR, #3239)", () => {
  it("1953-default anchors FR 1956 / IT 1958 / SE 1956 / TR 1954 (ES gated off)", () => {
    const a = getCycleAnchors({ startingYear: 1953, preset: "1953-default" });
    expect(a.frAssembly).toBe((1956 - 1953 + 1) * 48); // 192
    expect(a.itCamera).toBe((1958 - 1953 + 1) * 48); // 288
    expect(a.seRiksdag).toBe((1956 - 1953 + 1) * 48); // 192
    expect(a.trMeclis).toBe((1954 - 1953 + 1) * 48); // 96
    expect(a.esCongreso).toBeNull();
  });

  it("1991-default anchors FR 1993 / IT 1992 / ES 1993 / SE 1994 / TR 1995", () => {
    const a = getCycleAnchors({ startingYear: 1991, preset: "1991-default" });
    expect(a.frAssembly).toBe((1993 - 1991 + 1) * 48); // 144
    expect(a.itCamera).toBe((1992 - 1991 + 1) * 48); // 96
    expect(a.esCongreso).toBe((1993 - 1991 + 1) * 48); // 144
    expect(a.seRiksdag).toBe((1994 - 1991 + 1) * 48); // 192
    expect(a.trMeclis).toBe((1995 - 1991 + 1) * 48); // 240
  });

  it("2019-default anchors FR 2022 / IT 2022 / ES 2023 / SE 2022 / TR 2023", () => {
    const a = getCycleAnchors({ startingYear: 2019, preset: "2019-default" });
    expect(a.frAssembly).toBe((2022 - 2019 + 1) * 48); // 192
    expect(a.itCamera).toBe((2022 - 2019 + 1) * 48); // 192
    expect(a.esCongreso).toBe((2023 - 2019 + 1) * 48); // 240
    expect(a.seRiksdag).toBe((2022 - 2019 + 1) * 48); // 192
    expect(a.trMeclis).toBe((2023 - 2019 + 1) * 48); // 240
  });

  it("1979-default anchors ES to 1982 (post-Franco democracy) and no longer falls back to 2019 years", () => {
    const a = getCycleAnchors({ startingYear: 1979, preset: "1979-default" });
    expect(a.esCongreso).toBe((1982 - 1979 + 1) * 48); // 192
    expect(a.frAssembly).toBe((1981 - 1979 + 1) * 48); // 144
    expect(a.itCamera).toBe((1983 - 1979 + 1) * 48); // 240
    expect(a.seRiksdag).toBe((1982 - 1979 + 1) * 48); // 192
    expect(a.trMeclis).toBe((1983 - 1979 + 1) * 48); // 240
    // The whole preset now has real anchors (was silently 2019-fallback):
    const fallback = getCycleAnchors({ startingYear: 1979, preset: "2019-default" });
    expect(a.house).toBeLessThan(fallback.house);
    expect(a.house).toBe((1980 - 1979 + 1) * 48); // 96
  });

  it("keeps every 1979-default cycle-1 anchor within the first decade (except pre-devolution)", () => {
    const a = getCycleAnchors({ startingYear: 1979, preset: "1979-default" });
    for (const [key, turn] of Object.entries(a)) {
      if (key === "scoHolyrood" || key === "walSenedd") continue;
      if (turn == null) continue;
      expect(turn, `${key} anchor (${turn}) should be reachable within 10 years`).toBeLessThan(480);
    }
  });
});

describe("RU anchors (D1/D3/D11)", () => {
  it("1953-default anchors the 1954 Supreme Soviet and 1955 republic elections", () => {
    const anchors = getCycleAnchors({ startingYear: 1953, preset: "1953-default" });
    // endOfYear: (1954 - 1953 + 1) * 48 = 96 ; (1955 - 1953 + 1) * 48 = 144
    expect(anchors.ruSupremeSoviet).toBe(96);
    expect(anchors.ruRepublicSoviet).toBe(144);
  });

  it("1979-default skips the pre-start-adjacent 1979 election and anchors 1984 / 1980", () => {
    const anchors = getCycleAnchors({ startingYear: 1979, preset: "1979-default" });
    expect(anchors.ruSupremeSoviet).toBe((1984 - 1979 + 1) * 48);
    expect(anchors.ruRepublicSoviet).toBe((1980 - 1979 + 1) * 48);
  });

  it("2019-default and 1991-default era-gate RU elections OFF", () => {
    for (const preset of ["2019-default", "1991-default"]) {
      const anchors = getCycleAnchors({ startingYear: 2019, preset });
      expect(anchors.ruSupremeSoviet, preset).toBeNull();
      expect(anchors.ruRepublicSoviet, preset).toBeNull();
    }
  });

  it("2023-default era-gates RU elections OFF (post-dissolution)", () => {
    const anchors = getCycleAnchors({ startingYear: 2023, preset: "2023-default" });
    expect(anchors.ruSupremeSoviet).toBeNull();
    expect(anchors.ruRepublicSoviet).toBeNull();
  });
});

describe("2023-default preset anchors (era-keying gap)", () => {
  // Regression: "2023-default" is a live RESET_PRESET but was missing from
  // CANONICAL_REAL_ELECTION_YEARS_BY_PRESET, so getCycleAnchors() fell back to
  // the 2019-default real-election years computed against a startingYear of
  // 2023 — producing turn-0 / negative cycle-1 endTurns (house 2022 →
  // (2022-2023+1)*48 = 0, jpSangiin 2022 → week27 = -21), i.e. elections that
  // fire immediately / are already over on turn 1. This is the "some nations
  // have an election right away" symptom for the 2023 era.
  const anchors = getCycleAnchors({ startingYear: 2023, preset: "2023-default" });

  it("does NOT fall back to the 2019-default anchors", () => {
    const fallback = getCycleAnchors({ startingYear: 2023, preset: "2019-default" });
    expect(anchors.house).not.toBe(fallback.house);
    // The fallthrough produced house endTurn 0; the real anchor is positive.
    expect(fallback.house).toBe(0);
    expect(anchors.house).toBeGreaterThan(0);
  });

  it("anchors the first House cycle to the reachable 2024 general", () => {
    expect(anchors.house).toBe((2024 - 2023 + 1) * 48); // 96
  });

  it("staggers the Senate classes 2024 / 2026 / 2028", () => {
    expect(anchors.senateClass1).toBe((2024 - 2023 + 1) * 48); // 96
    expect(anchors.senateClass2).toBe((2026 - 2023 + 1) * 48); // 192
    expect(anchors.senateClass3).toBe((2028 - 2023 + 1) * 48); // 288
  });
});

describe("preIterationTurns anchor offset (founding re-stagger handoff)", () => {
  const OFFSET = 37; // arbitrary founding length

  it("shifts every anchor forward by exactly the offset", () => {
    const base = getCycleAnchors({ startingYear: 2019, preset: "2019-default" });
    const shifted = getCycleAnchors({
      startingYear: 2019,
      preset: "2019-default",
      preIterationTurns: OFFSET,
    });
    for (const [key, turn] of Object.entries(base)) {
      if (turn == null) {
        expect(shifted[key as keyof typeof shifted]).toBeNull();
        continue;
      }
      expect(shifted[key as keyof typeof shifted]).toBe(turn + OFFSET);
    }
  });

  it("preserves the Senate class stagger (relative spacing unchanged)", () => {
    const a = getCycleAnchors({
      startingYear: 2019,
      preset: "2019-default",
      preIterationTurns: OFFSET,
    });
    // 2019-default: class3 2022 (192), class1 2024 (288), class2 2026 (384) —
    // the 2/4/6-year stagger survives the offset (all shifted by the same 37).
    expect(a.senateClass3).toBe(192 + OFFSET);
    expect(a.senateClass1).toBe(288 + OFFSET);
    expect(a.senateClass2).toBe(384 + OFFSET);
    expect(a.senateClass1 - a.senateClass3).toBe(96); // 2 game-years
    expect(a.senateClass2 - a.senateClass1).toBe(96); // 2 game-years
  });

  it("is the identity when preIterationTurns is 0 / undefined", () => {
    const none = getCycleAnchors({ startingYear: 1991, preset: "1991-default" });
    const zero = getCycleAnchors({
      startingYear: 1991,
      preset: "1991-default",
      preIterationTurns: 0,
    });
    expect(zero).toEqual(none);
  });
});

describe("every RESET_PRESET has reachable, non-fallthrough cycle-1 anchors", () => {
  // Guard rail for the whole class of era-keying bugs (1953-audit-t101, the
  // 2023 gap above): any preset whose real-election years are missing from the
  // map silently inherits the 2019-default years, which — against a non-2019
  // startingYear — yields either far-future (69-year) or turn-0/negative
  // endTurns. This sweep makes adding a new RESET_PRESET without its anchor
  // entry fail loudly.
  const PRE_DEVOLUTION_FIELDS = new Set(["scoHolyrood", "walSenedd"]);

  for (const preset of RESET_PRESETS) {
    const id = preset.id;
    const startingYear = getStartingYearForPreset(id);

    it(`${id}: every anchor is reachable within the first decade`, () => {
      const anchors = getCycleAnchors({ startingYear, preset: id });
      for (const [key, turn] of Object.entries(anchors)) {
        if (PRE_DEVOLUTION_FIELDS.has(key)) continue;
        if (turn == null) continue; // deliberate era-gate (e.g. ES under Franco)
        expect(turn, `${id}.${key} anchor (${turn}) must be > 0`).toBeGreaterThan(0);
        expect(
          turn,
          `${id}.${key} anchor (${turn}) should be reachable within 10 years`
        ).toBeLessThan(480);
      }
    });

    // Presets whose era is NOT 2019 must have their own entry — otherwise they
    // fall through to the 2019 years. (2019-default / empty / 2019-no-parties
    // legitimately share the 2019 anchors and are skipped here.)
    if (startingYear !== 2019) {
      it(`${id}: has a dedicated anchor entry (no 2019 fallthrough)`, () => {
        expect(
          CANONICAL_REAL_ELECTION_YEARS_BY_PRESET[id],
          `${id} (startingYear ${startingYear}) is missing from CANONICAL_REAL_ELECTION_YEARS_BY_PRESET and will silently use the 2019 anchors`
        ).toBeDefined();
      });
    }
  }
});
