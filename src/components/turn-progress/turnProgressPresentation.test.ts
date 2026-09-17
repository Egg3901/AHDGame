import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TURN_PROGRESS_CARD_CLASS,
  TURN_PROGRESS_SLOT_CLASS,
  classifyTurnActivity,
  describeTurnPhase,
} from "./turnProgressPresentation";

describe("describeTurnPhase", () => {
  it("groups technical phase names into plain-English work", () => {
    expect(
      describeTurnPhase("presidentialElectionResolution", "Presidential Election Resolution")
    ).toBe("Counting votes and resolving elections");
    expect(describeTurnPhase("corporationProduction", "Corporation Production")).toBe(
      "Updating markets and the economy"
    );
    expect(describeTurnPhase("conflictResolution", "Conflict Resolution")).toBe(
      "Resolving conflicts and military affairs"
    );
  });

  it("falls back to a readable dynamic phase label", () => {
    expect(describeTurnPhase("weather", "Weather Effects")).toBe("Updating weather effects");
    expect(describeTurnPhase(null, null)).toBe("Preparing the next turn");
  });
});

describe("classifyTurnActivity", () => {
  it("returns stable ids for the translation catalog", () => {
    expect(classifyTurnActivity("presidentialElectionResolution", null).id).toBe("elections");
    expect(classifyTurnActivity("weather", "Weather Effects")).toEqual({
      id: "updating",
      label: "weather effects",
    });
  });
});

describe("turn progress placement", () => {
  it("centers a compact card on mobile without a viewport-center modal", () => {
    expect(TURN_PROGRESS_SLOT_CLASS).toContain("justify-center");
    expect(TURN_PROGRESS_SLOT_CLASS).toContain("sm:justify-end");
    expect(TURN_PROGRESS_SLOT_CLASS).toContain("sm:right-5");
    expect(TURN_PROGRESS_SLOT_CLASS).toContain("safe-area-inset-bottom");
    expect(TURN_PROGRESS_SLOT_CLASS).toContain("safe-area-inset-left");
    expect(TURN_PROGRESS_SLOT_CLASS).not.toContain("inset-0");
    expect(TURN_PROGRESS_SLOT_CLASS).not.toContain("items-center");
    expect(TURN_PROGRESS_CARD_CLASS).toContain("max-w-[20rem]");
    expect(TURN_PROGRESS_CARD_CLASS).toContain("overflow-hidden");
    expect(TURN_PROGRESS_CARD_CLASS).toContain("motion-reduce:shadow-none");
  });

  it("mounts the popup only on server-gated singleplayer", () => {
    const layout = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/layout.tsx"),
      "utf8"
    );
    expect(layout).toMatch(/\{!isWikiSubdomain && singleplayer && <TurnProgressToast \/>\}/);
    expect(layout).not.toMatch(/\{!isWikiSubdomain && <TurnProgressToast \/>\}/);
  });
});
