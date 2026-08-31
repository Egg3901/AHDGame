import { describe, it, expect } from "vitest";
import { conflictTier, belligerentSideOf, type ViewerFacts } from "./conflictVisibility";
import type { ConflictSide } from "@/lib/db/types/conflict";
import { CONFLICT_ARCHIVE_DELAY_TURNS } from "./conflictLifecycle";

const west: ConflictSide = { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" };
const east: ConflictSide = { label: "PLA", countries: ["CN"], kind: "state", backer: "east" };

const facts = (over: Partial<ViewerFacts> = {}): ViewerFacts => ({
  status: "active",
  currentTurn: 100,
  side: null,
  isPostedGeneral: false,
  isDefenseHolder: false,
  isHeadOfGovernment: false,
  isCommandingGeneral: false,
  ...over,
});

/** A war resolved long enough ago that its fog has lifted. */
const opened = (over: Partial<ViewerFacts> = {}): ViewerFacts =>
  facts({
    status: "resolved",
    endTurn: 100,
    currentTurn: 100 + CONFLICT_ARCHIVE_DELAY_TURNS,
    ...over,
  });

/** A war resolved this turn: still under fog for the whole delay. */
const fogged = (over: Partial<ViewerFacts> = {}): ViewerFacts =>
  facts({ status: "resolved", endTurn: 100, currentTurn: 100, ...over });

describe("conflictTier", () => {
  it("gives everyone the archive once the fog window after resolution lapses", () => {
    expect(conflictTier(opened())).toBe("archive");
  });

  // Even a passer-by with no stake — the fog lifts for history.
  it("archives for a non-belligerent too", () => {
    expect(conflictTier(opened({ side: null }))).toBe("archive");
  });

  it("opens the archive on the exact turn the window lapses, not one before", () => {
    const opens = 100 + CONFLICT_ARCHIVE_DELAY_TURNS;
    expect(conflictTier(fogged({ currentTurn: opens - 1 }))).toBe("public");
    expect(conflictTier(fogged({ currentTurn: opens }))).toBe("archive");
  });

  // A war that just ended is exactly as fogged as a war still running: whatever the
  // losing side could not read yesterday, it cannot read today. Rivals have to wait
  // the full window before the rosters become history.
  it("keeps a freshly resolved war under live-war rules for a bystander", () => {
    expect(conflictTier(fogged())).toBe("public");
  });

  it("keeps a freshly resolved war under live-war rules for a belligerent citizen", () => {
    expect(conflictTier(fogged({ side: "A" }))).toBe("public");
  });

  it("keeps command sight of a freshly resolved war for a belligerent seat", () => {
    expect(conflictTier(fogged({ side: "A", isDefenseHolder: true }))).toBe("command");
    expect(conflictTier(fogged({ side: "B", isHeadOfGovernment: true }))).toBe("command");
  });

  // Only a document resolved before `endTurn` was stamped lacks it; those have been
  // an open record since the day they ended and must not go dark retroactively.
  it("archives a legacy resolved war with no endTurn at once", () => {
    expect(conflictTier(facts({ status: "resolved", currentTurn: 0 }))).toBe("archive");
  });

  it("never archives a war awaiting terms, however old", () => {
    expect(conflictTier(facts({ status: "terms_pending", endTurn: 0, currentTurn: 10_000 }))).toBe(
      "public"
    );
  });

  it("commands for a general posted to this conflict", () => {
    expect(conflictTier(facts({ side: "A", isPostedGeneral: true }))).toBe("command");
  });

  it("commands for the defense-seat holder", () => {
    expect(conflictTier(facts({ side: "A", isDefenseHolder: true }))).toBe("command");
  });

  it("commands for the head of government", () => {
    expect(conflictTier(facts({ side: "B", isHeadOfGovernment: true }))).toBe("command");
  });

  // An account flag is not a seat. Escalating for staff handed a citizen their
  // own side's order of battle under a panel calling them a citizen — the page
  // contradicting itself on the one question it exists to answer.
  it("is public for a staff account holding no seat", () => {
    expect(conflictTier(facts({ side: "A" }))).toBe("public");
  });

  // The seat that decides which generals stand at this front, and which of them
  // holds the theater. Without command sight it made both calls blind — posting
  // a general into a battle whose order of battle it could not read.
  it("commands for a Commanding General of a belligerent", () => {
    expect(conflictTier(facts({ side: "B", isCommandingGeneral: true }))).toBe("command");
  });

  it("is public for a belligerent citizen holding no role", () => {
    expect(conflictTier(facts({ side: "A" }))).toBe("public");
  });

  // The role only counts for a country actually in the war — otherwise the UK's
  // defence secretary would read the US order of battle at any West-backed front.
  it("is public for a role-holder whose country is not a belligerent", () => {
    expect(conflictTier(facts({ side: null, isDefenseHolder: true }))).toBe("public");
    expect(conflictTier(facts({ side: null, isPostedGeneral: true }))).toBe("public");
    expect(conflictTier(facts({ side: null, isHeadOfGovernment: true }))).toBe("public");
    expect(conflictTier(facts({ side: null, isCommandingGeneral: true }))).toBe("public");
  });

  it("is public for a bystander", () => {
    expect(conflictTier(facts())).toBe("public");
  });
});

describe("belligerentSideOf", () => {
  const c = { sideA: west, sideB: east };

  it("finds an explicit member of either side", () => {
    expect(belligerentSideOf(c, "US")).toBe("A");
    expect(belligerentSideOf(c, "CN")).toBe("B");
  });

  // sideOf() falls back to a bloc match so battle resolution can decide who a
  // country fights for. Visibility must NOT: a West country that is not on the
  // roster has no claim on NATO's order of battle.
  it("does not fall back to a bloc match the way sideOf does", () => {
    expect(belligerentSideOf(c, "UK")).toBeNull();
  });

  it("returns null for an unrelated country", () => {
    expect(belligerentSideOf(c, "BR")).toBeNull();
  });

  it("returns null when a side has no state members", () => {
    const generated = { sideA: { ...west, countries: [] }, sideB: east };
    expect(belligerentSideOf(generated, "US")).toBeNull();
  });
});
