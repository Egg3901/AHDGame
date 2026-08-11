import { describe, expect, it } from "vitest";
import { getRelocationCooldownStatus, RELOCATION_COOLDOWN_TURNS } from "./relocationCooldown";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

const realNow = new Date("2026-05-30T16:00:00Z").getTime();

describe("getRelocationCooldownStatus — turn-first", () => {
  it("on cooldown: currentTurn within the 72-turn window", () => {
    const s = getRelocationCooldownStatus({ lastRelocatedTurn: 100 }, 110, realNow, realNow);
    expect(s.onCooldown).toBe(true);
    expect(s.remainingTurns).toBe(62); // 100 + 72 - 110
    expect(s.cooldownRemainingDays).toBe(3); // ceil(62/24)
    expect(s.cooldownUntil).toBe(new Date(realNow + 62 * MS_PER_TURN).toISOString());
  });

  it("off cooldown: currentTurn at or past the window end", () => {
    const s = getRelocationCooldownStatus({ lastRelocatedTurn: 100 }, 172, realNow, realNow);
    expect(s.onCooldown).toBe(false);
    expect(s.remainingTurns).toBe(0);
    expect(s.cooldownRemainingDays).toBeNull();
    expect(s.cooldownUntil).toBeNull();
  });

  it("turn field wins even if the legacy Date would say otherwise", () => {
    // Date is ancient (off cooldown by Date) but turn says still on cooldown.
    const ancient = new Date(realNow - 999 * MS_PER_TURN);
    const s = getRelocationCooldownStatus(
      { lastRelocatedTurn: 100, lastRelocatedAt: ancient },
      110,
      realNow,
      realNow
    );
    expect(s.onCooldown).toBe(true);
  });
});

describe("getRelocationCooldownStatus — Date fallback (legacy docs)", () => {
  it("on cooldown when lastRelocatedAt within 72h and no turn field", () => {
    const effectiveNow = realNow;
    const lastRelocatedAt = new Date(effectiveNow - 10 * MS_PER_TURN); // 10h ago
    const s = getRelocationCooldownStatus({ lastRelocatedAt }, 0, effectiveNow, realNow);
    expect(s.onCooldown).toBe(true);
    expect(s.remainingTurns).toBe(62); // ceil((72h - 10h)/1h)
    expect(s.cooldownRemainingDays).toBe(3); // ceil(62h / 24h)
    expect(s.cooldownUntil).toBe(
      new Date(lastRelocatedAt.getTime() + 72 * MS_PER_TURN).toISOString()
    );
  });

  it("off cooldown when 72h elapsed", () => {
    const effectiveNow = realNow;
    const lastRelocatedAt = new Date(effectiveNow - 72 * MS_PER_TURN);
    const s = getRelocationCooldownStatus({ lastRelocatedAt }, 0, effectiveNow, realNow);
    expect(s.onCooldown).toBe(false);
  });

  it("never relocated: not on cooldown", () => {
    const s = getRelocationCooldownStatus({}, 50, realNow, realNow);
    expect(s.onCooldown).toBe(false);
  });

  it("exposes the 72-turn constant", () => {
    expect(RELOCATION_COOLDOWN_TURNS).toBe(72);
  });
});
