import { describe, it, expect } from "vitest";
import { buildResolvedNotificationContent } from "./notifications";
import type { EventEffect } from "@/lib/db/types/events";

function ctx(over: {
  optionLabel?: string;
  tierLabel?: string;
  effects?: EventEffect[];
  reason?: "player" | "timeout";
  statAdjustment?: { stat: string; label: string; delta: number };
}) {
  return {
    option: { id: "o", label: over.optionLabel ?? "Take the lump sum" } as never,
    tier: {
      minRoll: 0,
      maxRoll: 100,
      label: over.tierLabel ?? "National headlines",
      effects: over.effects ?? [],
    },
    reason: over.reason ?? ("player" as const),
    statAdjustment: over.statAdjustment,
  };
}

describe("buildResolvedNotificationContent", () => {
  it("names the event from its kind instead of a generic title", () => {
    const { title } = buildResolvedNotificationContent({ kind: "pree.lotteryWin" }, ctx({}));
    expect(title).toBe("Lottery Win resolved");
  });

  it("includes the chosen option and the outcome with effects", () => {
    const { message } = buildResolvedNotificationContent(
      { kind: "pree.lotteryWin" },
      ctx({
        optionLabel: "Donate to charity",
        tierLabel: "National headlines",
        effects: [
          { type: "favorability", delta: 8 },
          { type: "infamy", delta: 2 },
        ],
      })
    );
    expect(message).toBe(
      'You chose "Donate to charity." National headlines — Favorability +8, Infamy +2.'
    );
  });

  it("formats money effects with sign and grouping", () => {
    const { message } = buildResolvedNotificationContent(
      { kind: "pree.lotteryWin" },
      ctx({
        optionLabel: "Take the lump sum",
        tierLabel: "Jackpot after tax",
        effects: [{ type: "personalWealth", deltaAnchor: 500_000 }],
      })
    );
    expect(message).toContain("Personal wealth +$500,000");
  });

  it("phrases a timeout as the default outcome, not a player choice", () => {
    const { message } = buildResolvedNotificationContent(
      { kind: "pree.lotteryWin" },
      ctx({ reason: "timeout", tierLabel: "Ticket expires" })
    );
    expect(message).toBe("No response — the default outcome was applied. Ticket expires.");
  });

  it("omits the effects clause when there are none", () => {
    const { message } = buildResolvedNotificationContent(
      { kind: "pree.lotteryWin" },
      ctx({ optionLabel: "Let the ticket expire", tierLabel: "Ticket expires", effects: [] })
    );
    expect(message).toBe('You chose "Let the ticket expire." Ticket expires.');
  });

  it("surfaces a stat roll adjustment when present", () => {
    const { message } = buildResolvedNotificationContent(
      { kind: "pree.debateGaffe" },
      ctx({
        optionLabel: "Stay on message",
        tierLabel: "Steady as she goes",
        statAdjustment: { stat: "oratory", label: "Oratory", delta: 6 },
      })
    );
    expect(message).toContain("(Roll +6 from Oratory.)");
  });
});
