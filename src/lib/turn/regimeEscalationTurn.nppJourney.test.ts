/**
 * Connected regime journey for an autonomous (NPP) one-party leader (#3096).
 *
 * Drives the real escalation turn, decision queue and decision handlers over
 * many turns against stateful storage, with the leader carried as an NPP
 * reference and no player character anywhere. Only the convention, forced
 * conversion, faction split and history writers are stubbed: each has its own
 * suite, and none of them decides whether an NPP leader participates.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { LeaderReference } from "@/lib/government/leaderReference";
import { leaderStateId } from "@/lib/government/leaderReference";
import type { EscalationState, RegimeStage } from "@/lib/db/types/regimeEscalation";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

vi.mock("@/lib/onePartyState/constitutionalConvention", () => ({
  tickConventionPhase: vi.fn(async () => undefined),
}));
vi.mock("@/lib/onePartyState/systemConversion", () => ({
  checkForcedConversion: vi.fn(async () => undefined),
}));
vi.mock("@/lib/onePartyState/factionSplit", () => ({
  fireFactionSplit: vi.fn(async () => null),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn(async () => undefined),
}));

import "@/lib/onePartyState/decisionEvents";
import { processRegimeEscalationTurn } from "./regimeEscalationTurn";
import { resolveActiveDecision } from "@/lib/onePartyState/decisionQueue";
import { STAGE_THRESHOLDS } from "./regimeEscalation";

const nppId = new ObjectId();
const leader: LeaderReference = { kind: "npp", id: nppId };
const leaderRowId = leaderStateId("CN", leader);

function seedLeaderState(db: InMemoryDb, popularLegitimacy: number, partyConfidence: number) {
  const row: CountryLeaderState = {
    _id: leaderRowId,
    countryId: "CN",
    leaderCharacterId: null,
    leaderNppId: nppId,
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  db.seed("countryLeaderStates", [row as unknown as Record<string, unknown>]);
}

async function escalation(db: InMemoryDb): Promise<EscalationState> {
  const state = await db.collection("regimeEscalation").findOne({ _id: "CN" });
  return state as unknown as EscalationState;
}

async function leaderState(db: InMemoryDb): Promise<CountryLeaderState> {
  const row = await db.collection("countryLeaderStates").findOne({ _id: leaderRowId });
  return row as unknown as CountryLeaderState;
}

/** Run the real per-turn escalation tick for a span of turns at fixed scalars. */
async function runTurns(
  db: InMemoryDb,
  fromTurn: number,
  turns: number,
  popularLegitimacy: number,
  partyConfidence: number
): Promise<RegimeStage[]> {
  const stages: RegimeStage[] = [];
  for (let t = fromTurn; t < fromTurn + turns; t++) {
    const result = await processRegimeEscalationTurn({
      db: db as unknown as Db,
      countryId: "CN",
      popularLegitimacy,
      partyConfidence,
      rulingLeaderCharacterId: leader,
      currentTurn: t,
    });
    if (result) stages.push(result.toStage);
  }
  return stages;
}

describe("autonomous one-party leader regime journey (#3096)", () => {
  let db: InMemoryDb;

  beforeEach(() => {
    db = createInMemoryDb();
    db.collection("regimeEscalation");
    db.collection("countryLeaderStates");
    db.collection("countryState");
  });

  it("successful governance keeps an NPP-led regime stable with no decisions", async () => {
    seedLeaderState(db, 80, 80);
    const stages = await runTurns(db, 1, 120, 80, 80);

    expect(new Set(stages)).toEqual(new Set(["stable"]));
    const state = await escalation(db);
    expect(state.activeDecision).toBeNull();
    expect(state.transitionHistory).toHaveLength(0);
  });

  it("mild sustained failure escalates and offers the decision to the NPP leader", async () => {
    seedLeaderState(db, 50, 60);
    const dwell = STAGE_THRESHOLDS.stage1.dwellTurns;
    const stages = await runTurns(db, 1, dwell + 1, 50, 60);

    // The dwell counter reaches its threshold on the dwell-th failing turn.
    expect(stages.indexOf("discontent")).toBe(dwell - 1);
    expect(stages.at(-1)).toBe("discontent");
    const state = await escalation(db);
    expect(state.activeDecision?.kind).toBe("stage1.addressDiscontent");
    expect(state.activeDecision?.leaderCharacterId).toBeNull();
    expect(state.activeDecision?.leaderNppId?.toString()).toBe(nppId.toString());
  });

  it("an unanswered NPP decision resolves autonomously through the default option", async () => {
    seedLeaderState(db, 50, 60);
    const dwell = STAGE_THRESHOLDS.stage1.dwellTurns;
    await runTurns(db, 1, dwell + 1, 50, 60);
    const offered = await escalation(db);
    const expiresAt = offered.activeDecision!.expiresAtTurn;

    // Keep ticking past expiry with no player input anywhere.
    await runTurns(db, dwell + 2, expiresAt - dwell, 50, 60);

    const after = await escalation(db);
    expect(after.activeDecision).toBeNull();
    // The "ignore" default is applied, not skipped: it parks a faster popular
    // decay on the regime, timed from the turn the decision expired.
    const modifier = (after as unknown as { popularDecayModifier?: { untilTurn: number } })
      .popularDecayModifier;
    expect(modifier?.untilTurn).toBe(expiresAt + 24);
  });

  it("a chosen response moves the NPP leader's own scalars (recovery path)", async () => {
    seedLeaderState(db, 50, 60);
    await runTurns(db, 1, STAGE_THRESHOLDS.stage1.dwellTurns + 1, 50, 60);

    await resolveActiveDecision(db as unknown as Db, "CN", "acknowledge", 20);

    const row = await leaderState(db);
    expect(row.partyConfidence).toBe(58);
    expect(row.popularLegitimacy).toBe(53);
    expect(row.leaderCharacterId).toBeNull();
    // No player-keyed row was invented for the autonomous leader.
    const rows = await db.collection("countryLeaderStates").find({ countryId: "CN" }).toArray();
    expect(rows).toHaveLength(1);
    expect((await escalation(db)).activeDecision).toBeNull();
  });

  it("severe sustained failure carries an NPP-led regime from discontent into crisis", async () => {
    seedLeaderState(db, 30, 60);
    const { dwellTurns } = STAGE_THRESHOLDS.stage1;
    const { dwellSustained } = STAGE_THRESHOLDS.stage2;
    const stages = await runTurns(db, 1, dwellSustained + 1, 30, 60);

    expect(stages.indexOf("discontent")).toBe(dwellTurns - 1);
    expect(stages.at(-1)).toBe("crisis");
    const state = await escalation(db);
    const kinds = [state.activeDecision, ...state.decisionQueue].map((d) => d?.kind);
    expect(kinds).toContain("stage2.respondToUnrest");
    for (const d of [state.activeDecision, ...state.decisionQueue]) {
      if (!d) continue;
      expect(d.leaderCharacterId).toBeNull();
      expect(d.leaderNppId?.toString()).toBe(nppId.toString());
    }
  });
});
