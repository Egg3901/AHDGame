import { ObjectId } from "mongodb";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turnSystem", () => ({
  getGameState: vi.fn(),
  ensurePerpetualElections: vi.fn(),
  ensureUKElections: vi.fn(),
  ensureUKRegionalCouncilElections: vi.fn(),
}));

import { canonicalTurns, shouldReactivatePrematureElection, effectiveStartTurn } from "./route";
import type { Election } from "@/lib/db/types";

function e(electionType: string, cycle: number, extras: Partial<Election> = {}): Election {
  return {
    _id: "eid",
    electionType,
    cycle,
    state: "ENG",
    countryId: "UK",
    status: "active",
    ...extras,
  } as unknown as Election;
}

describe("effectiveStartTurn — recalibrated active elections open immediately", () => {
  it("clamps a future canonical start to currentTurn so a recalibrated active election is open now", () => {
    // UK commons cycle 2 canonical startTurn=459; at currentTurn=300 the primary
    // would otherwise read as "upcoming" (turn-first) despite status:"active".
    expect(effectiveStartTurn(459, 300)).toBe(300);
  });

  it("keeps a past-or-equal canonical start unchanged (already open)", () => {
    expect(effectiveStartTurn(96, 114)).toBe(96);
    expect(effectiveStartTurn(300, 300)).toBe(300);
  });
});

describe("canonicalTurns — bootstrap anchors", () => {
  it("commons cycle 1 → 267 (July 2024)", () => {
    expect(canonicalTurns(e("commons", 1))?.endTurn).toBe(267);
  });

  it("commons cycle 2 → 267 + 240 = 507", () => {
    expect(canonicalTurns(e("commons", 2))?.endTurn).toBe(507);
  });

  it("shugiin cycle 1 → 288 (LARP year 2024)", () => {
    expect(canonicalTurns(e("shugiin", 1, { countryId: "JP" }))?.endTurn).toBe(288);
  });

  it("shugiin cycle 2 → 288 + 192 = 480", () => {
    expect(canonicalTurns(e("shugiin", 2, { countryId: "JP" }))?.endTurn).toBe(480);
  });
});

describe("canonicalTurns — snap-shifted anchors", () => {
  it("commons cycle 4 with priorEndTurn 300 → 300 + 240 = 540", () => {
    expect(canonicalTurns(e("commons", 4), 300)?.endTurn).toBe(540);
  });

  it("regionalCouncil cycle 3 ignores priorEndTurn and retains its cohort anchor", () => {
    expect(canonicalTurns(e("regionalCouncil", 3, { state: "SCO" }), 250)?.endTurn).toBe(795);
  });

  it("shugiin cycle 3 with priorEndTurn 500 → 500 + 192 = 692", () => {
    expect(canonicalTurns(e("shugiin", 3, { countryId: "JP" }), 500)?.endTurn).toBe(692);
  });

  it("house is NOT shifted by priorEndTurn (US is unaffected)", () => {
    expect(canonicalTurns(e("house", 3, { countryId: "US" }), 999)?.endTurn).toBe(192 + 2 * 96);
  });
});

describe("canonicalTurns — snap types return null", () => {
  it("snap_commons returns null", () => {
    expect(canonicalTurns(e("snap_commons", 3))).toBeNull();
  });
  it("snap_shugiin returns null", () => {
    expect(canonicalTurns(e("snap_shugiin", 3, { countryId: "JP" }))).toBeNull();
  });
});

// Regression: prior to the guard the route reactivated any prematurely-closed
// election back to "active", even ones whose resolution had actually run —
// leaving every withdrawn candidate stranded in an "active" race they could
// no longer be in. See heal script `scripts/migrations/healRecalibrateWithdrawals.ts`.
describe("shouldReactivatePrematureElection", () => {
  function gov(id: string, cycle: number, state: string, extras: Partial<Election> = {}): Election {
    return {
      _id: id,
      electionType: "governor",
      cycle,
      state,
      countryId: "US",
      status: "resolved",
      ...extras,
    } as unknown as Election;
  }
  const empty = new Set<string>();

  it("reactivates a premature election when nothing was resolved", () => {
    // governor cycle 1 canonical endTurn = 240, well past current turn 50
    expect(shouldReactivatePrematureElection(gov("a", 1, "PA"), 50, empty, empty)).toBe(true);
  });

  it("skips when a finalized vote tally exists (election already resolved)", () => {
    const finalized = new Set(["a"]);
    expect(shouldReactivatePrematureElection(gov("a", 1, "PA"), 50, finalized, empty)).toBe(false);
  });

  it("skips when the seat already has a sitting elected officeholder", () => {
    // Seat key format: officeType|state|senateClass|chamberClass — both class
    // fields empty for non-class offices like governor.
    const seated = new Set(["governor|PA||"]);
    expect(shouldReactivatePrematureElection(gov("a", 1, "PA"), 50, empty, seated)).toBe(false);
  });

  it("skips when canonical endTurn is already in the past (genuine end)", () => {
    // currentTurn way past canonical 240 — election ended on schedule
    expect(shouldReactivatePrematureElection(gov("a", 1, "PA"), 999, empty, empty)).toBe(false);
  });

  it("skips when election has no canonical schedule (snap types)", () => {
    const snap = { ...gov("a", 1, "ENG"), electionType: "snap_commons" } as Election;
    expect(shouldReactivatePrematureElection(snap, 50, empty, empty)).toBe(false);
  });

  it("matches the seat key including senateClass (US senate)", () => {
    const senateC1 = gov("a", 1, "MN", {
      electionType: "senate",
      senateClass: 1,
    } as Partial<Election>);
    const seatedC1 = new Set(["senate|MN|1|"]);
    const seatedC2 = new Set(["senate|MN|2|"]);
    expect(shouldReactivatePrematureElection(senateC1, 50, empty, seatedC1)).toBe(false);
    // Different class shouldn't block — they're different races at the same state.
    expect(shouldReactivatePrematureElection(senateC1, 50, empty, seatedC2)).toBe(true);
  });

  it("matches the seat key including chamberClass (JP sangiin staggered)", () => {
    // Sangiin Class 1 and Class 2 are distinct seats (see commit 29aafdad).
    // generalResolution writes electedOfficials with chamberClass for sangiin,
    // not senateClass — so the seat key must distinguish on chamberClass too,
    // or a Class 1 win would falsely block a premature Class 2 reactivation.
    const sangiinC1 = gov("a", 1, "TOH", {
      electionType: "sangiin",
      countryId: "JP",
      chamberClass: 1,
    } as Partial<Election>);
    const seatedSangiinC1 = new Set(["sangiin|TOH||1"]);
    const seatedSangiinC2 = new Set(["sangiin|TOH||2"]);
    expect(shouldReactivatePrematureElection(sangiinC1, 50, empty, seatedSangiinC1)).toBe(false);
    // Class 2 holding a seat shouldn't block Class 1 reactivation.
    expect(shouldReactivatePrematureElection(sangiinC1, 50, empty, seatedSangiinC2)).toBe(true);
  });
});

describe("Bulgarian native timer custody", () => {
  const ctx = { preset: "1991-default", startingYear: 1991 };
  it.each([0, 1, 4])("retains native ballot turn deadlines for cycle%i", (cycle) => {
    const election = e("nationalAssembly", cycle, {
      countryId: "BG",
      state: "BG-SOF",
      startTurn: 10,
      primaryEndTurn: 11,
      endTurn: 12,
      bulgarianFoundingRound: {
        ruleVersion: "parallel-1990-v1",
        receiptId: `BG:founding1990:${cycle}`,
        rootElectionId: "root",
        round: cycle ? 2 : 1,
        registeredVoters: 100000,
      },
    });
    expect(canonicalTurns(election, 999, ctx)).toEqual({
      startTurn: 10,
      primaryEndTurn: 11,
      endTurn: 12,
    });
  });
  it("retains decision-triggered and unadopted Grand schedules", () => {
    for (const endTurn of [86, 216, 278]) {
      expect(
        canonicalTurns(
          e("nationalAssembly", 1, {
            countryId: "BG",
            startTurn: endTurn - 6,
            primaryEndTurn: endTurn - 2,
            endTurn,
            shiftedScheduleEndTurn: endTurn,
          }),
          undefined,
          ctx
        )
      ).toEqual({ startTurn: endTurn - 6, primaryEndTurn: endTurn - 2, endTurn });
    }
  });
  it("leaves a malformed native clock untouched rather than inventing a deadline", () => {
    expect(
      canonicalTurns(
        e("nationalAssembly", 1, {
          countryId: "BG",
          startTurn: 10,
          primaryEndTurn: 14,
          endTurn: 12,
          shiftedScheduleEndTurn: 12,
        }),
        undefined,
        ctx
      )
    ).toBeNull();
  });
  it("retains the generic calendar for unmarked legacy ordinary polls", () => {
    expect(
      canonicalTurns(e("nationalAssembly", 1, { countryId: "BG" }), undefined, ctx)?.endTurn
    ).toBe(38);
  });
});

describe("Hungarian and Russian native timer custody", () => {
  const ctx = { preset: "1991-default", startingYear: 1991 };
  const families: Array<[string, Partial<Election>]> = [
    [
      "Hungarian first round",
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        hungarianAssemblyRound: {
          ruleVersion: "mixed-1989-v1",
          round: 1,
          receiptId: "HU:mixed1989:7",
          registeredVoters: 100,
        },
      },
    ],
    [
      "Hungarian runoff",
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        hungarianAssemblyRound: {
          ruleVersion: "mixed-1989-v1",
          round: 2,
          receiptId: "HU:mixed1989:7",
          registeredVoters: 100,
          rootElectionId: "root",
        },
      },
    ],
    [
      "Hungarian legacy vacancy",
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        hungarianAssemblyRound: {
          ruleVersion: "mixed-1989-v1",
          round: 1,
          receiptId: "vacancy",
          registeredVoters: 100,
          byElection: { parentReceiptId: "parent", districtIds: ["district"], generation: 1 },
        },
      },
    ],
    [
      "Hungarian modern round",
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        hungarianModernAssembly: {
          ruleVersion: "mixed-2011-v1",
          reason: "parliamentary_decision",
          authorizedOnTurn: 8,
        },
      },
    ],
    [
      "Hungarian modern vacancy",
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        hungarianModernByElection: {
          receiptId: "vacancy",
          parentReceiptId: "parent",
          districtId: "district",
          registeredVoters: 100,
        },
      },
    ],
    [
      "Russian first presidential round",
      {
        countryId: "RU",
        electionType: "president",
        russianPresidentialRound: { round: 1, mandateSinceTurn: 8, registeredVoters: 100 },
      },
    ],
    [
      "Russian presidential runoff",
      {
        countryId: "RU",
        electionType: "president",
        russianPresidentialRound: { round: 2, mandateSinceTurn: 8, registeredVoters: 100 },
      },
    ],
    [
      "Russian Duma constituency",
      {
        countryId: "RU",
        electionType: "dumaDeputy",
        russianDumaRound: {
          cohortId: new ObjectId(),
          mandateSinceTurn: 8,
          registeredVoters: 100,
          tier: "constituency",
          generation: 3,
        },
      },
    ],
    [
      "Russian Duma list",
      {
        countryId: "RU",
        electionType: "dumaDeputy",
        russianDumaRound: {
          cohortId: new ObjectId(),
          mandateSinceTurn: 8,
          registeredVoters: 100,
          tier: "list",
          electoralLaw: "law1995",
        },
      },
    ],
    [
      "Russian Council repeat",
      {
        countryId: "RU",
        electionType: "federationCouncilMember",
        russianCouncilRound: {
          cohortId: new ObjectId(),
          mandateSinceTurn: 8,
          registeredVoters: 100,
          districtNumber: 1,
          generation: 3,
        },
      },
    ],
  ];
  it.each(families)(
    "keeps %s bounds and never reactivates its completed poll",
    (_name, binding) => {
      const election = e(binding.electionType!, 9, {
        ...binding,
        startTurn: 20,
        primaryEndTurn: 20,
        endTurn: 22,
        status: "completed",
      });
      expect(canonicalTurns(election, 999, ctx)).toEqual({
        startTurn: 20,
        primaryEndTurn: 20,
        endTurn: 22,
      });
      expect(shouldReactivatePrematureElection(election, 10, new Set(), new Set(), ctx)).toBe(
        false
      );
    }
  );
  it.each(families)("skips malformed %s bounds without releasing custody", (_name, binding) => {
    const election = e(binding.electionType!, 9, {
      ...binding,
      startTurn: 20,
      primaryEndTurn: 24,
      endTurn: 22,
      status: "completed",
    });
    expect(canonicalTurns(election, undefined, ctx)).toBeNull();
    expect(shouldReactivatePrematureElection(election, 10, new Set(), new Set(), ctx)).toBe(false);
  });
  it.each([
    { startTurn: undefined },
    { primaryEndTurn: undefined },
    { endTurn: undefined },
    { startTurn: -1 },
    { startTurn: 1.5 },
    { primaryEndTurn: Number.NaN },
    { endTurn: Number.POSITIVE_INFINITY },
    { endTurn: Number.MAX_SAFE_INTEGER + 1 },
    { startTurn: 21, primaryEndTurn: 20 },
    { endTurn: 20 },
  ])("retains native custody with invalid bounds %j", (bounds) => {
    const election = e("president", 9, {
      countryId: "RU",
      status: "completed",
      startTurn: 20,
      primaryEndTurn: 20,
      endTurn: 22,
      ...bounds,
      russianPresidentialRound: { round: 2, mandateSinceTurn: 8, registeredVoters: 100 },
    });
    expect(canonicalTurns(election, undefined, ctx)).toBeNull();
    expect(shouldReactivatePrematureElection(election, 10, new Set(), new Set(), ctx)).toBe(false);
  });
  it("does not freeze an unrelated country or election type carrying a foreign marker", () => {
    const marker = { round: 1 as const, mandateSinceTurn: 8, registeredVoters: 100 };
    for (const election of [
      e("president", 1, { countryId: "US", russianPresidentialRound: marker }),
      e("governor", 1, { countryId: "RU", russianPresidentialRound: marker }),
    ]) {
      expect(canonicalTurns(election, undefined, ctx)?.endTurn).not.toBe(22);
    }
  });
  it.each(["1953-default", "1979-default", "2019-default", "2027-default"])(
    "retains generic calendar behavior for %s",
    (preset) => {
      const election = e("president", 1, {
        countryId: "RU",
        startTurn: 20,
        primaryEndTurn: 20,
        endTurn: 22,
        russianPresidentialRound: { round: 1, mandateSinceTurn: 8, registeredVoters: 100 },
      });
      expect(
        canonicalTurns(election, undefined, { preset, startingYear: Number(preset.slice(0, 4)) })
          ?.endTurn
      ).not.toBe(22);
    }
  );
});
