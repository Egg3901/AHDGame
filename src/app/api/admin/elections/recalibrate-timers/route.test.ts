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

  it("regionalCouncil cycle 3 with priorEndTurn 250 → 250 + 240 = 490", () => {
    expect(canonicalTurns(e("regionalCouncil", 3), 250)?.endTurn).toBe(490);
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
