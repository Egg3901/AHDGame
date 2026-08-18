import { describe, it, expect } from "vitest";
import { toConflictView, yearOfTurn } from "./conflictView";
import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";

const west: ConflictSide = { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" };
const east: ConflictSide = { label: "PLA", countries: ["CN"], kind: "state", backer: "east" };
const rebels: ConflictSide = { label: "Insurgents", countries: [], kind: "generated" };
const gov: ConflictSide = { label: "Government", countries: ["TR"], kind: "state" };

function doc(over: Partial<ConflictDoc> = {}): ConflictDoc {
  return {
    _id: "c1",
    conflictId: 1,
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
    control: 70,
    controlStart: 100,
    status: "active",
    createdBy: "seed",
    startTurn: 1,
    ...over,
  } as ConflictDoc;
}

const opts = { startingYear: 1953, casualties: 0 };

describe("toConflictView", () => {
  it("carries the identity fields straight through", () => {
    const v = toConflictView(doc(), opts);
    expect(v.id).toBe("c1");
    expect(v.name).toBe("Manchurian Front");
    expect(v.intensity).toBe(70);
  });

  it("dates an ongoing conflict from its start turn", () => {
    expect(toConflictView(doc({ startTurn: 1 }), opts).years).toBe("1953 – present");
    // 48 turns per year: turn 97 is two years in.
    expect(toConflictView(doc({ startTurn: 97 }), opts).years).toBe("1955 – present");
  });

  it("honors the founding-phase calendar offset", () => {
    // Live 1953 world: raw turn 214, preIterationTurns 48, status bar is 1956.
    // Without the clock this dates as 1957.
    const offset = { ...opts, preIterationTurns: 48 };
    expect(toConflictView(doc({ startTurn: 214 }), offset).years).toBe("1956 – present");
    expect(yearOfTurn(214, 1953, { preIterationTurns: 48 })).toBe(1956);
    expect(yearOfTurn(214, 1953)).toBe(1957);
  });

  it("closes the range for a resolved conflict", () => {
    const v = toConflictView(doc({ startTurn: 1, endTurn: 97, status: "resolved" }), opts);
    expect(v.years).toBe("1953 – 1955");
  });

  it("places an anchored host on the map", () => {
    const v = toConflictView(doc({ hostCountry: "CN" }), opts);
    expect(v.x).toBeGreaterThan(0);
    expect(v.x).toBeLessThan(100);
    expect(v.y).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(100);
  });

  // Every one of the 28 CountryIds currently has an anchor, so this is a DEFENSIVE
  // branch — COUNTRY_ANCHOR is a Record<string, …> and can drift behind the union.
  // Cast an unknown id to exercise it.
  it("leaves an unanchored host off the map", () => {
    const v = toConflictView(doc({ hostCountry: "ZZ" as never }), opts);
    expect(v.x).toBeNull();
    expect(v.y).toBeNull();
    expect(v.name).toBe("Manchurian Front"); // still a conflict, just unplotted
  });

  it("leans toward the side that holds ground, west-led", () => {
    // side A is West and holds 30% (control 70 = side B's share) → lean 70, East-ish.
    expect(toConflictView(doc({ sideA: west, sideB: east, control: 70 }), opts).lean).toBe(70);
  });

  it("mirrors the lean when side A is the eastern one", () => {
    expect(toConflictView(doc({ sideA: east, sideB: west, control: 70 }), opts).lean).toBe(30);
  });

  it("has no lean when neither side is backed", () => {
    const v = toConflictView(doc({ sideA: gov, sideB: rebels, bloc: "internal" }), opts);
    expect(v.lean).toBeNull();
  });

  it("orders the side labels west-first when backed", () => {
    const v = toConflictView(doc({ sideA: east, sideB: west }), opts);
    expect(v.west).toBe("NATO");
    expect(v.east).toBe("PLA");
  });

  it("keeps document order for an unbacked conflict", () => {
    const v = toConflictView(doc({ sideA: gov, sideB: rebels, bloc: "internal" }), opts);
    expect(v.west).toBe("Government");
    expect(v.east).toBe("Insurgents");
  });

  it("maps severity and status onto the board's rungs", () => {
    expect(toConflictView(doc({ severity: "HIGH" }), opts).sev).toBe("CRITICAL");
    expect(toConflictView(doc({ severity: "MEDIUM" }), opts).sev).toBe("MAJOR");
    expect(toConflictView(doc({ severity: "LOW" }), opts).sev).toBe("ACTIVE");
    expect(toConflictView(doc({ status: "winding_down" }), opts).sev).toBe("WINDING DOWN");
  });

  it("flags an escalating conflict", () => {
    expect(toConflictView(doc({ status: "escalating" }), opts).escalating).toBe(true);
    expect(toConflictView(doc({ status: "active" }), opts).escalating).toBe(false);
  });

  it("reports who holds the host", () => {
    const v = toConflictView(doc({ hostCountry: "CN", sideA: west, sideB: east }), opts);
    expect(v.status).toBe("NATO holds 30% of CN");
  });

  it("reports a split when the host is on neither side", () => {
    const v = toConflictView(
      doc({ hostCountry: "TR", sideA: west, sideB: east, control: 40 }),
      opts
    );
    expect(v.status).toContain("NATO 60%");
    expect(v.status).toContain("PLA 40%");
  });

  it("formats cumulative casualties", () => {
    expect(toConflictView(doc(), { ...opts, casualties: 12345 }).deaths).toBe("12,345 casualties");
  });

  it("says so when nothing has been fought", () => {
    expect(toConflictView(doc(), { ...opts, casualties: 0 }).deaths).toBe("No engagements");
  });
  it("carries the conflict's public number", () => {
    expect(toConflictView(doc({ conflictId: 4 }), opts).conflictId).toBe(4);
  });
});
