import { describe, it, expect } from "vitest";
import {
  canonicalEndTurn,
  isElectionInPrimaryPhase,
  type ElectionData,
} from "./electionsAdminTypes";
import type { CycleAnchorContext } from "@/lib/elections/cycleAnchorContext";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";

/**
 * Client-side mirror of `canonicalCycle.ts`'s `canonicalTurnsForCycle` —
 * used by the admin recalibrate-timers UI to preview the canonical end
 * turn for an election without re-fetching the server. Must produce the
 * same end turns as the server helper, otherwise the admin preview
 * diverges from what the server would actually apply.
 *
 * These tests pin the mirror's per-type math under both presets so a
 * future canonical-cycle refactor that updates one path forgets the
 * other.
 */

const ctx2019: CycleAnchorContext = { startingYear: 2019, preset: "2019-default" };
const ctx1991: CycleAnchorContext = { startingYear: 1991, preset: "1991-default" };

function elem(
  partial: Partial<ElectionData> & { electionType: ElectionData["electionType"] }
): ElectionData {
  return {
    _id: "test",
    electionType: partial.electionType,
    state: partial.state ?? "TEST",
    cycle: partial.cycle ?? 1,
    status: partial.status ?? "active",
    candidateCount: partial.candidateCount ?? 0,
    countryId: partial.countryId,
    senateClass: partial.senateClass,
    chamberClass: partial.chamberClass,
    totalSeats: partial.totalSeats,
    startTime: partial.startTime,
    endTime: partial.endTime,
    primaryEndTime: partial.primaryEndTime,
    durationHours: partial.durationHours,
    primaryDurationHours: partial.primaryDurationHours,
  };
}

describe("canonicalEndTurn (2019-default)", () => {
  it("US House cycle 1 = end of 2022 = turn 192", () => {
    expect(canonicalEndTurn(elem({ electionType: "house", cycle: 1 }), null, ctx2019)).toBe(192);
  });

  it("US House cycle N advances by 96 turns per cycle", () => {
    expect(canonicalEndTurn(elem({ electionType: "house", cycle: 2 }), null, ctx2019)).toBe(288);
  });

  it("US Senate cycle 1 per class: 1→288, 2→384, 3→192", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "senate", senateClass: 1, cycle: 1 }), null, ctx2019)
    ).toBe(288);
    expect(
      canonicalEndTurn(elem({ electionType: "senate", senateClass: 2, cycle: 1 }), null, ctx2019)
    ).toBe(384);
    expect(
      canonicalEndTurn(elem({ electionType: "senate", senateClass: 3, cycle: 1 }), null, ctx2019)
    ).toBe(192);
  });

  it("US Governor + State Senate cycle 1 = turn 288 (2024)", () => {
    expect(canonicalEndTurn(elem({ electionType: "governor", cycle: 1 }), null, ctx2019)).toBe(288);
    expect(canonicalEndTurn(elem({ electionType: "stateSenate", cycle: 1 }), null, ctx2019)).toBe(
      288
    );
  });

  it("UK Commons cycle 1 = week 27 of 2024 = turn 267", () => {
    expect(canonicalEndTurn(elem({ electionType: "commons", cycle: 1 }), null, ctx2019)).toBe(267);
  });

  it("UK Commons with priorEndTurn (post-snap shift) returns priorEndTurn + 240", () => {
    expect(canonicalEndTurn(elem({ electionType: "commons", cycle: 3 }), 348, ctx2019)).toBe(588);
  });

  it("JP Shugiin cycle 1 = end of 2024 = turn 288", () => {
    expect(canonicalEndTurn(elem({ electionType: "shugiin", cycle: 1 }), null, ctx2019)).toBe(288);
  });

  it("JP Sangiin Class 1 cycle 1 = Jul 2022 = turn 171, Class 2 = Jul 2025 = turn 315", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "sangiin", chamberClass: 1, cycle: 1 }), null, ctx2019)
    ).toBe(171);
    expect(
      canonicalEndTurn(elem({ electionType: "sangiin", chamberClass: 2, cycle: 1 }), null, ctx2019)
    ).toBe(315);
  });

  it("DE Bundestag cycle 1 = end of 2024 = turn 288", () => {
    expect(canonicalEndTurn(elem({ electionType: "bundestag", cycle: 1 }), null, ctx2019)).toBe(
      288
    );
  });

  it("CN NPC Delegate cycle 1 = end of 2023 = turn 240 (14th NPC)", () => {
    expect(canonicalEndTurn(elem({ electionType: "npcDelegate", cycle: 1 }), null, ctx2019)).toBe(
      240
    );
  });

  it("CN Provincial People's Congress shares NPC cycle 1 anchor", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "peoplesCongress", cycle: 1 }), null, ctx2019)
    ).toBe(240);
  });

  it("CN NPC cycle N advances by 240 turns (5 game-years) per cycle", () => {
    expect(canonicalEndTurn(elem({ electionType: "npcDelegate", cycle: 2 }), null, ctx2019)).toBe(
      480
    );
    expect(
      canonicalEndTurn(elem({ electionType: "peoplesCongress", cycle: 3 }), null, ctx2019)
    ).toBe(720);
  });
});

describe("canonicalEndTurn (1991-default)", () => {
  it("US House cycle 1 = end of 1992 = turn 96", () => {
    expect(canonicalEndTurn(elem({ electionType: "house", cycle: 1 }), null, ctx1991)).toBe(96);
  });

  it("UK Commons cycle 1 = week 27 of 1992 = turn 75", () => {
    expect(canonicalEndTurn(elem({ electionType: "commons", cycle: 1 }), null, ctx1991)).toBe(75);
  });

  it("CN NPC Delegate cycle 1 = end of 1993 = turn 144 (8th NPC)", () => {
    expect(canonicalEndTurn(elem({ electionType: "npcDelegate", cycle: 1 }), null, ctx1991)).toBe(
      144
    );
  });

  it("CN Provincial People's Congress cycle 1 also = 144 under 1991", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "peoplesCongress", cycle: 1 }), null, ctx1991)
    ).toBe(144);
  });

  it("CN NPC cycle 2 under 1991-default = 144 + 240 = 384 (end of 1998, 9th NPC)", () => {
    expect(canonicalEndTurn(elem({ electionType: "npcDelegate", cycle: 2 }), null, ctx1991)).toBe(
      384
    );
  });

  it("DE Bundestag cycle 1 = end of 1994 = turn 192", () => {
    expect(canonicalEndTurn(elem({ electionType: "bundestag", cycle: 1 }), null, ctx1991)).toBe(
      192
    );
  });
});

describe("canonicalEndTurn — landtag per-Land staggered anchors", () => {
  // Landtag uses LANDTAG_CYCLE1_END_TURN_BY_LAND map; unknown Land falls
  // back to 288. Cycle period = 240.
  it("unknown Land falls back to anchor 288 for cycle 1", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "landtag", state: "UNKNOWN", cycle: 1 }), null, ctx2019)
    ).toBe(288);
  });

  it("landtag with priorEndTurn returns priorEndTurn + 240", () => {
    expect(
      canonicalEndTurn(elem({ electionType: "landtag", state: "UNKNOWN", cycle: 2 }), 300, ctx2019)
    ).toBe(540);
  });
});

describe("isElectionInPrimaryPhase", () => {
  const FAR_FUTURE = "2099-01-01T00:00:00Z";
  const FAR_PAST = "2000-01-01T00:00:00Z";

  it("is turn-first: currentTurn < primaryEndTurn ⇒ primary", () => {
    expect(isElectionInPrimaryPhase({ primaryEndTurn: 48 }, 21)).toBe(true);
    expect(isElectionInPrimaryPhase({ primaryEndTurn: 48 }, 48)).toBe(false);
    expect(isElectionInPrimaryPhase({ primaryEndTurn: 48 }, 60)).toBe(false);
  });

  it("turn field wins over wall-clock when both present", () => {
    // primaryEndTime is in the past (would say 'general' on wall-clock), but the
    // turn counter still has the primary open — the engine-aligned answer.
    expect(isElectionInPrimaryPhase({ primaryEndTurn: 48, primaryEndTime: FAR_PAST }, 21)).toBe(
      true
    );
  });

  it("falls back to wall-clock only when the turn field is absent", () => {
    expect(isElectionInPrimaryPhase({ primaryEndTime: FAR_FUTURE }, 21)).toBe(true);
    expect(isElectionInPrimaryPhase({ primaryEndTime: FAR_PAST }, 21)).toBe(false);
  });

  it("falls back to wall-clock when currentTurn is unavailable", () => {
    expect(isElectionInPrimaryPhase({ primaryEndTurn: 48, primaryEndTime: FAR_FUTURE }, null)).toBe(
      true
    );
  });

  it("returns false (general) when no primary bound exists", () => {
    expect(isElectionInPrimaryPhase({}, 21)).toBe(false);
    expect(isElectionInPrimaryPhase({}, null)).toBe(false);
  });
});

describe("canonicalEndTurn — cross-validation against server canonicalTurnsForCycle", () => {
  // The client mirror (canonicalEndTurn in this file) and the authoritative
  // server helper (canonicalTurnsForCycle in canonicalCycle.ts) MUST return
  // identical end-turn values for every supported election type, every
  // cycle, every preset. A divergence means the admin UI preview drifts
  // from what the server would actually apply on recalibration.
  //
  // This panel exercises a representative sample. If it fails after a
  // canonicalCycle.ts edit, the corresponding case in electionsAdminTypes
  // (or vice-versa) needs to be updated.
  const cases: Array<{
    label: string;
    el: Partial<ElectionData> & { electionType: ElectionData["electionType"] };
    ctx: CycleAnchorContext;
  }> = [
    { label: "house cycle 1 (2019)", el: { electionType: "house", cycle: 1 }, ctx: ctx2019 },
    { label: "house cycle 3 (2019)", el: { electionType: "house", cycle: 3 }, ctx: ctx2019 },
    { label: "house cycle 1 (1991)", el: { electionType: "house", cycle: 1 }, ctx: ctx1991 },
    {
      label: "senate class 1 cycle 1 (2019)",
      el: { electionType: "senate", senateClass: 1, cycle: 1 },
      ctx: ctx2019,
    },
    {
      label: "senate class 3 cycle 2 (1991)",
      el: { electionType: "senate", senateClass: 3, cycle: 2 },
      ctx: ctx1991,
    },
    { label: "governor cycle 1 (2019)", el: { electionType: "governor", cycle: 1 }, ctx: ctx2019 },
    {
      label: "president cycle 1 (2019)",
      el: { electionType: "president", cycle: 1 },
      ctx: ctx2019,
    },
    { label: "commons cycle 1 (2019)", el: { electionType: "commons", cycle: 1 }, ctx: ctx2019 },
    { label: "commons cycle 1 (1991)", el: { electionType: "commons", cycle: 1 }, ctx: ctx1991 },
    {
      label: "sangiin class 1 cycle 1 (2019)",
      el: { electionType: "sangiin", chamberClass: 1, cycle: 1 },
      ctx: ctx2019,
    },
    {
      label: "sangiin class 2 cycle 1 (1991)",
      el: { electionType: "sangiin", chamberClass: 2, cycle: 1 },
      ctx: ctx1991,
    },
    { label: "shugiin cycle 1 (2019)", el: { electionType: "shugiin", cycle: 1 }, ctx: ctx2019 },
    {
      label: "bundestag cycle 1 (1991)",
      el: { electionType: "bundestag", cycle: 1 },
      ctx: ctx1991,
    },
    {
      label: "npcDelegate cycle 1 (2019)",
      el: { electionType: "npcDelegate", cycle: 1 },
      ctx: ctx2019,
    },
    {
      label: "npcDelegate cycle 2 (1991)",
      el: { electionType: "npcDelegate", cycle: 2 },
      ctx: ctx1991,
    },
    {
      label: "peoplesCongress cycle 1 (2019)",
      el: { electionType: "peoplesCongress", cycle: 1 },
      ctx: ctx2019,
    },
  ];

  it.each(cases)("client and server agree on $label", ({ el, ctx }) => {
    const clientEnd = canonicalEndTurn(elem(el), null, ctx);
    const server = canonicalTurnsForCycle({
      electionType: el.electionType,
      cycle: el.cycle ?? 1,
      senateClass: (el.senateClass ?? null) as 1 | 2 | 3 | null,
      chamberClass: (el.chamberClass ?? null) as 1 | 2 | null,
      ctx,
    });
    expect(clientEnd).toBe(server?.endTurn ?? null);
  });
});

describe("canonicalEndTurn — null returns", () => {
  it("returns null for snap_* types (no canonical anchor)", () => {
    expect(canonicalEndTurn(elem({ electionType: "snap_commons", cycle: 1 }), null, ctx2019)).toBe(
      null
    );
    expect(canonicalEndTurn(elem({ electionType: "snap_shugiin", cycle: 1 }), null, ctx2019)).toBe(
      null
    );
    expect(
      canonicalEndTurn(elem({ electionType: "snap_bundestag", cycle: 1 }), null, ctx2019)
    ).toBe(null);
  });

  it("returns null when cycle is missing", () => {
    expect(
      canonicalEndTurn(
        { ...elem({ electionType: "house" }), cycle: 0 as unknown as number },
        null,
        ctx2019
      )
    ).toBe(null);
  });
});
