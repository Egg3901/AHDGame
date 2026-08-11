import { describe, it, expect } from "vitest";
import { getCycleAnchors, type CycleAnchorContext } from "./cycleAnchorContext";
import { pickNextCanonicalCycle } from "./canonicalCycle";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";

/**
 * The 1953 companion to `preIterationHandoff.test.ts` (which models 1991).
 * 1953 is the preset that now DEFAULTS to the founding phase, and it is the one
 * with the widest founding scope — the US, the UK, the Soviet Union, the GDR
 * and the whole Warsaw Pact all seat their first mandate in the same cycle-0
 * election. This walks that world through: founding spawn -> pinned date ->
 * completion offset -> handoff onto the real historical calendar.
 */
describe("pre-iteration founding lifecycle (1953-default, end to end)", () => {
  const startingYear = 1953;
  const preset = "1953-default";
  const activeCtx: CycleAnchorContext = { startingYear, preset, preIterationActive: true };

  /** Calendar year a race scheduled at `rawTurn` displays, given the offset. */
  const calYear = (rawTurn: number, offset: number) =>
    turnToGameMonth(calendarTurn(rawTurn, { preIterationTurns: offset }), startingYear).year;

  const found = (electionType: string, countryId?: string) =>
    pickNextCanonicalCycle({
      electionType,
      countryId: countryId as never,
      prevCycle: 0,
      currentTurn: 1,
      ctx: activeCtx,
    });

  // Every legislature the 1953 world is supposed to seat, by the electionType
  // its spawner uses. The Warsaw-Pact six are the regression this guards: they
  // are absent from the bootstrapGameWorld ensure* battery, so before the
  // founding sweep was driven off COUNTRY_ELECTION_PHASES they founded nothing.
  const WARSAW_PACT: Array<[string, string]> = [
    ["sejm", "PL"],
    ["chamberOfThePeople", "CS"],
    ["nationalAssembly", "HU"],
    ["grandNationalAssembly", "RO"],
    ["nationalAssembly", "BG"],
    ["federalAssembly", "YU"],
  ];

  const CORE: Array<[string, string]> = [
    ["house", "US"],
    ["senate", "US"],
    ["president", "US"],
    ["governor", "US"],
    ["stateSenate", "US"],
    ["commons", "UK"],
    ["supremeSovietDeputy", "RU"],
    ["nationalitiesDeputy", "RU"],
    ["volkskammerDeputy", "DD"],
    ["shugiin", "JP"],
    ["bundestag", "DE"],
    ["npcDelegate", "CN"],
    ["chamber", "BR"],
    ["dail", "IE"],
    ["assembleeNationale", "FR"],
    ["cameraDeputati", "IT"],
    ["riksdag", "SE"],
    ["milletMeclisi", "TR"],
  ];

  it("spawns a cycle-0 founding race for every 1953 legislature, all on the same window", () => {
    for (const [electionType, countryId] of [...CORE, ...WARSAW_PACT]) {
      const race = found(electionType, countryId);
      expect(race, `${countryId}/${electionType} should found`).not.toBeNull();
      expect(race!.cycle).toBe(0);
      // Identical fixed 24h primary + 24h general for every body, so staggered
      // classes seat together and the phase converges instead of waiting on the
      // US Senate's 288-turn term.
      expect(race!.startTurn).toBe(1);
      expect(race!.primaryEndTurn).toBe(25);
      expect(race!.endTurn).toBe(49);
    }
  });

  it("still respects era gates — Franco's Spain founds no Congreso in 1953", () => {
    expect(found("congresoDiputados", "ES")).toBeNull();
  });

  it("pins the date to 1953 for the whole founding phase", () => {
    for (const rawTurn of [1, 25, 48, 49]) {
      expect(
        turnToGameMonth(calendarTurn(rawTurn, { preIterationActive: true }), startingYear)
      ).toEqual({ year: 1953, month: 0 });
    }
  });

  it("completion offset lands the calendar back on the era start", () => {
    // detectPreIterationComplete stamps preIterationTurns = completedTurn - 1.
    // Every founding race ends at turn 49, so the phase completes on turn 49.
    const offset = 49 - 1;
    expect(calYear(49, offset)).toBe(1953);
    expect(calendarTurn(49, { preIterationTurns: offset })).toBe(1);
    // ...and the clock advances normally from there (48 turns = 1 game year).
    expect(calYear(49 + 48, offset)).toBe(1954);
  });

  it("hands off onto the real historical schedule after founding", () => {
    const offset = 48;
    const doneCtx: CycleAnchorContext = { startingYear, preset, preIterationTurns: offset };
    const anchors = getCycleAnchors(doneCtx);

    // US: 1954 midterm, then the 1956 Eisenhower re-election.
    expect(calYear(anchors.house, offset)).toBe(1954);
    expect(calYear(anchors.president, offset)).toBe(1956);
    // ...and the Senate stagger re-emerges on 1954 / 1956 / 1958.
    expect(calYear(anchors.senateClass3, offset)).toBe(1954);
    expect(calYear(anchors.senateClass1, offset)).toBe(1956);
    expect(calYear(anchors.senateClass2, offset)).toBe(1958);
    // UK: the 1955 general election. Cold-War bloc: 1954 Supreme Soviet and
    // 1954 Volkskammer — the founding mandate does not overwrite either.
    expect(calYear(anchors.ukCommons, offset)).toBe(1955);
    expect(calYear(anchors.ruSupremeSoviet!, offset)).toBe(1954);
    expect(calYear(anchors.ddVolkskammer!, offset)).toBe(1954);

    // The spawner produces cycle 1 (a real race) once the phase is over.
    const nextHouse = pickNextCanonicalCycle({
      electionType: "house",
      prevCycle: 0,
      currentTurn: 49,
      ctx: doneCtx,
    });
    expect(nextHouse?.cycle).toBe(1);
    expect(nextHouse?.endTurn).toBe(anchors.house);
  });
});
