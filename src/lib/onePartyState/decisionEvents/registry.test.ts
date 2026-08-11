import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  registerDecisionHandler,
  getDecisionHandler,
  applyDecisionOption,
  getDefaultOptionId,
  _resetHandlerRegistryForTests,
  _resetMissingHandlerWarningsForTests,
} from "@/lib/onePartyState/decisionEvents/registry";
import type {
  DecisionContext,
  DecisionHandler,
  DecisionOption,
} from "@/lib/onePartyState/decisionEvents/types";
import type { LeaderDecision } from "@/lib/db/types/regimeEscalation";

function makeOption(id: string, applySpy: () => Promise<void>): DecisionOption {
  return {
    id,
    label: `Label for ${id}`,
    description: `Description for ${id}`,
    apply: applySpy,
  };
}

function makeContext(): DecisionContext {
  const decision: LeaderDecision = {
    id: new ObjectId(),
    kind: "stage1.addressDiscontent",
    offeredAtTurn: 100,
    expiresAtTurn: 148,
    leaderCharacterId: new ObjectId(),
    payload: {},
  };
  return {
    db: {} as Db,
    countryId: "CN",
    currentTurn: 100,
    decision,
    leaderCharacterId: decision.leaderCharacterId,
  };
}

describe("decisionEvents registry", () => {
  beforeEach(() => {
    _resetHandlerRegistryForTests();
    _resetMissingHandlerWarningsForTests();
  });

  it("stores and retrieves handlers by kind", () => {
    const handler: DecisionHandler = {
      kind: "stage1.addressDiscontent",
      options: [makeOption("ignore", vi.fn().mockResolvedValue(undefined))],
      defaultOptionId: "ignore",
    };
    registerDecisionHandler(handler);
    expect(getDecisionHandler("stage1.addressDiscontent")).toBe(handler);
  });

  it("returns undefined for unregistered kind", () => {
    expect(getDecisionHandler("stage4.faceCollapse")).toBeUndefined();
  });

  it("getDefaultOptionId returns the handler's default", () => {
    const handler: DecisionHandler = {
      kind: "stage1.addressDiscontent",
      options: [makeOption("ignore", vi.fn().mockResolvedValue(undefined))],
      defaultOptionId: "ignore",
    };
    registerDecisionHandler(handler);
    expect(getDefaultOptionId("stage1.addressDiscontent")).toBe("ignore");
  });

  it("getDefaultOptionId returns undefined for unregistered kind", () => {
    expect(getDefaultOptionId("stage1.addressDiscontent")).toBeUndefined();
  });

  it("applyDecisionOption dispatches to the matching option's apply()", async () => {
    const applySpy = vi.fn().mockResolvedValue(undefined);
    registerDecisionHandler({
      kind: "stage1.addressDiscontent",
      options: [makeOption("acknowledge", applySpy)],
      defaultOptionId: "acknowledge",
    });

    await applyDecisionOption(makeContext(), "acknowledge");
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("applyDecisionOption no-ops (with one-time warn) when no handler is registered", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(applyDecisionOption(makeContext(), "acknowledge")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Second call to same kind should not re-warn
    await applyDecisionOption(makeContext(), "anything");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it("applyDecisionOption throws for unknown option id", async () => {
    registerDecisionHandler({
      kind: "stage1.addressDiscontent",
      options: [makeOption("acknowledge", vi.fn().mockResolvedValue(undefined))],
      defaultOptionId: "acknowledge",
    });

    await expect(applyDecisionOption(makeContext(), "nonexistent")).rejects.toThrow(
      /no option "nonexistent"/i
    );
  });
});
