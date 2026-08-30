import { describe, it, expect } from "vitest";
import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";
import { CONFLICT_ARCHIVE_DELAY_TURNS } from "@/lib/military/conflictLifecycle";
import { toHistoricalConflictRow } from "./historyView";

const west: ConflictSide = { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" };
const east: ConflictSide = { label: "PLA", countries: ["CN"], kind: "state", backer: "east" };

function doc(over: Partial<ConflictDoc> = {}): ConflictDoc {
  return {
    _id: "c1",
    conflictId: 7,
    name: "Manchurian Front",
    hostCountry: "CN",
    region: "eas",
    type: "interstate",
    sideA: west,
    sideB: east,
    bloc: "contested",
    terrain: "Continental",
    severity: "HIGH",
    baseStrength: 470,
    supplyA: 60,
    supplyB: 60,
    terr: 1.0,
    infra: 60,
    enemyMix: ["armor"],
    intensity: 70,
    control: 100,
    controlStart: 50,
    status: "resolved",
    createdBy: "player",
    startTurn: 1,
    endTurn: 97,
    outcome: { winner: "B", note: "PLA took full control of CN." },
    ...over,
  } as ConflictDoc;
}

// The war ended on turn 97; the archive opens 480 turns later.
const opens = 97 + CONFLICT_ARCHIVE_DELAY_TURNS;
const opts = { startingYear: 1953, casualties: 12345, currentTurn: 100 };

describe("toHistoricalConflictRow", () => {
  it("carries the identity the card links on", () => {
    const row = toHistoricalConflictRow(doc(), opts);
    expect(row.id).toBe("c1");
    expect(row.conflictId).toBe(7);
    expect(row.name).toBe("Manchurian Front");
    expect(row.type).toBe("interstate");
    expect(row.region).toBe("East Asia");
    expect(row.sideA).toBe("NATO");
    expect(row.sideB).toBe("PLA");
  });

  // 48 turns a year: turn 1 is 1953, turn 97 is 1955. Joined with a word rather
  // than a dash, which player-facing copy may not carry.
  it("dates the war from its start to its end", () => {
    expect(toHistoricalConflictRow(doc(), opts).years).toBe("1953 to 1955");
  });

  it("honours the founding-phase calendar offset", () => {
    const row = toHistoricalConflictRow(doc({ startTurn: 214, endTurn: 262 }), {
      ...opts,
      preIterationTurns: 48,
    });
    expect(row.years).toBe("1956 to 1957");
  });

  it("names the winning side's victory", () => {
    expect(toHistoricalConflictRow(doc(), opts).outcome).toEqual({
      label: "PLA victory",
      side: "B",
    });
    expect(
      toHistoricalConflictRow(doc({ outcome: { winner: "A", note: "" } }), opts).outcome
    ).toEqual({ label: "NATO victory", side: "A" });
  });

  it("calls a stalemate a stalemate", () => {
    expect(
      toHistoricalConflictRow(doc({ outcome: { winner: "stalemate", note: "" } }), opts).outcome
    ).toEqual({ label: "Stalemate", side: null });
  });

  // A resolved war with no outcome is a legacy document; it still concluded.
  it("falls back to Concluded when no outcome was recorded", () => {
    expect(toHistoricalConflictRow(doc({ outcome: undefined }), opts).outcome).toEqual({
      label: "Concluded",
      side: null,
    });
  });

  it("formats cumulative casualties, or says there were no engagements", () => {
    expect(toHistoricalConflictRow(doc(), opts).deaths).toBe("12,345 casualties");
    expect(toHistoricalConflictRow(doc(), { ...opts, casualties: 0 }).deaths).toBe(
      "No engagements"
    );
  });

  it("says when the fog of war lifts while the window is still running", () => {
    expect(toHistoricalConflictRow(doc(), { ...opts, currentTurn: opens - 1 }).archive).toEqual({
      open: false,
      opensTurn: opens,
      // Turn 577 is twelve years in: 1953 + floor(576 / 48) = 1965.
      opensYear: 1965,
    });
  });

  it("marks the record open once the window has lapsed", () => {
    expect(toHistoricalConflictRow(doc(), { ...opts, currentTurn: opens }).archive).toEqual({
      open: true,
    });
  });

  // Resolved before `endTurn` was stamped: open since the day it ended, and dated
  // by what is known rather than pretending it is still running.
  it("treats a legacy resolved war with no endTurn as open and undated at the end", () => {
    const row = toHistoricalConflictRow(doc({ endTurn: undefined }), opts);
    expect(row.archive).toEqual({ open: true });
    expect(row.years).toBe("1953");
  });
});
