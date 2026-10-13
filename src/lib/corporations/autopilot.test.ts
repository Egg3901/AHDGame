import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  AUTOPILOT_MODIFIERS,
  AUTOPILOT_RENOTIFY_TURNS,
  advisoriesChanged,
  advisoriesToNotify,
  deriveAutopilotAdvisories,
  isAutopilotRun,
  validateAutopilotToggle,
} from "./autopilot";
import { CEO_ARCHETYPE_MODIFIERS } from "@/lib/npp/ceoArchetype";

const playerCorp = { ceoType: "character" as const, autopilot: { enabledTurn: 10 } };

describe("isAutopilotRun", () => {
  it("runs a player-led corp with autopilot on", () => {
    expect(isAutopilotRun(playerCorp)).toBe(true);
  });

  it("skips corps without autopilot, vacant seats, caretakers, suspended and state-owned corps", () => {
    expect(isAutopilotRun({ ceoType: "character" })).toBe(false);
    expect(isAutopilotRun({ ...playerCorp, ceoVacant: true })).toBe(false);
    expect(isAutopilotRun({ ...playerCorp, suspended: true })).toBe(false);
    expect(isAutopilotRun({ ...playerCorp, countryOwnerId: "US" })).toBe(false);
    expect(isAutopilotRun({ ...playerCorp, isNationalized: true })).toBe(false);
    expect(
      isAutopilotRun({
        ...playerCorp,
        ceoType: "npp",
        caretakerCeo: { underlyingUserId: new ObjectId(), appointedTurn: 1 },
      })
    ).toBe(false);
    expect(isAutopilotRun({ ...playerCorp, ceoType: "imperial" })).toBe(false);
  });
});

describe("validateAutopilotToggle", () => {
  it("allows a sitting player CEO to switch it on and off", () => {
    expect(validateAutopilotToggle({ ceoType: "character" }, true)).toBeNull();
    expect(validateAutopilotToggle(playerCorp, false)).toBeNull();
  });

  it("rejects redundant, vacant, caretaker and state-owned toggles", () => {
    expect(validateAutopilotToggle(playerCorp, true)).toBe("already-on");
    expect(validateAutopilotToggle({ ceoType: "character" }, false)).toBe("already-off");
    expect(validateAutopilotToggle({ ceoType: "character", ceoVacant: true }, true)).toBe(
      "ceo-vacant"
    );
    expect(validateAutopilotToggle({ ceoType: "npp" }, true)).toBe("caretaker-run");
    expect(validateAutopilotToggle({ ceoType: "character", countryOwnerId: "UK" }, true)).toBe(
      "state-owned"
    );
  });
});

describe("AUTOPILOT_MODIFIERS", () => {
  it("is the cautious archetype with the base payout", () => {
    expect(AUTOPILOT_MODIFIERS).toEqual({ ...CEO_ARCHETYPE_MODIFIERS.cautious, dividendMult: 1 });
  });
});

describe("deriveAutopilotAdvisories", () => {
  const none = { chronicLowFill: false, debtDominant: false, distressed: false };

  it("is empty when nothing needs the owner", () => {
    expect(deriveAutopilotAdvisories(none, undefined, 50)).toEqual([]);
  });

  it("orders by urgency and carries the tech subject", () => {
    const out = deriveAutopilotAdvisories(
      { chronicLowFill: true, debtDominant: true, distressed: true, affordableTech: "Robotics" },
      undefined,
      50
    );
    expect(out.map((a) => a.kind)).toEqual(["distress", "debt", "pivot", "tech"]);
    expect(out[3]).toEqual({ kind: "tech", sinceTurn: 50, subject: "Robotics" });
  });

  it("keeps the original sinceTurn while a condition persists and resets it after it clears", () => {
    const first = deriveAutopilotAdvisories({ ...none, debtDominant: true }, undefined, 50);
    const later = deriveAutopilotAdvisories({ ...none, debtDominant: true }, first, 60);
    expect(later).toEqual([{ kind: "debt", sinceTurn: 50 }]);
    const cleared = deriveAutopilotAdvisories(none, later, 61);
    const back = deriveAutopilotAdvisories({ ...none, debtDominant: true }, cleared, 62);
    expect(back).toEqual([{ kind: "debt", sinceTurn: 62 }]);
  });
});

describe("advisoriesToNotify", () => {
  it("notifies newly raised urgent advisories but never research", () => {
    const next = [
      { kind: "debt" as const, sinceTurn: 50 },
      { kind: "tech" as const, sinceTurn: 50, subject: "Robotics" },
    ];
    expect(advisoriesToNotify(undefined, next, undefined, 50)).toEqual([next[0]]);
  });

  it("does not repeat a continuing advisory", () => {
    const prior = [{ kind: "debt" as const, sinceTurn: 40 }];
    expect(advisoriesToNotify(prior, prior, { debt: 40 }, 50)).toEqual([]);
  });

  it("throttles a flickering advisory to once a day", () => {
    const next = [{ kind: "pivot" as const, sinceTurn: 50 }];
    expect(advisoriesToNotify([], next, { pivot: 45 }, 50)).toEqual([]);
    expect(advisoriesToNotify([], next, { pivot: 50 - AUTOPILOT_RENOTIFY_TURNS }, 50)).toEqual(
      next
    );
  });
});

describe("advisoriesChanged", () => {
  it("detects added, removed and re-subjected advisories", () => {
    const a = [{ kind: "tech" as const, sinceTurn: 1, subject: "A" }];
    expect(advisoriesChanged(undefined, [])).toBe(false);
    expect(advisoriesChanged(a, a)).toBe(false);
    expect(advisoriesChanged(a, [])).toBe(true);
    expect(advisoriesChanged(a, [{ ...a[0], subject: "B" }])).toBe(true);
  });
});
